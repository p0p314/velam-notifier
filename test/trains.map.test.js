// Module Trains — cartographie : tracés (shapes.txt), positions (GTFS-RT VehiclePosition),
// rapprochement position → trajet, progression (prochaines gares), API /route.
// Données SNCF simulées (aucun réseau) ; `now` injecté.
const { sncf, resetSncf, startServer, client } = require('./helpers');
const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { getProvider, createProvider, trainsHealth } = require('../trains');
const { sncfConfig } = require('../trains/providers/sncf');
const { buildIndex, filesReader } = require('../trains/gtfs/staticIndex');
const { decodeFeed } = require('../trains/gtfs/realtime');
const { getTripRoute } = require('../trains/route');
const { buildVehicleIndex } = require('../trains/vehicles');
const {
  ST, buildGtfs, tripUpdatesFeed, alertsFeed, vehiclesFeed, area, point, LINES, parisTime, tripId,
} = require('./trainsFixture');

const START = '2026-10-05';   // lundi
const D = '2026-10-07';       // mercredi
const SAT = '2026-10-10';     // samedi : le 16:53 (semaine) ne circule pas
const T1 = tripId('843924', LINES.K44, 'LILLE', 'AMIENS', '2026-11-03');
const K45 = tripId('848908', LINES.K45, 'LILLE', 'AMIENS', '2026-11-03');
const LILLE = area('LILLE');
const AMIENS = area('AMIENS');
const ID = `${T1}|${D}|${LILLE}|${AMIENS}`;
const at = (hhmm) => parisTime(D, hhmm);
const near = (a, b, eps = 1e-4) => Math.abs(a - b) < eps;

async function indexOf(opts = {}) {
  return buildIndex(filesReader(buildGtfs({ start: START, days: 30, ...opts })), require('../trains/providers/sncf').conventions);
}

// Fournisseur de test : la configuration SNCF + un flux de positions fictif (la SNCF
// n'en publie pas ; ce flux simule une source qui en publierait).
const withVehicles = createProvider({
  ...sncfConfig(), id: 'sncf-vp',
  vehiclePositionsUrl: 'https://proxy.transport.data.gouv.fr/resource/test-vehicle-positions',
});
const sncfProvider = getProvider();

function feeds({ updates = [], vehicles = null, ts }) {
  sncf.tripUpdates = tripUpdatesFeed(updates, ts);
  sncf.alerts = alertsFeed([], ts);
  sncf.vehicles = vehicles ? vehiclesFeed(vehicles, ts) : null;
}

beforeEach(async () => {
  resetSncf();
  withVehicles.realtime.reset();
  await sncfProvider.schedule.loadFiles(buildGtfs({ start: START, days: 30 }));
  await withVehicles.schedule.loadFiles(buildGtfs({ start: START, days: 30 }));
});

describe('tracés (TrainRoute)', () => {
  test('sans shapes.txt (cas SNCF) : ligne de gare en gare, signalée approximative', async () => {
    const index = await indexOf();
    const t = index.trips.index.get(T1);
    assert.equal(index.shapes.size, 0);
    const r = getTripRoute(index, t);
    assert.equal(r.geometrySource, 'stops');
    assert.equal(r.shapeId, null);
    assert.equal(r.geometry.type, 'LineString');
    assert.deepEqual(r.stops.map((s) => s.station.name), ['Lille Flandres', 'Douai', 'Arras', 'Albert', 'Amiens']);
    assert.deepEqual(r.stops.map((s) => s.seq), [0, 1, 2, 3, 4]);
    assert.equal(r.geometry.coordinates.length, 5);
    assert.deepEqual(r.geometry.coordinates[0], [ST.LILLE.lon, ST.LILLE.lat].map((v) => Math.round(v * 1e5) / 1e5));
    assert.ok(r.distanceKm > 100 && r.distanceKm < 140, `distance ${r.distanceKm}`);
    assert.equal(r.direction, 1);
    const [w, s, e, n] = r.bbox;
    assert.ok(near(w, ST.AMIENS.lon) && near(e, ST.DOUAI.lon) && near(s, ST.AMIENS.lat) && near(n, ST.LILLE.lat));
  });

  test('avec shapes.txt : tracé réel trié par shape_pt_sequence, points invalides et tracés inutilisés ignorés', async () => {
    const index = await indexOf({ shapes: true });
    assert.deepEqual([...index.shapes.keys()], ['SHP_K44']);
    const r = getTripRoute(index, index.trips.index.get(T1));
    assert.equal(r.geometrySource, 'shape');
    assert.equal(r.shapeId, 'SHP_K44');
    const lats = r.geometry.coordinates.map((c) => c[1]);
    assert.equal(lats.length, 6);
    assert.ok(near(lats[0], ST.LILLE.lat) && near(lats[1], 50.5) && near(lats[5], ST.AMIENS.lat));
    // Un trajet sans shape_id garde la ligne de gare en gare.
    assert.equal(getTripRoute(index, index.trips.index.get(K45)).geometrySource, 'stops');
  });

  test('cache par version du dataset : même objet tant que l\'index ne change pas', async () => {
    const i1 = await indexOf();
    const t = i1.trips.index.get(T1);
    assert.equal(getTripRoute(i1, t), getTripRoute(i1, t));
    const i2 = await indexOf();
    assert.notEqual(getTripRoute(i2, i2.trips.index.get(T1)), getTripRoute(i1, t));
  });

  test('service : itinéraire d\'un TrainJourney, segment de montée / descente', () => {
    const r = sncfProvider.service.getJourneyRoute(ID);
    assert.equal(r.tripId, T1);
    assert.deepEqual(r.segment, { from: 0, to: 4 });
    assert.equal(r.line.name, 'K44');
    assert.equal(r.trainNumber, '843924');
    const sub = sncfProvider.service.getJourneyRoute(`${T1}|${D}|${area('DOUAI')}|${area('ALBERT')}`);
    assert.deepEqual(sub.segment, { from: 1, to: 3 });
    assert.equal(sub.stops.length, 5); // le trajet entier reste dessiné
    assert.throws(() => sncfProvider.service.getJourneyRoute(`${T1}|${SAT}|${LILLE}|${AMIENS}`), /ne circule pas/);
  });
});

