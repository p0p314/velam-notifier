// Intégration : inscription, connexion, session glissante (/me), middleware JWT.
const { resetDb, startServer, client, registerUser } = require('./helpers');
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

let srv, api;
before(async () => { srv = await startServer(); api = client(srv.url); });
after(() => srv.close());
beforeEach(resetDb);

test('inscription → 201 + jeton utilisable', async () => {
  const { token, user } = await registerUser(api, 'alice');
  assert.equal(user.username, 'alice');
  const res = await api.get('/api/favorites', { token });
  assert.equal(res.status, 200);
});

test('inscription : validations', async () => {
  const cases = [
    [{ username: '', password: 'motdepasse1' }, 400],
    [{ username: 'bob', password: 'court' }, 400],
    [{ username: 'x'.repeat(33), password: 'motdepasse1' }, 400],
  ];
  for (const [body, status] of cases) {
    assert.equal((await api.post('/api/auth/register', { body })).status, status, JSON.stringify(body));
  }
});

test('inscription : nom déjà pris → 409', async () => {
  await registerUser(api, 'alice');
  const res = await api.post('/api/auth/register', { body: { username: 'alice', password: 'motdepasse1' } });
  assert.equal(res.status, 409);
});

test('connexion : bons / mauvais identifiants', async () => {
  await registerUser(api, 'alice');
  const ok = await api.post('/api/auth/login', { body: { username: ' alice ', password: 'motdepasse1' } });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.token);
  assert.equal(ok.body.user.username, 'alice');
  assert.equal(ok.body.user.password_hash, undefined, 'le hash ne doit jamais sortir');

  const ko = await api.post('/api/auth/login', { body: { username: 'alice', password: 'mauvais-mdp' } });
  assert.equal(ko.status, 401);
  const inconnu = await api.post('/api/auth/login', { body: { username: 'personne', password: 'motdepasse1' } });
  assert.equal(inconnu.status, 401);
});

test('le mot de passe est stocké haché', async () => {
  const { dbc } = require('./helpers');
  await registerUser(api, 'alice');
  const row = await dbc.get('SELECT password_hash FROM users WHERE username = ?', ['alice']);
  assert.notEqual(row.password_hash, 'motdepasse1');
  assert.match(row.password_hash, /^\$2[aby]\$10\$/);
});

test('/api/auth/me renvoie un jeton neuf (session glissante)', async () => {
  const { token, user } = await registerUser(api, 'alice');
  const res = await api.get('/api/auth/me', { token });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.user, { id: user.id, username: 'alice' });
  const payload = jwt.decode(res.body.token);
  assert.equal(payload.id, user.id);
  // Durée par défaut : 30 jours
  assert.equal(payload.exp - payload.iat, 30 * 24 * 3600);
});

test('/api/auth/me : compte supprimé → 401', async () => {
  const { dbc } = require('./helpers');
  const { token } = await registerUser(api, 'alice');
  await dbc.run('DELETE FROM users WHERE username = ?', ['alice']);
  assert.equal((await api.get('/api/auth/me', { token })).status, 401);
});

test('requireAuth : absent, mal formé, mauvaise signature, expiré → 401', async () => {
  const { user } = await registerUser(api, 'alice');
  const forged  = jwt.sign({ id: user.id, username: 'alice' }, 'autre-secret');
  const expired = jwt.sign({ id: user.id, username: 'alice' }, process.env.JWT_SECRET, { expiresIn: -10 });
  const noneAlg = jwt.sign({ id: user.id, username: 'alice' }, null, { algorithm: 'none' });

  assert.equal((await api.get('/api/favorites')).status, 401);
  assert.equal((await api.get('/api/favorites', { headers: { Authorization: 'Basic abc' } })).status, 401);
  for (const token of [forged, expired, noneAlg, 'nimporte-quoi']) {
    const res = await api.get('/api/favorites', { token });
    assert.equal(res.status, 401);
    assert.equal(res.body.ok, false);
  }
});

test('changer de mot de passe : l\'ancien ne fonctionne plus, le nouveau oui', async () => {
  const { token } = await registerUser(api, 'alice');
  const res = await api.put('/api/auth/password', { token, body: { current_password: 'motdepasse1', new_password: 'nouveau-mdp-42' } });
  assert.equal(res.status, 200);
  assert.equal((await api.post('/api/auth/login', { body: { username: 'alice', password: 'motdepasse1' } })).status, 401);
  assert.equal((await api.post('/api/auth/login', { body: { username: 'alice', password: 'nouveau-mdp-42' } })).status, 200);
});

test('changer de mot de passe : validations', async () => {
  const { token } = await registerUser(api, 'alice');
  assert.equal((await api.put('/api/auth/password', { token, body: { current_password: 'faux-mdp', new_password: 'nouveau-mdp-42' } })).status, 403);
  assert.equal((await api.put('/api/auth/password', { token, body: { current_password: 'motdepasse1', new_password: 'court' } })).status, 400);
  assert.equal((await api.put('/api/auth/password', { token, body: {} })).status, 400);
  assert.equal((await api.put('/api/auth/password', { body: { current_password: 'a', new_password: 'bbbbbbbb' } })).status, 401);
});

test('supprimer son compte efface toutes ses données', async () => {
  const { dbc } = require('./helpers');
  const { token, user } = await registerUser(api, 'alice');
  const other = await registerUser(api, 'bob');
  await api.post('/api/favorites', { token, body: { station_id: '1', station_name: 'Gare' } });
  await api.post('/api/favorites', { token: other.token, body: { station_id: '1', station_name: 'Gare' } });
  await api.post('/api/alerts', { token, body: { station_id: '1', station_name: 'Gare', time_start: '08:00', time_end: '09:00' } });
  await api.post('/api/push/subscribe', { token, body: { subscription: { endpoint: 'https://push.example.com/a', keys: { p256dh: 'p', auth: 'a' } } } });

  assert.equal((await api.delete('/api/auth/me', { token, body: { password: 'faux' } })).status, 403);
  const res = await api.delete('/api/auth/me', { token, body: { password: 'motdepasse1' } });
  assert.equal(res.status, 200);

  for (const table of ['users', 'favorites', 'alerts', 'push_subscriptions']) {
    const col = table === 'users' ? 'id' : 'user_id';
    const row = await dbc.get(`SELECT COUNT(*) AS n FROM ${table} WHERE ${col} = ?`, [user.id]);
    assert.equal(Number(row.n), 0, table);
  }
  // Les données des autres comptes sont intactes, et le jeton supprimé ne sert plus.
  assert.equal((await api.get('/api/favorites', { token: other.token })).body.favorites.length, 1);
  assert.equal((await api.get('/api/auth/me', { token })).status, 401);
  assert.equal((await api.post('/api/auth/login', { body: { username: 'alice', password: 'motdepasse1' } })).status, 401);
});

test('supprimer son compte : mot de passe requis, sans compte → 401', async () => {
  const { token } = await registerUser(api, 'alice');
  assert.equal((await api.delete('/api/auth/me', { token, body: {} })).status, 400);
  assert.equal((await api.delete('/api/auth/me', { body: { password: 'x' } })).status, 401);
});
