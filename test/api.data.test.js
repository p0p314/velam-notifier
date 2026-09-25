// Intégration : favoris et alertes (CRUD, validation, isolation entre comptes).
const { resetDb, startServer, client, registerUser } = require('./helpers');
const { test, before, after, beforeEach, describe } = require('node:test');
const assert = require('node:assert/strict');

let srv, api;
before(async () => { srv = await startServer(); api = client(srv.url); });
after(() => srv.close());
beforeEach(resetDb);

describe('favoris', () => {
  test('ajout, idempotence, tri, suppression', async () => {
    const { token } = await registerUser(api);
    await api.post('/api/favorites', { token, body: { station_id: '2', station_name: 'zoo' } });
    await api.post('/api/favorites', { token, body: { station_id: '1', station_name: 'Gare' } });
    const again = await api.post('/api/favorites', { token, body: { station_id: '1', station_name: 'Gare du Nord' } });
    assert.equal(again.status, 201);
    const brief = (list) => list.map(({ station_id, station_name }) => ({ station_id, station_name }));
    assert.deepEqual(brief(again.body.favorites), [
      { station_id: '1', station_name: 'Gare du Nord' }, // renommé, pas dupliqué
      { station_id: '2', station_name: 'zoo' },          // tri insensible à la casse
    ]);

    const del = await api.delete('/api/favorites/1', { token });
    assert.deepEqual(brief(del.body.favorites), [{ station_id: '2', station_name: 'zoo' }]);
  });

  test('payload incomplet → 400', async () => {
    const { token } = await registerUser(api);
    assert.equal((await api.post('/api/favorites', { token, body: { station_id: '1' } })).status, 400);
  });

  test('les favoris sont propres à chaque compte', async () => {
    const a = await registerUser(api);
    const b = await registerUser(api);
    await api.post('/api/favorites', { token: a.token, body: { station_id: '1', station_name: 'Gare' } });
    assert.deepEqual((await api.get('/api/favorites', { token: b.token })).body.favorites, []);
  });
});

describe('alertes', () => {
  const body = {
    station_id: '1', station_name: 'Gare', bike_type: 'mechanical',
    threshold: 2, time_start: '07:30', time_end: '09:00', days: '1,2,3,4,5',
  };

  test('création puis lecture', async () => {
    const { token } = await registerUser(api);
    const created = await api.post('/api/alerts', { token, body });
    assert.equal(created.status, 201);
    assert.equal(created.body.alert.threshold, 2);
    assert.equal(created.body.alert.target, 'bikes');
    assert.equal(created.body.alert.comparison, 'at_most');
    assert.equal(created.body.alert.active, 1);
    assert.equal(created.body.alert.days, '1,2,3,4,5');

    const list = await api.get('/api/alerts', { token });
    assert.equal(list.body.alerts.length, 1);
  });

  test('création invalide → 400 avec la liste des champs', async () => {
    const { token } = await registerUser(api);
    const res = await api.post('/api/alerts', { token, body: { ...body, bike_type: 'x', time_end: '25:00' } });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /bike_type/);
    assert.match(res.body.error, /time_end/);
  });

  test('mise à jour partielle et désactivation', async () => {
    const { token } = await registerUser(api);
    const { body: { alert } } = await api.post('/api/alerts', { token, body });
    const res = await api.patch(`/api/alerts/${alert.id}`, { token, body: { active: false, threshold: 5 } });
    assert.equal(res.status, 200);
    assert.equal(res.body.alert.active, 0);
    assert.equal(res.body.alert.threshold, 5);
    assert.equal(res.body.alert.time_start, '07:30'); // inchangé
  });

  test('PATCH invalide → 400', async () => {
    const { token } = await registerUser(api);
    const { body: { alert } } = await api.post('/api/alerts', { token, body });
    assert.equal((await api.patch(`/api/alerts/${alert.id}`, { token, body: { days: '0' } })).status, 400);
  });

  test('suppression', async () => {
    const { token } = await registerUser(api);
    const { body: { alert } } = await api.post('/api/alerts', { token, body });
    assert.equal((await api.delete(`/api/alerts/${alert.id}`, { token })).status, 200);
    assert.equal((await api.delete(`/api/alerts/${alert.id}`, { token })).status, 404);
  });

  test('identifiant non numérique → 404 (pas 500)', async () => {
    const { token } = await registerUser(api);
    assert.equal((await api.patch('/api/alerts/abc', { token, body: { active: false } })).status, 404);
    assert.equal((await api.delete('/api/alerts/abc', { token })).status, 404);
  });

  test('impossible de modifier / supprimer l\'alerte d\'un autre compte', async () => {
    const a = await registerUser(api);
    const b = await registerUser(api);
    const { body: { alert } } = await api.post('/api/alerts', { token: a.token, body });
    assert.equal((await api.patch(`/api/alerts/${alert.id}`, { token: b.token, body: { active: false } })).status, 404);
    assert.equal((await api.delete(`/api/alerts/${alert.id}`, { token: b.token })).status, 404);
    assert.deepEqual((await api.get('/api/alerts', { token: b.token })).body.alerts, []);
  });
});