describe('positions GTFS-RT (VehiclePosition)', () => {
  test('décodage : position, cap, vitesse, arrêt courant ; sans coordonnées → ignoré', () => {
    const ts = at('17:20');
    const feed = decodeFeed(vehiclesFeed([
      { tripId: T1, startDate: D, vehicleId: 'Z27500', lat: 50.1, lon: 2.7, bearing: 210, speed: 30, timestamp: ts, stopId: point('ALBERT'), seq: 3, status: 'IN_TRANSIT_TO' },
      { vehicleId: 'sans-position' },
      { vehicleId: 'Z1', lat: 50.2, lon: 2.9 },
    ], ts));
    assert.equal(feed.vehicles.length, 2);
    const [v, w] = feed.vehicles;
    assert.equal(v.tripId, T1);
    assert.equal(v.startDate, D);
    assert.equal(v.vehicleId, 'Z27500');
    assert.ok(near(v.lat, 50.1) && near(v.lon, 2.7));
    assert.equal(v.bearing, 210);
    assert.equal(v.speed, 30);
    assert.equal(v.timestamp, Math.floor(ts / 1000) * 1000);
    assert.equal(v.currentStopSequence, 3);
    assert.equal(v.stopId, point('ALBERT'));
    assert.equal(w.currentStatus, 'IN_TRANSIT_TO'); // valeur par défaut de la spécification
    assert.equal(w.tripId, null);
  });

  test('rapprochement : trip_id exact, alias SNCF, ligne + heure de départ ; jamais par le seul véhicule', async () => {
    const index = await indexOf();
    const t1 = index.trips.index.get(T1);
    const k45 = index.trips.index.get(K45);
    const snapshot = decodeFeed(vehiclesFeed([
      { tripId: T1, startDate: D, lat: 50.3, lon: 2.9 },
      { tripId: 'OCESN848908F', startDate: D, lat: 50.4, lon: 2.95 },                         // alias temps réel
      { routeId: LINES.K44, startDate: D, startTime: '07:00:00', directionId: 0, lat: 49.95, lon: 2.4 }, // 843925
      { vehicleId: 'Z27500', lat: 50.0, lon: 2.5 },                                            // aucun trajet
      { tripId: T1, startDate: SAT, lat: 50.3, lon: 2.9 },                                      // ne circule pas
      { tripId: 'inconnu', startDate: D, lat: 50.3, lon: 2.9 },
    ], at('17:20')));
    snapshot.feedTimestamp = at('17:20');
    const vi = buildVehicleIndex(index, snapshot);
    assert.deepEqual(vi.stats, { total: 6, matched: 3, unmatched: 3 });
    assert.ok(vi.map.has(`${t1}|${D}`));
    assert.ok(vi.map.has(`${k45}|${D}`));
    assert.ok(vi.map.has(`${index.trips.index.get(tripId('843925', LINES.K44, 'AMIENS', 'LILLE', '2026-11-03'))}|${D}`));
    assert.equal(buildVehicleIndex(index, snapshot), vi); // calculé une fois par instantané
  });
});

