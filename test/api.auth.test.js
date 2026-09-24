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
