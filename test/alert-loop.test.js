// Boucle d'alerte (checkAlerts) de bout en bout : base réelle, faux GBFS, faux web-push.
const { resetDb, gbfs, resetGbfs, expireCache, dbc, fakeSubscription } = require('./helpers');
const { test, beforeEach, describe } = require('node:test');
const assert = require('node:assert/strict');
const webpush = require('web-push');
const { checkAlerts, runPollCycle, getAlertLoopHealth, startPolling, stopPolling } = require('../push');
const { createUser, createAlert, updateAlert, addSubscription, setAlertsPause, saveStations } = require('../db');

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

/** Statut complet de plusieurs stations : { id: { bikes, docks, ...extra } }. */
const setStatus = async (map) => {
  await expireCache();
  gbfs.status = Object.entries(map).map(([station_id, { bikes = 0, docks = 0, ...extra }]) => ({
    station_id, num_bikes_available: bikes, num_docks_available: docks,
    vehicle_types_available: [{ vehicle_type_id: 'mechanical', count: bikes }], ...extra,
  }));
};
const alertCount = async () => Number((await dbc.get('SELECT COUNT(*) AS n FROM alerts')).n);

const alertBase = {
  station_id: '1', station_name: 'Gare', bike_type: 'any',
  threshold: 2, time_start: '08:00', time_end: '09:00', days: '1,2,3,4,5,6,7',
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

  test('seuil atteint (count <= threshold) → notification', async () => {
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
    assert.match(sent[0].payload.body, /^Plus aucun vélo électrique disponible$/);
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
    const row = await dbc.get('SELECT last_notified_key FROM alerts WHERE id = ?', [alert.id]);
    assert.equal(row.last_notified_key, null);
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

describe('places libres et « au moins N »', () => {
  test('places : notifie quand il reste au plus N places', async () => {
    await createAlert(userId, { ...alertBase, target: 'docks', threshold: 1 });
    await setStatus({ 1: { bikes: 19, docks: 3 } });
    await checkAlerts(WED_0830);
    assert.equal(sent.length, 0);
    await setStatus({ 1: { bikes: 21, docks: 1 } });
    await checkAlerts(WED_0831);
    assert.equal(sent.length, 1);
    assert.match(sent[0].payload.body, /1 place libre/);
  });

  test('station qui ne reprend pas les vélos → 0 place', async () => {
    await createAlert(userId, { ...alertBase, target: 'docks', threshold: 0 });
    await setStatus({ 1: { docks: 10, is_returning: false } });
    await checkAlerts(WED_0830);
    assert.equal(sent.length, 1);
  });

  test('au moins N : notifie au retour des vélos, se réarme en dessous', async () => {
    await createAlert(userId, { ...alertBase, comparison: 'at_least', threshold: 3 });
    await setStatus({ 1: { bikes: 1 } });
    await checkAlerts(WED_0830);
    assert.equal(sent.length, 0);
    await setStatus({ 1: { bikes: 4 } });
    await checkAlerts(WED_0830);
    assert.equal(sent.length, 1);
    assert.match(sent[0].payload.title, /^✅/);
    await setStatus({ 1: { bikes: 4 } });
    await checkAlerts(WED_0831);
    assert.equal(sent.length, 1, 'même état → pas de doublon');
    await setStatus({ 1: { bikes: 0 } });
    await checkAlerts(WED_0831);
    await setStatus({ 1: { bikes: 4 } });
    await checkAlerts(WED_0831);
    assert.equal(sent.length, 2, 'réarmée après être repassée sous le seuil');
  });
});

describe('trajet', () => {
  const trip = {
    ...alertBase, threshold: 1,
    arrival_station_id: '2', arrival_station_name: 'Zoo', arrival_threshold: 1,
  };

  test('tout va bien aux deux bouts → rien', async () => {
    await createAlert(userId, trip);
    await setStatus({ 1: { bikes: 5 }, 2: { docks: 6 } });
    await checkAlerts(WED_0830);
    assert.equal(sent.length, 0);
  });

  test('station d\'arrivée pleine → notification trajet', async () => {
    await createAlert(userId, trip);
    await setStatus({ 1: { bikes: 5 }, 2: { docks: 0 } });
    await checkAlerts(WED_0830);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].payload.title, '⚠️ Trajet Gare → Zoo');
    assert.equal(sent[0].payload.body, 'Départ Gare : 5 vélos · Arrivée Zoo : 0 place');
  });

  test('changement d\'un seul bout → re-notification', async () => {
    await createAlert(userId, trip);
    await setStatus({ 1: { bikes: 1 }, 2: { docks: 5 } });
    await checkAlerts(WED_0830);
    await setStatus({ 1: { bikes: 1 }, 2: { docks: 0 } });
    await checkAlerts(WED_0831);
    assert.equal(sent.length, 2);
  });
});

describe('alerte ponctuelle', () => {
  test('valable uniquement le jour indiqué, quels que soient les jours', async () => {
    await createAlert(userId, { ...alertBase, days: '1', valid_on: '2025-09-24' }); // mercredi, days = lundi
    await setBikes(0);
    await checkAlerts(WED_0830);
    assert.equal(sent.length, 1);
  });

  test('ignorée avant son jour', async () => {
    await createAlert(userId, { ...alertBase, valid_on: '2025-09-25' });
    await setBikes(0);
    await checkAlerts(WED_0830);
    assert.equal(sent.length, 0);
    assert.equal(await alertCount(), 1);
  });

  test('supprimée une fois son jour passé', async () => {
    await createAlert(userId, { ...alertBase, valid_on: '2025-09-24' });
    await createAlert(userId, alertBase); // récurrente : conservée
    await setBikes(5);
    await checkAlerts(THU_0830);
    assert.equal(await alertCount(), 1);
  });
});

describe('pause globale', () => {
  test('en pause jusqu\'à aujourd\'hui inclus → aucune évaluation', async () => {
    await createAlert(userId, alertBase);
    await setAlertsPause(userId, '2025-09-24');
    await setBikes(0);
    await checkAlerts(WED_0830);
    assert.equal(gbfs.calls.status, 0);
    assert.equal(sent.length, 0);
  });

  test('reprise automatique le lendemain de la date de fin', async () => {
    await createAlert(userId, alertBase);
    await setAlertsPause(userId, '2025-09-24');
    await setBikes(0);
    await checkAlerts(THU_0830);
    assert.equal(sent.length, 1);
  });

  test('la pause d\'un compte n\'affecte pas les autres', async () => {
    const { id: other } = await createUser(`o${Date.now()}`, 'hash');
    await addSubscription(other, fakeSubscription('autre'));
    await createAlert(userId, alertBase);
    await createAlert(other, alertBase);
    await setAlertsPause(userId, '2025-09-30');
    await setBikes(0);
    await checkAlerts(WED_0830);
    assert.deepEqual(sent.map((x) => x.endpoint), ['https://push.example.com/send/autre']);
  });
});

describe('modification d\'une alerte', () => {
  test('réarme l\'alerte : elle peut notifier à nouveau le jour même', async () => {
    const alert = await createAlert(userId, alertBase);
    await setBikes(1);
    await checkAlerts(WED_0830);
    await updateAlert(userId, alert.id, { threshold: 3 });
    await setBikes(1);
    await checkAlerts(WED_0831);
    assert.equal(sent.length, 2);
  });
});

describe('station de repli dans la notification', () => {
  test('propose la station voisine qui a des vélos', async () => {
    await saveStations([
      { station_id: '1', name: 'Gare', lat: 49.8900, lon: 2.3000, capacity: 20 },
      { station_id: '2', name: 'Cathédrale', lat: 49.8930, lon: 2.3000, capacity: 20 },
    ]);
    await createAlert(userId, alertBase);
    await setStatus({ 1: { bikes: 0 }, 2: { bikes: 6 } });
    await checkAlerts(WED_0830);
    assert.equal(sent[0].payload.body, 'Plus aucun vélo disponible\nRepli : Cathédrale (330 m) : 6 vélos');
  });

  test('sans référentiel en base : notification sans repli', async () => {
    await createAlert(userId, alertBase);
    await setStatus({ 1: { bikes: 0 }, 2: { bikes: 6 } });
    await checkAlerts(WED_0830);
    assert.equal(sent[0].payload.body, 'Plus aucun vélo disponible');
  });
});

describe('flux Vélam défaillant : pas d\'alerte sur des données périmées', () => {
  test('flux figé depuis 5 min → aucune notification', async () => {
    await createAlert(userId, alertBase);
    await setBikes(0);
    gbfs.lastUpdated = Math.floor(Date.now() / 1000) - 6 * 60;
    await checkAlerts(WED_0830);
    assert.equal(sent.length, 0);
  });

  test('flux en erreur après un succès (données servies en secours) → aucune notification', async () => {
    await createAlert(userId, alertBase);
    await setBikes(5);
    await checkAlerts(WED_0830); // succès, pas de notif (5 vélos)
    await setBikes(0);
    gbfs.fail = true;
    await checkAlerts(WED_0831);
    assert.equal(sent.length, 0);
  });
});

describe('santé de la boucle d\'alerte (/api/health)', () => {
  test('cycle réussi : démarrée, saine, dernier résultat enregistré', async (t) => {
    startPolling();
    t.after(stopPolling);
    await createAlert(userId, alertBase);
    await setBikes(0);
    await runPollCycle(WED_0830);
    const h = getAlertLoopHealth();
    assert.equal(h.started, true);
    assert.equal(h.healthy, true);
    assert.equal(h.last_outcome, 'verifiees');
    assert.ok(h.last_run_at);
    assert.equal(sent.length, 1);
  });

  test('résultats explicites : aucune alerte, aucune due, données périmées', async (t) => {
    startPolling();
    t.after(stopPolling);
    await runPollCycle(WED_0830);
    assert.equal(getAlertLoopHealth().last_outcome, 'aucune_alerte');
    await createAlert(userId, { ...alertBase, time_start: '17:00', time_end: '18:00' });
    await runPollCycle(WED_0830);
    assert.equal(getAlertLoopHealth().last_outcome, 'aucune_due');
    await createAlert(userId, alertBase);
    await setBikes(0);
    gbfs.lastUpdated = Math.floor(Date.now() / 1000) - 10 * 60;
    await runPollCycle(WED_0830);
    assert.equal(getAlertLoopHealth().last_outcome, 'donnees_perimees');
  });

  test('erreur pendant un cycle : enregistrée, boucle signalée malsaine', async (t) => {
    startPolling();
    t.after(stopPolling);
    const original = dbc.get;
    dbc.get = async () => { throw new Error('base indisponible'); };
    t.after(() => { dbc.get = original; });
    await runPollCycle(WED_0830);
    const h = getAlertLoopHealth();
    assert.equal(h.last_outcome, 'erreur');
    assert.equal(h.last_error.message, 'base indisponible');
    assert.equal(h.healthy, false);
  });

  test('boucle arrêtée ou bloquée depuis 3 intervalles → malsaine', async (t) => {
    startPolling();
    t.after(stopPolling);
    await runPollCycle(WED_0830);
    assert.equal(getAlertLoopHealth(Date.now() + 10 * 60_000).healthy, false);
    stopPolling();
    assert.equal(getAlertLoopHealth().healthy, false);
  });
});
