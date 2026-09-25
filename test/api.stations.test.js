// Intégration : stations (cache + live), refresh protégé, santé, rental_apps, cron, /open.
const { resetDb, startServer, client, registerUser, gbfs, resetGbfs, expireCache, dbc } = require('./helpers');
const { test, before, after, beforeEach, describe } = require('node:test');
const assert = require('node:assert/strict');

let srv, api;
before(async () => { srv = await startServer(); api = client(srv.url); });
after(() => srv.close());
beforeEach(async () => { await resetDb(); resetGbfs(); await expireCache(); });

const info = (id, name, extra = {}) => ({ station_id: id, name, address: ' 1 rue ', lat: 49.89, lon: 2.29, capacity: 20, ...extra });

describe('GET /api/stations', () => {
  test('peuple le référentiel au premier appel puis fusionne le live', async () => {
    gbfs.info = [info('1', 'Gare'), info('761', 'Fantôme'), info('3', '  ')];
    gbfs.status = [{
      station_id: '1', num_bikes_available: 4, num_docks_available: 16, is_renting: true,
      vehicle_types_available: [{ vehicle_type_id: 'mechanical', count: 1 }, { vehicle_type_id: 'electrical', count: 3 }],
    }];

    const res = await api.get('/api/stations');
    assert.equal(res.status, 200);
    assert.equal(res.body.count, 1, 'station 761 et station sans nom filtrées');
    const [s] = res.body.stations;
    assert.equal(s.name, 'Gare');
    assert.equal(s.address, '1 rue');
    assert.equal(s.electrical, 3);
    assert.equal(s.mechanical, 1);
    assert.ok(res.body.fetched_at);
    assert.equal(gbfs.calls.info, 1);
  });

  test('le référentiel en cache n\'est pas refetché, le live toujours', async () => {
    gbfs.info = [info('1', 'Gare')];
    await api.get('/api/stations');
    await expireCache();
    gbfs.status = [{ station_id: '1', num_bikes_available: 9 }];
    const res = await api.get('/api/stations');
    assert.equal(gbfs.calls.info, 1);
    assert.equal(gbfs.calls.status, 2);
    assert.equal(res.body.stations[0].total_bikes, 9);
  });

  test('appels simultanés mutualisés en un seul fetch GBFS', async () => {
    const { getStationStatus } = require('../gbfs');
    gbfs.status = [{ station_id: '1', num_bikes_available: 1 }];
    const results = await Promise.all([getStationStatus(), getStationStatus(), getStationStatus()]);
    assert.equal(gbfs.calls.status, 1);
    assert.ok(results.every((r) => r === results[0]));
  });

  test('GBFS indisponible → 502 { ok:false }', async () => {
    gbfs.fail = true;
    const res = await api.get('/api/stations');
    assert.equal(res.status, 502);
    assert.equal(res.body.ok, false);
  });
});

describe('POST /api/stations/refresh', () => {
  test('exige un compte', async () => {
    assert.equal((await api.post('/api/stations/refresh')).status, 401);
    assert.equal(gbfs.calls.info, 0);
  });

  test('recharge le référentiel', async () => {
    const { token } = await registerUser(api);
    gbfs.info = [info('1', 'Gare'), info('2', 'Zoo')];
    const res = await api.post('/api/stations/refresh', { token });
    assert.equal(res.status, 200);
    assert.equal(res.body.count, 2);
    const row = await dbc.get('SELECT COUNT(*) AS n FROM stations');
    assert.equal(Number(row.n), 2);
  });
});

describe('santé', () => {
  test('/health sans base', async () => {
    const res = await api.get('/health');
    assert.equal(res.body.status, 'ok');
  });
  test('/api/health', async () => {
    const res = await api.get('/api/health');
    assert.equal(res.body.ok, true);
    assert.equal(res.body.stations_in_db, 0);
  });
});

