// Intégration : clé VAPID, enregistrement / réattribution / retrait des subscriptions.
const { resetDb, startServer, client, registerUser, fakeSubscription, dbc } = require('./helpers');
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const webpush = require('web-push');

// Faux envoi Web Push : échec simulé pour les endpoints contenant « mort ».
let pushed = [];
webpush.sendNotification = async (sub, payload) => {
  if (sub.endpoint.includes('mort')) { const e = new Error('gone'); e.statusCode = 410; throw e; }
  pushed.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
};

let srv, api;
before(async () => { srv = await startServer(); api = client(srv.url); });
after(() => srv.close());
beforeEach(async () => { await resetDb(); pushed = []; });

const subsOf = async (userId) =>
  (await dbc.query('SELECT endpoint FROM push_subscriptions WHERE user_id = ?', [userId])).rows.map((r) => r.endpoint);

test('clé publique VAPID exposée publiquement', async () => {
  const res = await api.get('/api/push/vapid-public-key');
  assert.equal(res.status, 200);
  assert.match(res.body.publicKey, /^[A-Za-z0-9_-]{80,}$/);
});

test('subscribe exige un compte', async () => {
  assert.equal((await api.post('/api/push/subscribe', { body: { subscription: fakeSubscription() } })).status, 401);
});

test('subscribe : payload invalide → 400', async () => {
  const { token } = await registerUser(api);
  for (const subscription of [undefined, {}, { endpoint: 'http://x' }, { endpoint: 'https://x' }]) {
    const res = await api.post('/api/push/subscribe', { token, body: { subscription } });
    assert.equal(res.status, 400, JSON.stringify(subscription));
  }
});

test('ré-enregistrer le même appareil ne crée pas de doublon', async () => {
  const { token, user } = await registerUser(api);
  for (let i = 0; i < 3; i++) {
    assert.equal((await api.post('/api/push/subscribe', { token, body: { subscription: fakeSubscription('tel') } })).status, 201);
  }
  assert.deepEqual(await subsOf(user.id), ['https://push.example.com/send/tel']);
});

test('un appareil passe au dernier compte connecté (téléphone partagé)', async () => {
  const a = await registerUser(api);
  const b = await registerUser(api);
  await api.post('/api/push/subscribe', { token: a.token, body: { subscription: fakeSubscription('tel') } });
  await api.post('/api/push/subscribe', { token: b.token, body: { subscription: fakeSubscription('tel') } });
  assert.deepEqual(await subsOf(a.user.id), []);
  assert.deepEqual(await subsOf(b.user.id), ['https://push.example.com/send/tel']);
});

test('plusieurs appareils pour un même compte', async () => {
  const { token, user } = await registerUser(api);
  await api.post('/api/push/subscribe', { token, body: { subscription: fakeSubscription('tel') } });
  await api.post('/api/push/subscribe', { token, body: { subscription: fakeSubscription('pc') } });
  assert.equal((await subsOf(user.id)).length, 2);
});

test('unsubscribe retire uniquement l\'appareil de ce compte', async () => {
  const a = await registerUser(api);
  const b = await registerUser(api);
  await api.post('/api/push/subscribe', { token: a.token, body: { subscription: fakeSubscription('tel') } });

  // Un autre compte ne peut pas détacher l'appareil de A
  const other = await api.post('/api/push/unsubscribe', { token: b.token, body: { endpoint: 'https://push.example.com/send/tel' } });
  assert.equal(other.body.removed, false);
  assert.equal((await subsOf(a.user.id)).length, 1);

  const res = await api.post('/api/push/unsubscribe', { token: a.token, body: { endpoint: 'https://push.example.com/send/tel' } });
  assert.equal(res.status, 200);
  assert.equal(res.body.removed, true);
  assert.deepEqual(await subsOf(a.user.id), []);
});

test('unsubscribe : endpoint invalide → 400, sans compte → 401', async () => {
  const { token } = await registerUser(api);
  assert.equal((await api.post('/api/push/unsubscribe', { token, body: {} })).status, 400);
  assert.equal((await api.post('/api/push/unsubscribe', { body: { endpoint: 'https://x' } })).status, 401);
});

test('notification de test : envoyée à tous les appareils du compte', async () => {
  const { token } = await registerUser(api);
  await api.post('/api/push/subscribe', { token, body: { subscription: fakeSubscription('tel') } });
  await api.post('/api/push/subscribe', { token, body: { subscription: fakeSubscription('pc') } });
  const res = await api.post('/api/push/test', { token });
  assert.equal(res.status, 200);
  assert.deepEqual({ sent: res.body.sent, total: res.body.total }, { sent: 2, total: 2 });
  assert.equal(pushed[0].payload.title, 'VéloPulse — Notification de test');
  assert.match(pushed[0].payload.url, /\/alertes$/);
});

test('notification de test : aucun appareil → 409, sans compte → 401', async () => {
  const { token } = await registerUser(api);
  assert.equal((await api.post('/api/push/test', { token })).status, 409);
  assert.equal((await api.post('/api/push/test')).status, 401);
});

test('notification de test : appareil expiré → 502 et nettoyé', async () => {
  const { token, user } = await registerUser(api);
  await api.post('/api/push/subscribe', { token, body: { subscription: fakeSubscription('mort') } });
  assert.equal((await api.post('/api/push/test', { token })).status, 502);
  assert.deepEqual(await subsOf(user.id), []);
});

test('notification de test : limitée à 5 par tranche de 10 min et par compte', async (t) => {
  const { token } = await registerUser(api);
  await api.post('/api/push/subscribe', { token, body: { subscription: fakeSubscription('tel') } });
  delete process.env.RATE_LIMIT_DISABLED;
  t.after(() => { process.env.RATE_LIMIT_DISABLED = '1'; });
  const codes = [];
  for (let i = 0; i < 6; i++) codes.push((await api.post('/api/push/test', { token })).status);
  assert.deepEqual(codes, [200, 200, 200, 200, 200, 429]);
  // Un autre compte n'est pas pénalisé.
  const other = await registerUser(api);
  await api.post('/api/push/subscribe', { token: other.token, body: { subscription: fakeSubscription('autre') } });
  assert.equal((await api.post('/api/push/test', { token: other.token })).status, 200);
});
