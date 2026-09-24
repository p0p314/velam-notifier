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
    assert.deepEqual(again.body.favorites, [
      { station_id: '1', station_name: 'Gare du Nord' }, // renommé, pas dupliqué
      { station_id: '2', station_name: 'zoo' },          // tri insensible à la casse
    ]);

    const del = await api.delete('/api/favorites/1', { token });
    assert.deepEqual(del.body.favorites, [{ station_id: '2', station_name: 'zoo' }]);
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
    min_count: 2, time_start: '07:30', time_end: '09:00', days: '1,2,3,4,5',
  };

  test('création puis lecture', async () => {
    const { token } = await registerUser(api);
    const created = await api.post('/api/alerts', { token, body });
    assert.equal(created.status, 201);
    assert.equal(created.body.alert.min_count, 2);
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
    const res = await api.patch(`/api/alerts/${alert.id}`, { token, body: { active: false, min_count: 5 } });
    assert.equal(res.status, 200);
    assert.equal(res.body.alert.active, 0);
    assert.equal(res.body.alert.min_count, 5);
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