describe('rental_apps et cron', () => {
  const ORIGINAL = process.env.CRON_SECRET;
  after(() => { process.env.CRON_SECRET = ORIGINAL; });

  test('cron désactivé sans CRON_SECRET → 503', async () => {
    delete process.env.CRON_SECRET;
    assert.equal((await api.post('/cron/sync-rental-apps')).status, 503);
  });

  test('cron : mauvais secret → 401', async () => {
    process.env.CRON_SECRET = 'cron-secret';
    const res = await api.post('/cron/sync-rental-apps', { headers: { Authorization: 'Bearer faux' } });
    assert.equal(res.status, 401);
  });

  test('cron : synchronise puis expose les rental_apps', async () => {
    process.env.CRON_SECRET = 'cron-secret';
    gbfs.system = {
      name: 'Vélam',
      rental_apps: { ios: { discovery_uri: 'velam://', store_uri: 'https://apps.apple.com/velam' } },
    };
    const res = await api.post('/cron/sync-rental-apps', { headers: { Authorization: 'Bearer cron-secret' } });
    assert.equal(res.status, 200);
    assert.equal(res.body.count, 1);

    const apps = await api.get('/api/rental-apps');
    assert.equal(apps.body.apps[0].platform, 'ios');
    assert.equal(apps.body.apps[0].discovery_uri, 'velam://');

    // Upsert : une seconde synchro ne duplique pas
    await api.post('/cron/sync-rental-apps', { headers: { Authorization: 'Bearer cron-secret' } });
    assert.equal((await api.get('/api/rental-apps')).body.apps.length, 1);
  });

  test('cron : GBFS indisponible → 502', async () => {
    process.env.CRON_SECRET = 'cron-secret';
    gbfs.fail = true;
    const res = await api.post('/cron/sync-rental-apps', { headers: { Authorization: 'Bearer cron-secret' } });
    assert.equal(res.status, 502);
  });

  test('/open échappe les liens injectés dans le script', async () => {
    await dbc.run(
      'INSERT INTO rental_apps (platform, name, discovery_uri, store_uri, updated_at) VALUES (?, ?, ?, ?, ?)',
      ['ios', 'Vélam', 'velam://</script><script>alert(1)</script>', null, 0]
    );
    const res = await api.get('/open');
    assert.equal(res.status, 200);
    assert.ok(!res.text.includes('</script><script>alert(1)'));
    assert.match(res.headers.get('content-type'), /text\/html/);
  });
});

describe('sécurité HTTP', () => {
  test('en-têtes helmet + CSP', async () => {
    const res = await api.get('/health');
    assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  });
  test('corps JSON > 16 kb refusé', async () => {
    const res = await api.post('/api/auth/login', { body: { username: 'x'.repeat(20_000), password: 'y' } });
    assert.equal(res.status, 413);
  });
});

describe('référentiel et fraîcheur des données (v1.1)', () => {
  test('report_age_min : minutes depuis le dernier signal de la borne', async () => {
    const now = Math.floor(Date.now() / 1000);
    gbfs.info = [info('1', 'Gare'), info('2', 'Zoo'), info('3', 'Cirque')];
    gbfs.status = [
      { station_id: '1', last_reported: now - 30 },
      { station_id: '2', last_reported: now - 2 * 3600 },
      { station_id: '3' },
    ];
    const { body } = await api.get('/api/stations');
    const age = Object.fromEntries(body.stations.map((s) => [s.station_id, s.report_age_min]));
    assert.deepEqual(age, { 1: 0, 2: 120, 3: null });
  });

  test('cron refresh-stations : ajoute, met à jour et retire les stations disparues', async () => {
    process.env.CRON_SECRET = 'cron-secret';
    const auth = { headers: { Authorization: 'Bearer cron-secret' } };
    gbfs.info = [info('1', 'Gare'), info('2', 'Zoo'), info('3', 'Cirque')];
    await api.post('/cron/refresh-stations', auth);

    gbfs.info = [info('1', 'Gare SNCF'), info('2', 'Zoo'), info('4', 'Nouvelle')];
    const res = await api.post('/cron/refresh-stations', auth);
    assert.equal(res.status, 200);
    assert.deepEqual({ count: res.body.count, removed: res.body.removed }, { count: 3, removed: 1 });
    const { rows } = await dbc.query('SELECT station_id, name FROM stations ORDER BY station_id');
    assert.deepEqual(rows.map((r) => [r.station_id, r.name]), [['1', 'Gare SNCF'], ['2', 'Zoo'], ['4', 'Nouvelle']]);
  });

  test('flux partiel (moins de la moitié) : aucune suppression', async () => {
    process.env.CRON_SECRET = 'cron-secret';
    const auth = { headers: { Authorization: 'Bearer cron-secret' } };
    gbfs.info = [info('1', 'A'), info('2', 'B'), info('3', 'C'), info('4', 'D')];
    await api.post('/cron/refresh-stations', auth);
    gbfs.info = [info('1', 'A')];
    const res = await api.post('/cron/refresh-stations', auth);
    assert.equal(res.body.removed, 0);
    assert.equal(Number((await dbc.get('SELECT COUNT(*) AS n FROM stations')).n), 4);
  });

  test('cron refresh-stations : protégé, 502 si GBFS en panne', async () => {
    process.env.CRON_SECRET = 'cron-secret';
    assert.equal((await api.post('/cron/refresh-stations')).status, 401);
    gbfs.fail = true;
    assert.equal((await api.post('/cron/refresh-stations', { headers: { Authorization: 'Bearer cron-secret' } })).status, 502);
  });
});
