// Sécurité : limites de tentatives de connexion (par IP et par compte).
// Les limites sont coupées dans les autres tests (RATE_LIMIT_DISABLED) ; on les réactive ici.
const { resetDb, startServer, client, registerUser } = require('./helpers');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

let srv, api;
before(async () => { await resetDb(); srv = await startServer(); api = client(srv.url); });
after(() => { process.env.RATE_LIMIT_DISABLED = '1'; return srv.close(); });

// Chaque tentative arrive « d'une autre adresse » (le serveur de test est derrière 1 proxy de confiance).
let ip = 0;
const login = (username, password) => api.post('/api/auth/login', {
  body: { username, password }, headers: { 'X-Forwarded-For': `10.0.${Math.floor(++ip / 250)}.${ip % 250}` },
});

test('compte visé depuis de nombreuses adresses : bloqué après 20 échecs, les autres comptes non', async () => {
  const victim = await registerUser(api, 'victime');
  const other = await registerUser(api, 'autre');
  assert.ok(victim.token && other.token);
  process.env.RATE_LIMIT_DISABLED = '0';
  // Une connexion réussie ne compte pas.
  assert.equal((await login('victime', 'motdepasse1')).status, 200);
  for (let i = 0; i < 20; i++) assert.equal((await login('Victime ', `faux${i}`)).status, 401, `essai ${i}`);
  const blocked = await login('victime', 'motdepasse1');
  assert.equal(blocked.status, 429);
  assert.match(blocked.body.error, /sur ce compte/);
  assert.equal((await login('autre', 'motdepasse1')).status, 200);
});

test('par adresse IP : 10 tentatives par 15 min', async () => {
  process.env.RATE_LIMIT_DISABLED = '0';
  const statuses = [];
  for (let i = 0; i < 11; i++) {
    statuses.push((await api.post('/api/auth/login', { body: { username: `x${i}`, password: 'faux' }, headers: { 'X-Forwarded-For': '10.9.9.9' } })).status);
  }
  assert.deepEqual(statuses.slice(0, 10), Array(10).fill(401));
  assert.equal(statuses[10], 429);
});
