// Plusieurs villes de vélos : stations d'une seule ville à la fois (identifiants préfixés
// hors Amiens), référentiel par ville, ville du compte, boucle d'alerte, page /open.
const { resetDb, startServer, client, registerUser, gbfs, resetGbfs, expireCache, dbc, fakeSubscription } = require('./helpers');
const { test, before, after, beforeEach, describe } = require('node:test');
const assert = require('node:assert/strict');

let srv, api;
before(async () => { srv = await startServer(); api = client(srv.url); });
after(() => srv.close());
beforeEach(async () => { await resetDb(); resetGbfs(); await expireCache(); });

const info = (id, name, lat = 49.89, lon = 2.29) => ({ station_id: id, name, address: '', lat, lon, capacity: 20 });
const live = (id, bikes) => ({
  station_id: id, num_bikes_available: bikes, num_docks_available: 10, is_renting: true, is_returning: true,
  vehicle_types_available: [{ vehicle_type_id: 'mechanical', count: bikes }],
});

function twoCities() {
  gbfs.info = [info('1', 'Gare du Nord')];
  gbfs.status = [live('1', 4)];
  gbfs.byCity.lyon = { info: [info('1', 'Bellecour', 45.757, 4.832), info('2', 'Part-Dieu', 45.760, 4.859)], status: [live('1', 7), live('2', 0)] };
}

describe('stations par ville', () => {
  test('?city=lyon : seulement Lyon, identifiants préfixés, flux de Lyon seul', async () => {
    twoCities();
    const res = await api.get('/api/stations?city=lyon');
    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.city, 'lyon');
    assert.deepEqual(res.body.stations.map((s) => [s.station_id, s.name, s.total_bikes]), [['lyon:1', 'Bellecour', 7], ['lyon:2', 'Part-Dieu', 0]]);
    assert.deepEqual([...new Set(gbfs.cities)], ['lyon']);
  });

  test('sans ville : Amiens (identifiants inchangés) ; les deux référentiels coexistent', async () => {
    twoCities();
    await api.get('/api/stations?city=lyon');
    const res = await api.get('/api/stations');
    assert.deepEqual(res.body.stations.map((s) => [s.station_id, s.name]), [['1', 'Gare du Nord']]);
    const n = await dbc.get('SELECT COUNT(*) AS n FROM stations');
    assert.equal(Number(n.n), 3);
  });

  test('ville inconnue → 400, aucun appel', async () => {
    const res = await api.get('/api/stations?city=paris');
    assert.equal(res.status, 400);
    assert.equal(gbfs.calls.info + gbfs.calls.status, 0);
  });

  test('rafraîchissement quotidien : chaque ville en base, sans toucher aux autres', async () => {
    twoCities();
    await api.get('/api/stations?city=lyon');
    await api.get('/api/stations');
    gbfs.byCity.lyon.info = [info('1', 'Bellecour'), info('2', 'Part-Dieu'), info('3', 'Perrache')];
    const { refreshStationCatalog } = require('../routes/stations');
    const r = await refreshStationCatalog();
    assert.deepEqual(r.cities.sort(), ['amiens', 'lyon']);
    const rows = await dbc.query("SELECT station_id FROM stations WHERE city = 'lyon' ORDER BY station_id");
    assert.deepEqual(rows.rows.map((x) => x.station_id), ['lyon:1', 'lyon:2', 'lyon:3']);
    const amiens = await dbc.query("SELECT station_id FROM stations WHERE city = 'amiens'");
    assert.deepEqual(amiens.rows.map((x) => x.station_id), ['1']);
  });
});

describe('ville du compte', () => {
  test('Amiens par défaut, choix d\'une autre ville, refus d\'une ville inconnue', async () => {
    const { token, user } = await registerUser(api, 'alice');
    assert.equal(user.city, 'amiens');
    assert.equal((await api.put('/api/auth/city', { body: { city: 'lyon' } })).status, 401);
    const ok = await api.put('/api/auth/city', { token, body: { city: 'lyon' } });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.body.user.city, 'lyon');
    assert.equal((await api.get('/api/auth/me', { token })).body.user.city, 'lyon');
    assert.equal((await api.put('/api/auth/city', { token, body: { city: 'paris' } })).status, 400);
    assert.equal((await api.put('/api/auth/city', { token, body: {} })).status, 400);
    assert.equal((await api.get('/api/auth/export', { token })).body.export.account.bike_city, 'lyon');
  });
});

