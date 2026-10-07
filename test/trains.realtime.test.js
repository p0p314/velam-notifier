// Module Trains — GTFS-RT : décodage protobuf (schéma officiel) et cache du fournisseur.
const { sncf, resetSncf } = require('./helpers');
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { decodeFeed, createRealtimeProvider, toPlainText } = require('../trains/gtfs/realtime');
const { tripUpdatesFeed, alertsFeed } = require('./trainsFixture');
const { TRIP_UPDATES_URL, SERVICE_ALERTS_URL } = require('../trains/providers/sncf');

beforeEach(() => resetSncf());

describe('décodage GTFS-RT', () => {
  test('Trip Updates : retards, horaires, suppression, arrêt supprimé, relation absente = SCHEDULED', () => {
    const ts = Date.parse('2026-10-07T14:00:00Z');
    const feed = decodeFeed(tripUpdatesFeed([
      { tripId: 'T1', startDate: '2026-10-07', delay: 60, stops: [{ seq: 0, stopId: 'S1', dep: 540 }, { seq: 2, stopId: 'S3', skipped: true }] },
      { tripId: 'OCESN843925F', startDate: '2026-10-07', relationship: 'CANCELED' },
      { tripId: 'T3', stops: [{ seq: 1, depTime: Date.parse('2026-10-07T15:02:00Z') }] },
    ], ts));
    assert.equal(feed.timestamp, ts);
    assert.equal(feed.tripUpdates.length, 3);
    const [a, b, c] = feed.tripUpdates;
    assert.equal(a.relationship, 'SCHEDULED');
    assert.equal(a.startDate, '2026-10-07');
    assert.equal(a.delay, 60);
    assert.deepEqual(a.stops[0], { seq: 0, stopId: 'S1', arrival: null, departure: { delay: 540, time: null }, relationship: 'SCHEDULED' });
    assert.equal(a.stops[1].relationship, 'SKIPPED');
    assert.equal(b.relationship, 'CANCELED');
    assert.equal(c.startDate, null);
    assert.equal(c.stops[0].departure.time, Date.parse('2026-10-07T15:02:00Z'));
  });

  test('Service Alerts : texte en français, périodes, entités (ligne, train, gare)', () => {
    const feed = decodeFeed(alertsFeed([
      { id: 'A1', header: 'Travaux entre Arras et Amiens', description: 'Substitution par autocar', routeId: 'L1', start: Date.parse('2026-10-07T00:00:00Z'), end: Date.parse('2026-10-08T00:00:00Z'), effect: 'MODIFIED_SERVICE' },
      { id: 'A2', header: 'Train supprimé', tripId: 'OCESN843924F', effect: 'NO_SERVICE' },
    ]));
    assert.equal(feed.alerts.length, 2);
    const [a1, a2] = feed.alerts;
    assert.equal(a1.header, 'Travaux entre Arras et Amiens');
    assert.equal(a1.description, 'Substitution par autocar');
    assert.equal(a1.effect, 'MODIFIED_SERVICE');
    assert.deepEqual(a1.periods, [{ start: Date.parse('2026-10-07T00:00:00Z'), end: Date.parse('2026-10-08T00:00:00Z') }]);
    assert.equal(a1.entities[0].routeId, 'L1');
    assert.equal(a2.entities[0].tripId, 'OCESN843924F');
    assert.deepEqual(a2.periods, []);
  });
});

describe('texte des perturbations', () => {
  test('le HTML des messages SNCF devient du texte brut (balises, entités, paragraphes)', () => {
    assert.equal(
      toPlainText('<p>Train <b>supprim&eacute;</b>&nbsp;:</p><p>Plus d&#39;informations <a href="https://x">ici</a><br/>Fin</p>'),
      "Train supprimé :\nPlus d'informations ici\nFin",
    );
    assert.equal(toPlainText('<script>alert(1)</script>'), 'alert(1)');
    assert.equal(toPlainText('<p> </p>'), null);
    const feed = decodeFeed(alertsFeed([{ id: 'H', header: '<p>Travaux &agrave; Arras</p>' }]));
    assert.equal(feed.alerts[0].header, 'Travaux à Arras');
  });
});

describe('cache du fournisseur temps réel', () => {
  const provider = (env = {}) => createRealtimeProvider({ tripUpdatesUrl: TRIP_UPDATES_URL, serviceAlertsUrl: SERVICE_ALERTS_URL, env: { TRAINS_RT_TTL_MS: '60000', TRAINS_ALERTS_TTL_MS: '60000', ...env } });

  test('un seul appel par flux pendant le TTL, y compris en appels concurrents', async () => {
    sncf.tripUpdates = tripUpdatesFeed([]);
    sncf.alerts = alertsFeed([]);
    const rt = provider();
    await Promise.all([rt.get(), rt.get(), rt.get()]);
    await rt.get();
    assert.equal(sncf.calls.tripUpdates, 1);
    assert.equal(sncf.calls.alerts, 1);
  });

  test('actualisation forcée limitée (pas plus d\'une fois toutes les 30 s)', async () => {
    sncf.tripUpdates = tripUpdatesFeed([]);
    sncf.alerts = alertsFeed([]);
    const rt = provider();
    await rt.get();
    await rt.get({ force: true });
    assert.equal(sncf.calls.tripUpdates, 1);
  });

  test('flux indisponible sans donnée antérieure : instantané vide, pas d\'exception', async () => {
    sncf.failRealtime = true;
    const { tripUpdates } = await provider().get();
    assert.equal(tripUpdates.upstreamOk, false);
    assert.deepEqual(tripUpdates.tripUpdates, []);
    assert.equal(tripUpdates.feedTimestamp, null);
  });

  test('panne après une réponse valide : la dernière réponse est resservie (upstreamOk = false)', async () => {
    sncf.tripUpdates = tripUpdatesFeed([{ tripId: 'T1', delay: 120 }]);
    sncf.alerts = alertsFeed([]);
    const rt = provider({ TRAINS_RT_TTL_MS: '1', TRAINS_ALERTS_TTL_MS: '1' });
    await rt.get();
    sncf.failRealtime = true;
    await new Promise((r) => setTimeout(r, 5));
    const { tripUpdates } = await rt.get();
    assert.equal(tripUpdates.upstreamOk, false);
    assert.equal(tripUpdates.tripUpdates[0].delay, 120);
  });

  test('réponse illisible (protobuf invalide) traitée comme une panne', async () => {
    sncf.tripUpdates = Buffer.from([0xff, 0xff, 0xff, 0x01, 0x02]);
    sncf.alerts = alertsFeed([]);
    const { tripUpdates } = await provider().get();
    assert.equal(tripUpdates.upstreamOk, false);
  });
});