describe('alertes v1.1', () => {
  const body = {
    station_id: '1', station_name: 'Gare', bike_type: 'any',
    threshold: 1, time_start: '07:30', time_end: '09:00',
  };
  const { nowInTz, addDays } = require('../time');
  const today = () => nowInTz().date;

  test('places, « au moins N » et trajet enregistrés', async () => {
    const { token } = await registerUser(api);
    const docks = await api.post('/api/alerts', { token, body: { ...body, target: 'docks', comparison: 'at_least', threshold: 3 } });
    assert.equal(docks.status, 201);
    assert.equal(docks.body.alert.target, 'docks');
    assert.equal(docks.body.alert.comparison, 'at_least');

    const trip = await api.post('/api/alerts', { token, body: { ...body, arrival_station_id: '2', arrival_station_name: 'Zoo' } });
    assert.equal(trip.status, 201);
    assert.equal(trip.body.alert.arrival_station_name, 'Zoo');
    assert.equal(trip.body.alert.arrival_threshold, 1);
  });

  test('trajet incohérent → 400', async () => {
    const { token } = await registerUser(api);
    const res = await api.post('/api/alerts', { token, body: { ...body, target: 'docks', arrival_station_id: '2', arrival_station_name: 'Zoo' } });
    assert.equal(res.status, 400);
  });

  test('ponctuelle : du jour acceptée, passée refusée, expirée masquée', async () => {
    const { token, user } = await registerUser(api);
    assert.equal((await api.post('/api/alerts', { token, body: { ...body, valid_on: today() } })).status, 201);
    assert.equal((await api.post('/api/alerts', { token, body: { ...body, valid_on: addDays(today(), -1) } })).status, 400);

    // Une ponctuelle d'hier encore en base (serveur endormi) n'apparaît plus.
    const { dbc } = require('./helpers');
    await dbc.run(`INSERT INTO alerts (user_id, station_id, station_name, bike_type, time_start, time_end, valid_on)
                   VALUES (?, '9', 'Vieille', 'any', '08:00', '09:00', ?)`, [user.id, addDays(today(), -1)]);
    const list = await api.get('/api/alerts', { token });
    assert.deepEqual(list.body.alerts.map((a) => a.station_name), ['Gare']);
  });

  test('PATCH : un changement de mode incohérent est refusé', async () => {
    const { token } = await registerUser(api);
    const { body: { alert } } = await api.post('/api/alerts', { token, body: { ...body, threshold: 0 } });
    const res = await api.patch(`/api/alerts/${alert.id}`, { token, body: { comparison: 'at_least' } });
    assert.equal(res.status, 400);
  });

  test('pause : poser, lire, reprendre', async () => {
    const { token } = await registerUser(api);
    assert.equal((await api.get('/api/alerts', { token })).body.paused_until, null);

    const until = addDays(today(), 7);
    const put = await api.put('/api/alerts/pause', { token, body: { until } });
    assert.equal(put.status, 200);
    assert.equal((await api.get('/api/alerts', { token })).body.paused_until, until);

    await api.put('/api/alerts/pause', { token, body: { until: null } });
    assert.equal((await api.get('/api/alerts', { token })).body.paused_until, null);
  });

  test('pause : dates invalides → 400, sans compte → 401', async () => {
    const { token } = await registerUser(api);
    for (const until of [addDays(today(), -1), addDays(today(), 400), '2025-13-01', 'demain', 12]) {
      assert.equal((await api.put('/api/alerts/pause', { token, body: { until } })).status, 400, String(until));
    }
    assert.equal((await api.put('/api/alerts/pause', { body: { until: null } })).status, 401);
  });

  test('pause échue → non renvoyée', async () => {
    const { token, user } = await registerUser(api);
    const { setAlertsPause } = require('../db');
    await setAlertsPause(user.id, addDays(today(), -1));
    assert.equal((await api.get('/api/alerts', { token })).body.paused_until, null);
  });
});