describe('position et progression d\'un trajet', () => {
  const journey = (provider, now, opts = {}) => provider.service.getJourney(opts.id ?? ID, { now });
  const names = (j, idx) => idx.map((i) => j.stops[i].station.name);

  test('SNCF (aucun flux de positions) : progression d\'après les horaires, flux jamais appelé', async () => {
    feeds({ ts: at('17:20') });
    const { journey: j, position } = await journey(sncfProvider, at('17:20'));
    assert.equal(position.available, false);
    assert.equal(position.vehicle, null);
    assert.equal(sncf.calls.vehicles, 0);
    assert.equal(position.progress.basis, 'schedule');
    assert.equal(position.progress.state, 'between');
    assert.deepEqual(names(j, [position.progress.previous, position.progress.next]), ['Douai', 'Arras']);
    assert.deepEqual(names(j, position.progress.upcoming), ['Arras', 'Albert', 'Amiens']);
    assert.equal(j.stops[2].seq, 2);
    assert.equal(j.stops[2].stopId, point('ARRAS'));
  });

  test('horaires : à quai, pas encore parti, arrivé', async () => {
    feeds({ ts: at('17:13') });
    let p = (await journey(sncfProvider, at('17:13'))).position.progress;
    assert.deepEqual([p.state, p.previous, p.next], ['at_stop', 1, 2]);
    p = (await journey(sncfProvider, at('16:00'))).position.progress;
    assert.deepEqual([p.state, p.next, p.upcoming.length], ['not_departed', 0, 5]);
    p = (await journey(sncfProvider, at('18:30'))).position.progress;
    assert.deepEqual([p.state, p.next, p.upcoming], ['arrived', null, []]);
  });

  test('retard : progression d\'après les horaires estimés', async () => {
    feeds({ ts: at('17:00'), updates: [{ tripId: T1, startDate: D, stops: [{ seq: 0, dep: 600 }, { seq: 4, arr: 600 }] }] });
    const { journey: j, position } = await journey(sncfProvider, at('17:00'));
    assert.equal(j.status, 'delayed');
    assert.equal(position.progress.state, 'not_departed'); // 16:53 + 10 min
  });

  test('train supprimé : ni position ni progression', async () => {
    feeds({ ts: at('17:20'), updates: [{ tripId: T1, startDate: D, relationship: 'CANCELED' }], vehicles: [{ tripId: T1, startDate: D, lat: 50.2, lon: 2.75, timestamp: at('17:20') }] });
    const { journey: j, position } = await journey(withVehicles, at('17:20'));
    assert.equal(j.status, 'cancelled');
    assert.equal(position.vehicle, null);
    assert.equal(position.progress, null);
    assert.equal(sncf.calls.vehicles, 0);
  });

  test('position fraîche : projetée entre deux gares, âge et vitesse', async () => {
    // Entre Arras et Albert alors que les horaires le placent entre Douai et Arras.
    feeds({ ts: at('17:20'), vehicles: [{ tripId: T1, startDate: D, lat: 50.15, lon: 2.72, speed: 25, bearing: 200, timestamp: at('17:19') }] });
    const { journey: j, position } = await journey(withVehicles, at('17:20'));
    assert.equal(position.available, true);
    assert.equal(position.upstream_ok, true);
    assert.ok(near(position.vehicle.lat, 50.15));
    assert.equal(position.vehicle.ageS, 60);
    assert.equal(position.vehicle.stale, false);
    assert.equal(position.vehicle.speedKmh, 90);
    assert.equal(position.progress.basis, 'position');
    assert.deepEqual(names(j, [position.progress.previous, position.progress.next]), ['Arras', 'Albert']);
  });

  test('arrêt courant publié (STOPPED_AT, stop_sequence) : à quai', async () => {
    feeds({ ts: at('17:20'), vehicles: [{ tripId: T1, startDate: D, lat: ST.ARRAS.lat, lon: ST.ARRAS.lon, seq: 2, status: 'STOPPED_AT', timestamp: at('17:20') }] });
    const { journey: j, position } = await journey(withVehicles, at('17:20'));
    assert.equal(position.progress.state, 'at_stop');
    assert.deepEqual(names(j, [position.progress.previous, position.progress.next]), ['Arras', 'Albert']);
  });

  test('en approche d\'un arrêt (stop_id de quai)', async () => {
    feeds({ ts: at('17:20'), vehicles: [{ tripId: T1, startDate: D, lat: 50.1, lon: 2.7, stopId: point('ALBERT'), timestamp: at('17:20') }] });
    const { journey: j, position } = await journey(withVehicles, at('17:20'));
    assert.equal(position.progress.state, 'between');
    assert.deepEqual(names(j, [position.progress.next]), ['Albert']);
  });

  test('position ancienne : signalée (stale), progression d\'après les horaires ; trop ancienne : masquée', async () => {
    feeds({ ts: at('17:20'), vehicles: [{ tripId: T1, startDate: D, lat: 50.15, lon: 2.72, timestamp: at('17:12') }] });
    let { position } = await journey(withVehicles, at('17:20'));
    assert.equal(position.vehicle.stale, true);
    assert.equal(position.vehicle.ageS, 480);
    assert.equal(position.progress.basis, 'schedule');

    withVehicles.realtime.reset();
    feeds({ ts: at('17:50'), vehicles: [{ tripId: T1, startDate: D, lat: 50.15, lon: 2.72, timestamp: at('17:12') }] });
    ({ position } = await journey(withVehicles, at('17:50')));
    assert.equal(position.vehicle, null);
  });

  test('train sans position dans le flux, flux en panne : progression d\'après les horaires', async () => {
    feeds({ ts: at('17:20'), vehicles: [{ tripId: K45, startDate: D, lat: 50.3, lon: 2.9, timestamp: at('17:20') }] });
    let { position } = await journey(withVehicles, at('17:20'));
    assert.equal(position.vehicle, null);
    assert.equal(position.progress.basis, 'schedule');

    withVehicles.realtime.reset();
    sncf.vehicles = null; // 503
    ({ position } = await journey(withVehicles, at('17:20')));
    assert.equal(position.available, true);
    assert.equal(position.upstream_ok, false);
    assert.equal(position.vehicle, null);
    assert.equal(position.progress.basis, 'schedule');
  });

  test('hors de la fenêtre du trajet (train de ce soir consulté le matin) : flux de positions non appelé', async () => {
    feeds({ ts: at('09:00'), vehicles: [] });
    await journey(withVehicles, at('09:00'));
    assert.equal(sncf.calls.vehicles, 0);
    await journey(withVehicles, at('16:30'));
    assert.equal(sncf.calls.vehicles, 1);
  });

  test('gare desservie supprimée : retirée des prochaines gares', async () => {
    feeds({ ts: at('17:20'), updates: [{ tripId: T1, startDate: D, stops: [{ seq: 3, skipped: true }] }] });
    const { journey: j, position } = await journey(sncfProvider, at('17:20'));
    assert.deepEqual(names(j, position.progress.upcoming), ['Arras', 'Amiens']);
  });

  test('santé : flux de positions absent pour la SNCF', () => {
    assert.equal(trainsHealth().find((h) => h.provider === 'sncf').vehicle_positions, null);
  });
});

