// Intégration : inscription, connexion, session glissante (/me), middleware JWT.
const { resetDb, startServer, client, registerUser, fakeSubscription, dbc } = require('./helpers');
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
  assert.deepEqual(res.body.user, { id: user.id, username: 'alice', tutorial_done: false });
  const payload = jwt.decode(res.body.token);
  assert.equal(payload.id, user.id);
  // Durée par défaut : 30 jours
  assert.equal(payload.exp - payload.iat, 30 * 24 * 3600);
});

test('tutoriel : proposé au nouveau compte, puis plus après POST /api/auth/tutorial', async () => {
  const { token, user } = await registerUser(api, 'alice');
  assert.equal(user.tutorial_done, false);
  assert.equal((await api.post('/api/auth/tutorial', {})).status, 401);
  assert.equal((await api.post('/api/auth/tutorial', { token })).status, 200);
  assert.equal((await api.get('/api/auth/me', { token })).body.user.tutorial_done, true);
  const login = await api.post('/api/auth/login', { body: { username: 'alice', password: 'motdepasse1' } });
  assert.equal(login.body.user.tutorial_done, true);
});

test('/api/auth/me : compte supprimé → 401', async () => {
  const { dbc } = require('./helpers');
  const { token } = await registerUser(api, 'alice');
  await dbc.run('DELETE FROM sessions');
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

// ── Révocation des sessions ─────────────────────────────────────────────────

/** Deuxième appareil connecté au même compte (+ son abonnement push). */
async function secondDevice(name = 'tel2') {
  const login = await api.post('/api/auth/login', { body: { username: 'alice', password: 'motdepasse1' } });
  await api.post('/api/push/subscribe', { token: login.body.token, body: { subscription: fakeSubscription(name) } });
  return login.body.token;
}
const endpoints = async () =>
  (await dbc.query('SELECT endpoint FROM push_subscriptions ORDER BY endpoint')).rows.map((r) => r.endpoint);

test('déconnecter les autres appareils : leurs jetons et notifications sont révoqués, pas ceux de cet appareil', async () => {
  const { token } = await registerUser(api, 'alice');
  const here = fakeSubscription('ici');
  await api.post('/api/push/subscribe', { token, body: { subscription: here } });
  const other = await secondDevice();

  const res = await api.post('/api/auth/logout-others', { token, body: { endpoint: here.endpoint } });
  assert.equal(res.status, 200);
  assert.equal(res.body.devices, 1);
  assert.ok(res.body.token && res.body.token !== token);

  assert.equal((await api.get('/api/favorites', { token: other })).status, 401);
  // Ancien jeton de cet appareil aussi : une copie volée ne survit pas (session renouvelée).
  assert.equal((await api.get('/api/favorites', { token })).status, 401);
  assert.equal((await api.get('/api/favorites', { token: res.body.token })).status, 200);
  assert.deepEqual(await endpoints(), [here.endpoint]);

  // Le jeton neuf est renouvelable (session glissante) et une reconnexion fonctionne.
  assert.equal((await api.get('/api/auth/me', { token: res.body.token })).status, 200);
  assert.equal((await api.post('/api/auth/login', { body: { username: 'alice', password: 'motdepasse1' } })).status, 200);
});

test('déconnecter les autres appareils sans endpoint : tous les appareils sont détachés des notifications', async () => {
  const { token } = await registerUser(api, 'alice');
  await secondDevice();
  const res = await api.post('/api/auth/logout-others', { token, body: {} });
  assert.equal(res.status, 200);
  assert.deepEqual(await endpoints(), []);
  assert.equal((await api.post('/api/auth/logout-others', { token, body: { endpoint: 'http://x' } })).status, 401); // jeton révoqué
  assert.equal((await api.post('/api/auth/logout-others', { token: res.body.token, body: { endpoint: 'http://x' } })).status, 400);
});

test('changer de mot de passe déconnecte les autres appareils et renvoie un jeton neuf', async () => {
  const { token } = await registerUser(api, 'alice');
  const here = fakeSubscription('ici');
  await api.post('/api/push/subscribe', { token, body: { subscription: here } });
  const other = await secondDevice();

  const res = await api.put('/api/auth/password', { token, body: {
    current_password: 'motdepasse1', new_password: 'nouveau-mdp-42', endpoint: here.endpoint,
  } });
  assert.equal(res.status, 200);
  assert.equal(res.body.user.username, 'alice');
  assert.equal((await api.get('/api/favorites', { token: other })).status, 401);
  assert.equal((await api.get('/api/favorites', { token: res.body.token })).status, 200);
  assert.deepEqual(await endpoints(), [here.endpoint]);
});

test('jeton émis avant la révocation (sans version) : accepté tant qu\'aucune révocation n\'a eu lieu', async () => {
  const { user } = await registerUser(api, 'alice');
  const legacy = jwt.sign({ id: user.id, username: 'alice' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  assert.equal((await api.get('/api/favorites', { token: legacy })).status, 200);
});

// ── Appareils connectés (sessions) ──────────────────────────────────────────

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';
const loginFrom = async (ua) => (await api.post('/api/auth/login', {
  body: { username: 'alice', password: 'motdepasse1' }, headers: { 'User-Agent': ua },
})).body.token;

test('liste des appareils : nom lisible, appareil courant signalé, plus récent d\'abord', async () => {
  const { token } = await registerUser(api, 'alice');
  const phone = await loginFrom(IPHONE_UA);
  const res = await api.get('/api/auth/sessions', { token: phone });
  assert.equal(res.status, 200);
  assert.equal(res.body.sessions.length, 2);
  const [first, second] = res.body.sessions;
  assert.equal(first.label, 'iPhone · Safari');
  assert.equal(first.current, true);
  assert.equal(second.current, false);
  assert.ok(first.last_seen_at >= second.last_seen_at);
  assert.equal(typeof first.created_at, 'number');
  assert.ok(token);
});

test('déconnecter un autre appareil : son jeton et ses notifications sont révoqués', async () => {
  const { token } = await registerUser(api, 'alice');
  const phone = await loginFrom(IPHONE_UA);
  await api.post('/api/push/subscribe', { token: phone, body: { subscription: fakeSubscription('tel') } });
  await api.post('/api/push/subscribe', { token, body: { subscription: fakeSubscription('pc') } });

  const phoneId = (await api.get('/api/auth/sessions', { token })).body.sessions.find((s) => !s.current).id;
  assert.equal((await api.delete(`/api/auth/sessions/${phoneId}`, { token })).status, 200);
  assert.equal((await api.get('/api/favorites', { token: phone })).status, 401);
  assert.equal((await api.get('/api/favorites', { token })).status, 200);
  assert.deepEqual(await endpoints(), [fakeSubscription('pc').endpoint]);
  assert.equal((await api.delete(`/api/auth/sessions/${phoneId}`, { token })).status, 404);
});

test('déconnecter un appareil : pas cet appareil (400), pas celui d\'un autre compte (404)', async () => {
  const { token } = await registerUser(api, 'alice');
  const bob = await registerUser(api, 'bob');
  const mine = (await api.get('/api/auth/sessions', { token })).body.sessions[0].id;
  const bobs = (await api.get('/api/auth/sessions', { token: bob.token })).body.sessions[0].id;
  assert.equal((await api.delete(`/api/auth/sessions/${mine}`, { token })).status, 400);
  assert.equal((await api.delete(`/api/auth/sessions/${bobs}`, { token })).status, 404);
  assert.equal((await api.get('/api/favorites', { token: bob.token })).status, 200);
});

test('se déconnecter ferme la session de cet appareil', async () => {
  const { token } = await registerUser(api, 'alice');
  const phone = await loginFrom(IPHONE_UA);
  assert.equal((await api.post('/api/auth/logout', { token: phone })).status, 200);
  assert.equal((await api.get('/api/favorites', { token: phone })).status, 401);
  assert.equal((await api.get('/api/auth/sessions', { token })).body.sessions.length, 1);
});

test('jeton d\'avant les sessions : /me lui ouvre une session (listée ensuite)', async () => {
  const { user } = await registerUser(api, 'alice');
  await dbc.run('DELETE FROM sessions');
  const legacy = jwt.sign({ id: user.id, username: 'alice' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const me = await api.get('/api/auth/me', { token: legacy });
  assert.equal(me.status, 200);
  assert.ok(jwt.decode(me.body.token).sid);
  const list = await api.get('/api/auth/sessions', { token: me.body.token });
  assert.equal(list.body.sessions.length, 1);
  assert.equal(list.body.sessions[0].current, true);
});

test('sessions expirées (inactives au-delà de la durée du jeton) purgées de la liste', async () => {
  const { token } = await registerUser(api, 'alice');
  await loginFrom(IPHONE_UA);
  await dbc.run('UPDATE sessions SET last_seen_at = 1 WHERE user_agent = ?', [IPHONE_UA]);
  const res = await api.get('/api/auth/sessions', { token });
  assert.equal(res.body.sessions.length, 1);
  assert.equal(res.body.sessions[0].current, true);
});

test('abonnement push rattaché à la session de l\'appareil', async () => {
  const { token } = await registerUser(api, 'alice');
  await api.post('/api/push/subscribe', { token, body: { subscription: fakeSubscription('ici') } });
  const row = await dbc.get('SELECT session_id FROM push_subscriptions');
  assert.equal(row.session_id, jwt.decode(token).sid);
});

// ── Export des données (RGPD) ───────────────────────────────────────────────

test('export : compte, favoris, alertes, appareils — jamais le mot de passe', async () => {
  const { token } = await registerUser(api, 'alice');
  await api.post('/api/favorites', { token, body: { station_id: '1', station_name: 'Gare' } });
  await api.post('/api/alerts', { token, body: {
    station_id: '1', station_name: 'Gare', threshold: 1, time_start: '08:00', time_end: '09:00',
  } });
  await api.post('/api/push/subscribe', { token, body: { subscription: fakeSubscription('ici') } });

  const res = await api.get('/api/auth/export', { token });
  assert.equal(res.status, 200);
  const data = res.body.export;
  assert.equal(data.account.username, 'alice');
  assert.equal(data.favorites.length, 1);
  assert.equal(data.favorites[0].station_name, 'Gare');
  assert.equal(data.alerts.length, 1);
  assert.equal(data.alerts[0].user_id, undefined);
  assert.equal(data.devices.length, 1);
  assert.equal(data.notification_devices, 1);
  assert.ok(!/password|hash|motdepasse1|p256dh/i.test(res.text));
  assert.equal((await api.get('/api/auth/export')).status, 401);
});
