// Intégration : clé VAPID, enregistrement / réattribution / retrait des subscriptions.
const { resetDb, startServer, client, registerUser, fakeSubscription, dbc } = require('./helpers');
const { test, before, after, beforeEach, describe } = require('node:test');
const assert = require('node:assert/strict');
const webpush = require('web-push');

// Faux envoi Web Push : échec simulé pour les endpoints contenant « mort ».
let pushed = [];
webpush.sendNotification = async (sub, payload, options) => {
  if (sub.endpoint.includes('mort')) { const e = new Error('gone'); e.statusCode = 410; throw e; }
  pushed.push({ endpoint: sub.endpoint, payload: JSON.parse(payload), options, sub });
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

test('subscribe : uniquement les services de notification des navigateurs, clés valides', async () => {
  const { token } = await registerUser(api);
  const keys = { p256dh: 'cle-p256dh', auth: 'cle-auth' };
  const post = (endpoint, k = keys) => api.post('/api/push/subscribe', { token, body: { subscription: { endpoint, keys: k } } });
  for (const endpoint of [
    'https://attaquant.example/hang', 'https://fcm.googleapis.com.attaquant.example/x', 'https://fcm.googleapis.com:8443/x',
    'https://user@fcm.googleapis.com/x', 'https://notapple.com/x', 'https://10.0.0.1/x', 'http://fcm.googleapis.com/x',
  ]) assert.equal((await post(endpoint)).status, 400, endpoint);
  assert.equal((await post('https://fcm.googleapis.com/fcm/send/a', { p256dh: 'x', auth: 'cle-auth' })).status, 400);
  assert.equal((await post('https://fcm.googleapis.com/fcm/send/a', { p256dh: { $: 1 }, auth: 'cle-auth' })).status, 400);
  for (const endpoint of [
    'https://fcm.googleapis.com/fcm/send/a', 'https://web.push.apple.com/QGx', 'https://updates.push.services.mozilla.com/wpush/v2/x',
    'https://wns2-par02p.notify.windows.com/w/?token=x',
  ]) assert.equal((await post(endpoint)).status, 201, endpoint);
});

test('10 appareils au plus par compte : les plus anciens sont retirés, jamais l\'appareil courant', async () => {
  const { token, user } = await registerUser(api);
  for (let i = 1; i <= 12; i++) {
    const res = await api.post('/api/push/subscribe', { token, body: { subscription: fakeSubscription(`app${i}`) } });
    assert.equal(res.status, 201);
  }
  const list = await subsOf(user.id);
  assert.equal(list.length, 10);
  assert.ok(list.includes('https://fcm.googleapis.com/fcm/send/app12'));
  assert.ok(!list.includes('https://fcm.googleapis.com/fcm/send/app1'));
  assert.ok(!list.includes('https://fcm.googleapis.com/fcm/send/app2'));
  // Un appareil déjà connu qui se réabonne reste, même s'il est le plus ancien.
  await api.post('/api/push/subscribe', { token, body: { subscription: fakeSubscription('app3') } });
  assert.ok((await subsOf(user.id)).includes('https://fcm.googleapis.com/fcm/send/app3'));
  assert.equal((await subsOf(user.id)).length, 10);
});

test('ré-enregistrer le même appareil ne crée pas de doublon', async () => {
  const { token, user } = await registerUser(api);
  for (let i = 0; i < 3; i++) {
    assert.equal((await api.post('/api/push/subscribe', { token, body: { subscription: fakeSubscription('tel') } })).status, 201);
  }
  assert.deepEqual(await subsOf(user.id), ['https://fcm.googleapis.com/fcm/send/tel']);
});

test('un appareil passe au dernier compte connecté (téléphone partagé)', async () => {
  const a = await registerUser(api);
  const b = await registerUser(api);
  await api.post('/api/push/subscribe', { token: a.token, body: { subscription: fakeSubscription('tel') } });
  await api.post('/api/push/subscribe', { token: b.token, body: { subscription: fakeSubscription('tel') } });
  assert.deepEqual(await subsOf(a.user.id), []);
  assert.deepEqual(await subsOf(b.user.id), ['https://fcm.googleapis.com/fcm/send/tel']);
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
  const other = await api.post('/api/push/unsubscribe', { token: b.token, body: { endpoint: 'https://fcm.googleapis.com/fcm/send/tel' } });
  assert.equal(other.body.removed, false);
  assert.equal((await subsOf(a.user.id)).length, 1);

  const res = await api.post('/api/push/unsubscribe', { token: a.token, body: { endpoint: 'https://fcm.googleapis.com/fcm/send/tel' } });
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
  assert.equal(pushed[0].payload.title, 'Mox — Notification de test');
  // Délai maximal : un service qui ne répond pas ne fige jamais la boucle d'alerte.
  assert.equal(pushed[0].options.timeout, 10_000);
  // Seuls l'endpoint et les clés sont conservés.
  assert.deepEqual(Object.keys(pushed[0].sub).sort(), ['endpoint', 'keys']);
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

describe('types d\'alertes notifiés (compte)', () => {
  const start = startServer; const cl = client; const reg = registerUser;
  test('par défaut tout est notifié ; couper les trains ou les vélos', async () => {
    const srv = await start();
    try {
      const api = cl(srv.url);
      const { token } = await reg(api);
      assert.equal((await api.get('/api/notifications/preferences')).status, 401);
      assert.deepEqual((await api.get('/api/notifications/preferences', { token })).body.preferences, { bikes: true, trains: true });
      const put = await api.put('/api/notifications/preferences', { token, body: { trains: false } });
      assert.deepEqual(put.body.preferences, { bikes: true, trains: false });
      assert.equal((await api.put('/api/notifications/preferences', { token, body: { bikes: 'non' } })).status, 400);
      assert.equal((await api.put('/api/notifications/preferences', { token, body: {} })).status, 400);
      const exp = await api.get('/api/auth/export', { token });
      assert.deepEqual(exp.body.export.account.notifications, { bikes: true, trains: false });
    } finally { await srv.close(); }
  });
});
