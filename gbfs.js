// Fetch natif Node ≥ 18 — aucune dépendance supplémentaire.
// Une ville = un contrat Cyclocity (cities.js) ; Amiens par défaut. Les identifiants de
// stations renvoyés sont globaux (préfixés hors Amiens, cf. globalStationId).
const { DEFAULT_CITY, gbfsBase, globalStationId } = require('./cities');

const urlOf = (city, feed) => `${gbfsBase(city)}/${feed}.json`;
const withGlobalIds = (city, stations) => (city === DEFAULT_CITY
  ? stations
  : stations.map((s) => ({ ...s, station_id: globalStationId(city, s.station_id) })));

// Au-delà, on considère que le flux ne répond plus (évite une requête pendue).
const FETCH_TIMEOUT_MS = Number(process.env.GBFS_TIMEOUT_MS) || 8_000;

async function fetchJSON(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`GBFS ${url} → HTTP ${res.status}`);
  return res.json();
}

/**
 * Retourne la liste des stations (données statiques) d'une ville.
 * Stations sans nom écartées (à Amiens : la station fantôme 761, sans nom ni capacité).
 */
async function fetchStationInfo(city = DEFAULT_CITY) {
  const data = await fetchJSON(urlOf(city, 'station_information'));
  const list = data.data.stations.filter(
    (s) => !(city === DEFAULT_CITY && s.station_id === '761') && s.name?.trim()
  );
  return withGlobalIds(city, list);
}

/**
 * Statut temps réel de toutes les stations (fetch upstream brut) + date de
 * génération du flux (`last_updated`, secondes POSIX, champ racine GBFS).
 * Renvoie { stations, updatedAt } (ms). Lève si la réponse est mal formée.
 */
async function fetchStationStatus(nowMs = Date.now(), city = DEFAULT_CITY) {
  const data = await fetchJSON(urlOf(city, 'station_status'));
  const raw = data?.data?.stations;
  if (!Array.isArray(raw)) throw new Error('GBFS station_status : réponse mal formée');
  const stations = withGlobalIds(city, raw);
  // Date du flux ; à défaut (ou si incohérente, dans le futur), l'heure de réception.
  const feedMs = Number(data.last_updated) * 1000;
  const updatedAt = Number.isFinite(feedMs) && feedMs > 0 && feedMs <= nowMs + 60_000 ? Math.min(feedMs, nowMs) : nowMs;
  return { stations, updatedAt };
}

// ── Cache court du statut live ──────────────────────────────────────────────
// La disponibilité change lentement (quelques vélos par minute), mais chaque
// client rafraîchit toutes les 60 s. Sans cache, N clients = N fetchs GBFS/min.
// TTL court + coalescence des requêtes concurrentes → au plus 1 fetch upstream
// par fenêtre, quel que soit le nombre de clients (éco-conception, RGESN).
const STATUS_TTL_MS = Number(process.env.STATUS_CACHE_TTL_MS) || 10_000;

// Au-delà, les disponibilités sont considérées comme périmées (bandeau côté client,
// alertes suspendues côté serveur).
const STATUS_STALE_MS = 5 * 60_000;

// Un cache par ville : { at, snapshot, lastGood, inflight }. Une ville n'est interrogée
// que si quelqu'un la consulte (ou si une alerte de cette ville est due).
const caches = new Map();
const cacheOf = (city) => {
  let c = caches.get(city);
  if (!c) caches.set(city, (c = { at: 0, snapshot: null, lastGood: null, inflight: null }));
  return c;
};

/**
 * Statut live mutualisé d'une ville. Renvoie un instantané :
 *   { stations, updatedAt (ms, date des données), upstreamOk, error? }
 * Si le flux ne répond plus ou répond mal (erreur HTTP, délai, JSON invalide),
 * on sert la dernière réponse valide avec `upstreamOk: false` plutôt qu'une erreur ;
 * seule l'absence totale de données fait lever (502 côté route).
 */
async function getStationStatus(city = DEFAULT_CITY) {
  const c = cacheOf(city);
  if (c.snapshot && Date.now() - c.at < STATUS_TTL_MS) return c.snapshot;
  if (c.inflight) return c.inflight;

  c.inflight = fetchStationStatus(Date.now(), city)
    .then((fresh) => {
      c.lastGood = fresh;
      return { ...fresh, upstreamOk: true };
    })
    .catch((err) => {
      if (!c.lastGood) throw err;
      console.error(`[gbfs] flux station_status (${city}) en échec, données précédentes servies :`, err.message);
      return { ...c.lastGood, upstreamOk: false, error: err.message };
    })
    .then((snapshot) => {
      c.at = Date.now();
      c.snapshot = snapshot;
      return snapshot;
    })
    .finally(() => { c.inflight = null; });

  return c.inflight;
}

/** Les données de l'instantané sont-elles exploitables (flux OK et récentes) ? */
function isFresh(snapshot, nowMs = Date.now()) {
  return !!snapshot?.upstreamOk && nowMs - snapshot.updatedAt < STATUS_STALE_MS;
}

/**
 * État du flux d'une ville vu par le serveur, sans déclencher d'appel (pour /api/health).
 * null tant qu'aucune requête n'a été faite depuis le démarrage.
 */
function getStatusHealth(nowMs = Date.now(), city = DEFAULT_CITY) {
  const c = caches.get(city);
  const snap = c?.snapshot;
  if (!snap) return null;
  return {
    upstream_ok: snap.upstreamOk,
    fresh: isFresh(snap, nowMs),
    data_updated_at: new Date(snap.updatedAt).toISOString(),
    data_age_s: Math.max(0, Math.round((nowMs - snap.updatedAt) / 1000)),
    last_checked_at: new Date(c.at).toISOString(),
    last_error: snap.error ?? null,
  };
}

/** Villes interrogées depuis le démarrage (santé). */
const queriedCities = () => [...caches.keys()];

/** Tests uniquement : oublie caches et dernières réponses valides. */
function resetStatusCache() {
  caches.clear();
}

/**
 * Retourne les informations du système (data.data) : nom, system_id,
 * rental_apps (deep links + liens stores), etc. Données quasi statiques,
 * destinées à une synchronisation quotidienne plutôt qu'à chaque requête.
 */
async function fetchSystemInformation(city = DEFAULT_CITY) {
  const data = await fetchJSON(urlOf(city, 'system_information'));
  return data.data;
}

module.exports = {
  fetchStationInfo, fetchStationStatus, getStationStatus, fetchSystemInformation,
  isFresh, resetStatusCache, getStatusHealth, queriedCities, STATUS_STALE_MS,
};
