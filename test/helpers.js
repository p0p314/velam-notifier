// Outils partagés des tests backend (node:test). À importer EN PREMIER dans chaque
// fichier de test : fixe l'environnement avant que les modules applicatifs ne
// soient chargés (le choix SQLite/Postgres se fait au require de database/).
//
// - Sans DATABASE_URL : SQLite en mémoire, base neuve par fichier (process isolé).
// - Avec DATABASE_URL (CI) : Postgres réel, vidé par resetDb() entre les tests.

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'secret-de-test';
process.env.RATE_LIMIT_DISABLED = '1';
process.env.STATUS_CACHE_TTL_MS = '1'; // cache GBFS quasi nul : chaque test voit ses données
if (!process.env.DATABASE_URL) process.env.SQLITE_PATH = ':memory:';
delete process.env.VAPID_PUBLIC_KEY;
delete process.env.VAPID_PRIVATE_KEY;

// Logs applicatifs silencieux (les erreurs restent visibles via console.error si DEBUG).
if (!process.env.DEBUG) {
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
}

const { after } = require('node:test');
const { dbc } = require('../database');

// Ferme la connexion en fin de fichier (sinon le pool Postgres retient le process).
after(() => dbc.close());
const { initialize } = require('../db');
const { initAuth } = require('../auth');
const { initPush } = require('../push');

let booted = null;

/** Initialise base + auth + push une seule fois par fichier de test. */
function boot() {
  booted ??= (async () => {
    await initialize();
    await initAuth();
    await initPush();
  })();
  return booted;
}

/** Vide toutes les tables métier (ordre compatible avec les clés étrangères). */
async function resetDb() {
  await boot();
  for (const t of ['alerts', 'push_subscriptions', 'favorites', 'users', 'stations', 'rental_apps']) {
    await dbc.run(`DELETE FROM ${t}`);
  }
}

/** Démarre l'app Express sur un port libre. Renvoie { url, close }. */
async function startServer() {
  await boot();
  const { app } = require('../app');
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => server.close(r)),
  };
}

// ── Faux flux GBFS ─────────────────────────────────────────────────────────────
// gbfs.js utilise le fetch global : on intercepte uniquement api.cyclocity.fr,
// les appels HTTP vers le serveur de test passent par le vrai fetch.

const realFetch = global.fetch;
const gbfs = {
  info:   [],
  status: [],
  system: { name: 'Vélam', rental_apps: {} },
  fail:   false, // true → le flux répond HTTP 503
  calls:  { info: 0, status: 0, system: 0 },
};

global.fetch = async (input, init) => {
  const url = String(input);
  if (!url.includes('api.cyclocity.fr')) return realFetch(input, init);
  const kind = url.includes('station_information') ? 'info'
    : url.includes('station_status') ? 'status' : 'system';
  gbfs.calls[kind]++;
  if (gbfs.fail) return new Response('indisponible', { status: 503 });
  const data = kind === 'system' ? gbfs.system : { stations: gbfs[kind] };
  return new Response(JSON.stringify({ data }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

function resetGbfs() {
  gbfs.info = [];
  gbfs.status = [];
  gbfs.system = { name: 'Vélam', rental_apps: {} };
  gbfs.fail = false;
  gbfs.calls = { info: 0, status: 0, system: 0 };
}

/** Attend que le cache de statut GBFS (TTL 1 ms) soit expiré. */
const expireCache = () => new Promise((r) => setTimeout(r, 5));

// ── Client HTTP de test ───────────────────────────────────────────────────────

function client(baseUrl) {
  const call = async (method, path, { body, token, headers = {} } = {}) => {
    const h = { ...headers };
    if (body !== undefined) h['Content-Type'] = 'application/json';
    if (token) h.Authorization = `Bearer ${token}`;
    const res = await realFetch(baseUrl + path, {
      method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* HTML ou vide */ }
    return { status: res.status, body: json, text, headers: res.headers };
  };
  return {
    get:    (p, o) => call('GET', p, o),
    post:   (p, o) => call('POST', p, o),
    patch:  (p, o) => call('PATCH', p, o),
    put:    (p, o) => call('PUT', p, o),
    delete: (p, o) => call('DELETE', p, o),
  };
}

let userSeq = 0;
/** Crée un compte via l'API et renvoie { token, user }. */
async function registerUser(api, username = `user${Date.now()}_${++userSeq}`) {
  const res = await api.post('/api/auth/register', { body: { username, password: 'motdepasse1' } });
  if (res.status !== 201) throw new Error(`inscription échouée : ${res.status} ${res.text}`);
  return res.body;
}

/** Subscription Web Push factice (forme renvoyée par PushManager.subscribe). */
const fakeSubscription = (id = 'abc') => ({
  endpoint: `https://push.example.com/send/${id}`,
  expirationTime: null,
  keys: { p256dh: 'cle-p256dh', auth: 'cle-auth' },
});

module.exports = {
  dbc, boot, resetDb, startServer, gbfs, resetGbfs, expireCache,
  client, registerUser, fakeSubscription,
};