describe('API', () => {
  let srv;
  let api;
  before(async () => { srv = await startServer(); api = client(srv.url); });
  after(() => srv.close());

  test('GET /api/trains/route : tracé, gares, cache navigateur + ETag (304)', async () => {
    const res = await api.get(`/api/trains/route?id=${encodeURIComponent(ID)}`);
    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.route.geometrySource, 'stops');
    assert.equal(res.body.route.stops.length, 5);
    assert.match(res.headers.get('cache-control'), /max-age=3600/);
    const etag = res.headers.get('etag');
    assert.ok(etag);
    // Revalidation comme le cache HTTP du navigateur (fetch() ajouterait « no-cache »).
    const status = await new Promise((resolve, reject) => {
      require('http').get(`${srv.url}/api/trains/route?id=${encodeURIComponent(ID)}`, { headers: { 'If-None-Match': etag } }, (r) => {
        r.resume();
        resolve(r.statusCode);
      }).on('error', reject);
    });
    assert.equal(status, 304);
  });

  test('GET /api/trains/route : identifiant manquant / invalide / inconnu', async () => {
    assert.equal((await api.get('/api/trains/route')).status, 400);
    assert.equal((await api.get('/api/trains/route?id=n-importe-quoi')).status, 400);
    assert.equal((await api.get(`/api/trains/route?id=${encodeURIComponent(`inconnu|${D}|${LILLE}|${AMIENS}`)}`)).status, 404);
  });

  test('GET /api/trains/journey : bloc position (sans flux SNCF)', async () => {
    const res = await api.get(`/api/trains/journey?id=${encodeURIComponent(ID)}`);
    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.position.available, false);
    assert.equal(res.body.position.vehicle, null);
    assert.ok('progress' in res.body.position);
  });
});