describe('boucle d\'alerte', () => {
  const { checkAlerts } = require('../push');
  const webpush = require('web-push');
  let sent;
  before(() => { webpush.sendNotification = async (sub, payload) => { sent.push(JSON.parse(payload)); }; });
  beforeEach(() => { sent = []; });

  const WED_0830 = new Date('2026-10-07T06:30:00Z'); // 08:30 à Paris
  async function setup(city) {
    const { createUser, createAlert, addSubscription } = require('../db');
    const user = await createUser(`u${Date.now()}${Math.random()}`, 'x');
    await dbc.run('UPDATE users SET bike_city = ? WHERE id = ?', [city, user.id]);
    await addSubscription(user.id, fakeSubscription(`tel${user.id}`));
    const base = { bike_type: 'any', threshold: 2, time_start: '08:00', time_end: '09:00', days: '1,2,3,4,5,6,7' };
    await createAlert(user.id, { ...base, station_id: 'lyon:2', station_name: 'Part-Dieu' });
    await createAlert(user.id, { ...base, station_id: '1', station_name: 'Gare du Nord' });
    gbfs.status = [live('1', 0)];
    gbfs.byCity.lyon = { info: [], status: [live('2', 0)] };
    return user;
  }

  test('seules les alertes de la ville du compte sont vérifiées (et sa ville seule interrogée)', async () => {
    await setup('lyon');
    await checkAlerts(WED_0830);
    assert.equal(sent.length, 1);
    assert.match(sent[0].body + sent[0].title, /Part-Dieu/);
    assert.match(sent[0].url, /\/open\?.*city=lyon/);
    assert.deepEqual([...new Set(gbfs.cities)], ['lyon']);
  });

  test('compte resté sur Amiens : l\'alerte de Lyon est ignorée', async () => {
    await setup('amiens');
    await checkAlerts(WED_0830);
    assert.equal(sent.length, 1);
    assert.match(sent[0].body + sent[0].title, /Gare du Nord/);
    assert.doesNotMatch(sent[0].url, /city=/);
    assert.deepEqual([...new Set(gbfs.cities)], ['amiens']);
  });
});

describe('/open', () => {
  test('ville d\'une autre alerte : son service et son site, sans les stores de Vélam', async () => {
    const res = await api.get('/open?city=lyon');
    assert.equal(res.status, 200);
    assert.match(res.text, /Ouvrir l'app Vélo&#39;v|Ouvrir l'app Vélo'v/);
    assert.match(res.text, /href="https:\/\/velov\.grandlyon\.com\/"/);
    const def = await api.get('/open?city=inconnue');
    assert.match(def.text, /Ouvrir l'app Vélam/);
  });
});

describe('alertes', () => {
  test('une alerte ne mélange pas les villes (trajet, groupe)', async () => {
    const { token } = await registerUser(api, 'bob');
    const base = { bike_type: 'any', threshold: 2, time_start: '08:00', time_end: '09:00', days: '1,2,3,4,5' };
    const ok = await api.post('/api/alerts', { token, body: { ...base, station_id: 'lyon:1', station_name: 'Bellecour' } });
    assert.equal(ok.status, 201, ok.text);
    const trip = await api.post('/api/alerts', { token, body: { ...base, station_id: 'lyon:1', station_name: 'Bellecour', arrival_station_id: '1', arrival_station_name: 'Gare', arrival_threshold: 2 } });
    assert.equal(trip.status, 400);
    assert.match(trip.body.error, /même ville/);
    const group = await api.post('/api/alerts', { token, body: { ...base, group_stations: [{ station_id: '1', station_name: 'Gare' }, { station_id: 'lyon:2', station_name: 'Part-Dieu' }] } });
    assert.equal(group.status, 400);
  });
});