describe('favoris nommés et ordonnés', () => {
  const ids = (res) => res.body.favorites.map((f) => f.station_id);
  async function withFavs(names) {
    const { token } = await registerUser(api);
    for (const [id, name] of names) await api.post('/api/favorites', { token, body: { station_id: id, station_name: name } });
    return token;
  }

  test('renommer puis revenir au nom de la station', async () => {
    const token = await withFavs([['1', 'Gare']]);
    const res = await api.patch('/api/favorites/1', { token, body: { label: '  Maison  ' } });
    assert.equal(res.status, 200);
    assert.equal(res.body.favorites[0].label, 'Maison');
    const reset = await api.patch('/api/favorites/1', { token, body: { label: '' } });
    assert.equal(reset.body.favorites[0].label, null);
  });

  test('renommer : validations', async () => {
    const token = await withFavs([['1', 'Gare']]);
    assert.equal((await api.patch('/api/favorites/1', { token, body: { label: 'x'.repeat(41) } })).status, 400);
    assert.equal((await api.patch('/api/favorites/1', { token, body: { label: 12 } })).status, 400);
    assert.equal((await api.patch('/api/favorites/9', { token, body: { label: 'Maison' } })).status, 404);
  });

  test('ordre personnalisé, conservé après ajout (nouveau en fin)', async () => {
    const token = await withFavs([['1', 'Alpha'], ['2', 'Bravo'], ['3', 'Charlie']]);
    const res = await api.put('/api/favorites/order', { token, body: { station_ids: ['3', '1', '2'] } });
    assert.deepEqual(ids(res), ['3', '1', '2']);
    const added = await api.post('/api/favorites', { token, body: { station_id: '0', station_name: 'Aaa' } });
    assert.deepEqual(ids(added), ['3', '1', '2', '0']);
  });

  test('ordre partiel : les favoris omis suivent, les inconnus sont ignorés', async () => {
    const token = await withFavs([['1', 'Alpha'], ['2', 'Bravo'], ['3', 'Charlie']]);
    const res = await api.put('/api/favorites/order', { token, body: { station_ids: ['2', 'inconnu', '2'] } });
    assert.deepEqual(ids(res), ['2', '1', '3']);
  });

  test('ordre : payload invalide → 400 ; propre à chaque compte', async () => {
    const token = await withFavs([['1', 'Alpha'], ['2', 'Bravo']]);
    assert.equal((await api.put('/api/favorites/order', { token, body: { station_ids: 'nope' } })).status, 400);
    assert.equal((await api.put('/api/favorites/order', { token, body: { station_ids: [1, 2] } })).status, 400);
    const other = await withFavs([['1', 'Alpha'], ['2', 'Bravo']]);
    await api.put('/api/favorites/order', { token: other, body: { station_ids: ['2', '1'] } });
    assert.deepEqual(ids(await api.get('/api/favorites', { token })), ['1', '2']);
  });
});
