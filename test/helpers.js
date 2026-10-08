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
process.env.GBFS_TIMEOUT_MS = '200';    // délai max d'appel au flux (simulation « ne répond plus »)
if (!process.env.DATABASE_URL) process.env.SQLITE_PATH = ':memory:';
// Module Trains : caches temps réel quasi nuls, cache disque du GTFS isolé par process.
process.env.TRAINS_RT_TTL_MS = '1';
process.env.TRAINS_ALERTS_TTL_MS = '1';
process.env.TRAINS_RT_TIMEOUT_MS = '500';
process.env.TRAINS_CACHE_DIR = require('path').join(require('os').tmpdir(), `velopulse-test-${process.pid}`);
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
  for (const t of ['train_notifications', 'train_alerts', 'train_favorites', 'alerts', 'push_subscriptions', 'favorites', 'sessions', 'users', 'stations', 'rental_apps']) {
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
  hang:   false, // true → le flux ne répond jamais (coupé par le délai max)
  malformed: false, // true → HTTP 200 mais JSON inexploitable
  lastUpdated: undefined, // `last_updated` (s POSIX) renvoyé par station_status
  calls:  { info: 0, status: 0, system: 0 },
  // Autres villes (contrat Cyclocity) : { lyon: { info: [...], status: [...] } } ; sinon les
  // listes ci-dessus. `cities` : villes interrogées, dans l'ordre des appels.
  byCity: {},
  cities: [],
};

// ── Faux flux SNCF (GTFS + GTFS-RT) ──────────────────────────────────────────
// Intercepte eu.ftp.opendatasoft.com (GTFS) et proxy.transport.data.gouv.fr (GTFS-RT).
const sncf = {
  gtfs: null,           // Buffer zip servi pour le GTFS (null → 404)
  lastModified: 'Wed, 07 Oct 2026 08:00:00 GMT',
  tripUpdates: null,    // Buffer protobuf (null → 503)
  alerts: null,         // Buffer protobuf (null → 503)
  vehicles: null,       // Buffer protobuf des positions (flux fictif : la SNCF n'en publie pas)
  siri: null,           // XML SIRI Lite Estimated Timetable (voies) ; null → 503
  failRealtime: false,  // true → les flux GTFS-RT répondent 503
  calls: { gtfs: 0, tripUpdates: 0, alerts: 0, vehicles: 0, siri: 0, conditional: 0 },
};

function sncfResponse(url, init) {
  if (url.includes('opendatasoft.com')) {
    sncf.calls.gtfs++;
    const ims = init?.headers?.['If-Modified-Since'];
    if (ims) sncf.calls.conditional++;
    if (ims && ims === sncf.lastModified) return new Response(null, { status: 304 });
    if (!sncf.gtfs) return new Response('absent', { status: 404 });
    return new Response(sncf.gtfs, { status: 200, headers: { 'Last-Modified': sncf.lastModified } });
  }
  const kind = url.includes('trip-updates') ? 'tripUpdates' : url.includes('vehicle-positions') ? 'vehicles'
    : url.includes('siri-lite-estimated-timetable') ? 'siri' : 'alerts';
  sncf.calls[kind]++;
  if (sncf.failRealtime || !sncf[kind]) return new Response('indisponible', { status: 503 });
  const type = kind === 'siri' ? 'text/xml' : 'application/x-protobuf';
  return new Response(sncf[kind], { status: 200, headers: { 'Content-Type': type } });
}

function resetSncf() {
  const { getProvider } = require('../trains');
  const p = getProvider();
  p.realtime.reset();
  p.platforms?.reset();
  p.schedule.reset();
  require('fs').rmSync(process.env.TRAINS_CACHE_DIR, { recursive: true, force: true }); // cache disque du GTFS
  sncf.gtfs = null;
  sncf.lastModified = 'Wed, 07 Oct 2026 08:00:00 GMT';
  sncf.tripUpdates = null;
  sncf.alerts = null;
  sncf.vehicles = null;
  sncf.siri = null;
  sncf.failRealtime = false;
  sncf.calls = { gtfs: 0, tripUpdates: 0, alerts: 0, vehicles: 0, siri: 0, conditional: 0 };
}

global.fetch = async (input, init) => {
  const url = String(input);
  if (url.includes('opendatasoft.com') || url.includes('proxy.transport.data.gouv.fr')) return sncfResponse(url, init);
  if (!url.includes('api.cyclocity.fr')) return realFetch(input, init);
  const kind = url.includes('station_information') ? 'info'
    : url.includes('station_status') ? 'status' : 'system';
  gbfs.calls[kind]++;
  const city = /\/contracts\/([^/]+)\//.exec(url)?.[1] ?? 'amiens';
  gbfs.cities.push(city);
  if (gbfs.hang) {
    return new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal.reason)));
  }
  if (gbfs.fail) return new Response('indisponible', { status: 503 });
  if (gbfs.malformed) return new Response('{"oups":', { status: 200, headers: { 'Content-Type': 'application/json' } });
  const source = city !== 'amiens' && gbfs.byCity[city] ? gbfs.byCity[city] : gbfs;
  const data = kind === 'system' ? gbfs.system : { stations: source[kind] };
  const body = kind === 'status' && gbfs.lastUpdated !== undefined ? { last_updated: gbfs.lastUpdated, data } : { data };
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

function resetGbfs() {
  require('../gbfs').resetStatusCache(); // oublie aussi la « dernière réponse valide »
  gbfs.info = [];
  gbfs.status = [];
  gbfs.system = { name: 'Vélam', rental_apps: {} };
  gbfs.fail = false;
  gbfs.hang = false;
  gbfs.malformed = false;
  gbfs.lastUpdated = undefined;
  gbfs.calls = { info: 0, status: 0, system: 0 };
  gbfs.byCity = {};
  gbfs.cities = [];
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
  endpoint: `https://fcm.googleapis.com/fcm/send/${id}`,
  expirationTime: null,
  keys: { p256dh: 'cle-p256dh', auth: 'cle-auth' },
});

module.exports = {
  dbc, boot, resetDb, startServer, gbfs, resetGbfs, expireCache, sncf, resetSncf,
  client, registerUser, fakeSubscription,
};
