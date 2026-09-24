// Boucle d'alerte (checkAlerts) de bout en bout : base réelle, faux GBFS, faux web-push.
const { resetDb, gbfs, resetGbfs, expireCache, dbc, fakeSubscription } = require('./helpers');
const { test, beforeEach, describe } = require('node:test');
const assert = require('node:assert/strict');
const webpush = require('web-push');
const { checkAlerts } = require('../push');
const { createUser, createAlert, addSubscription } = require('../db');

// Mercredi 24/09/2025 à 08:30 heure de Paris (06:30 UTC)
const WED_0830 = new Date('2025-09-24T06:30:00Z');
const WED_0831 = new Date('2025-09-24T06:31:00Z');
const THU_0830 = new Date('2025-09-25T06:30:00Z');

let sent;          // notifications envoyées : { endpoint, payload }
let pushFailure;   // (endpoint) => statusCode à renvoyer en erreur, ou null
webpush.sendNotification = async (sub, payload) => {
  const code = pushFailure?.(sub.endpoint);
  if (code) { const e = new Error('push'); e.statusCode = code; throw e; }
  sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
};

let userId;
beforeEach(async () => {
  await resetDb();
  resetGbfs();
  sent = [];
  pushFailure = null;
  ({ id: userId } = await createUser(`u${Date.now()}`, 'hash'));
  await addSubscription(userId, fakeSubscription('tel'));
});

const setBikes = async (count, stationId = '1') => {
  await expireCache();
  gbfs.status = [{
    station_id: stationId, num_bikes_available: count,
    vehicle_types_available: [{ vehicle_type_id: 'mechanical', count }],
  }];
};

const alertBase = {
  station_id: '1', station_name: 'Gare', bike_type: 'any',
  min_count: 2, time_start: '08:00', time_end: '09:00', days: '1,2,3,4,5,6,7',
};

describe('déclenchement', () => {
  test('aucune alerte active → aucun appel GBFS', async () => {
    await createAlert(userId, { ...alertBase, active: 0 });
    await checkAlerts(WED_0830);
    assert.equal(gbfs.calls.status, 0);
    assert.equal(sent.length, 0);
  });

  test('hors fenêtre horaire → aucun appel GBFS', async () => {
    await createAlert(userId, { ...alertBase, time_start: '17:00', time_end: '18:00' });
    await checkAlerts(WED_0830);
    assert.equal(gbfs.calls.status, 0);
  });

  test('jour non couvert → aucun appel GBFS', async () => {
    await createAlert(userId, { ...alertBase, days: '1,2' }); // lundi, mardi
    await checkAlerts(WED_0830);
    assert.equal(gbfs.calls.status, 0);
  });

  test('au-dessus du seuil → pas de notification', async () => {
    await createAlert(userId, alertBase);
    await setBikes(5);
    await checkAlerts(WED_0830);
    assert.equal(gbfs.calls.status, 1);
    assert.equal(sent.length, 0);
  });

  test('seuil atteint (count <= min_count) → notification', async () => {
    await createAlert(userId, alertBase);
    await setBikes(2);
    await checkAlerts(WED_0830);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].endpoint, 'https://push.example.com/send/tel');
    assert.equal(sent[0].payload.stationId, '1');
    assert.match(sent[0].payload.body, /^2 vélo/);
  });

  test('type de vélo respecté (ebike ↔ electrical)', async () => {
    await createAlert(userId, { ...alertBase, bike_type: 'ebike' });
    await setBikes(10); // 10 mécaniques, 0 électrique
    await checkAlerts(WED_0830);
    assert.equal(sent.length, 1);
    assert.match(sent[0].payload.body, /Plus aucun vélo\(s\) électrique/);
  });

  test('envoi à tous les appareils du compte', async () => {
    await addSubscription(userId, fakeSubscription('pc'));
    await createAlert(userId, alertBase);
    await setBikes(0);
    await checkAlerts(WED_0830);
    assert.deepEqual(sent.map((s) => s.endpoint).sort(), [
      'https://push.example.com/send/pc', 'https://push.example.com/send/tel',
    ]);
  });
});

describe('anti-spam', () => {
  test('même compte au cycle suivant → pas de nouvelle notification', async () => {
    await createAlert(userId, alertBase);
    await setBikes(1);
    await checkAlerts(WED_0830);
    await setBikes(1);
    await checkAlerts(WED_0831);
    assert.equal(sent.length, 1);
  });

  test('compte qui change sous le seuil → re-notification', async () => {
    await createAlert(userId, alertBase);
    await setBikes(2);
    await checkAlerts(WED_0830);
    await setBikes(1);
    await checkAlerts(WED_0831);
    assert.equal(sent.length, 2);
    assert.match(sent[1].payload.body, /^1 vélo/);
  });

  test('remontée au-dessus du seuil puis redescente → réarmée', async () => {
    const alert = await createAlert(userId, alertBase);
    await setBikes(2);
    await checkAlerts(WED_0830);
    await setBikes(5);
    await checkAlerts(WED_0831);
    const row = await dbc.get('SELECT last_notified_count FROM alerts WHERE id = ?', [alert.id]);
    assert.equal(row.last_notified_count, null);
    await setBikes(2); // même valeur qu'avant : doit tout de même re-notifier
    await checkAlerts(WED_0831);
    assert.equal(sent.length, 2);
  });

  test('nouveau jour → notifie à nouveau', async () => {
    await createAlert(userId, alertBase);
    await setBikes(1);
    await checkAlerts(WED_0830);
    await setBikes(1);
    await checkAlerts(THU_0830);
    assert.equal(sent.length, 2);
  });
});

describe('robustesse', () => {
  test('subscription expirée (410) → supprimée ; autre erreur → conservée', async () => {
    await addSubscription(userId, fakeSubscription('pc'));
    pushFailure = (ep) => (ep.endsWith('/tel') ? 410 : ep.endsWith('/pc') ? 500 : null);
    await createAlert(userId, alertBase);
    await setBikes(0);
    await checkAlerts(WED_0830);
    const { rows } = await dbc.query('SELECT endpoint FROM push_subscriptions WHERE user_id = ?', [userId]);
    assert.deepEqual(rows.map((r) => r.endpoint), ['https://push.example.com/send/pc']);
  });

  test('GBFS indisponible → aucune notification, aucune exception', async () => {
    await createAlert(userId, alertBase);
    await expireCache();
    gbfs.fail = true;
    await checkAlerts(WED_0830);
    assert.equal(sent.length, 0);
  });

  test('station absente du flux live → traitée comme 0 vélo', async () => {
    await createAlert(userId, { ...alertBase, station_id: '999' });
    await setBikes(10, '1');
    await checkAlerts(WED_0830);
    assert.equal(sent.length, 1);
  });
});
