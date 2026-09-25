// Fetch natif Node ≥ 18 — aucune dépendance supplémentaire

const INFO_URL   = 'https://api.cyclocity.fr/contracts/amiens/gbfs/v2/station_information.json';
const STATUS_URL = 'https://api.cyclocity.fr/contracts/amiens/gbfs/v2/station_status.json';
const SYSTEM_URL = 'https://api.cyclocity.fr/contracts/amiens/gbfs/v2/system_information.json';

// Au-delà, on considère que le flux ne répond plus (évite une requête pendue).
const FETCH_TIMEOUT_MS = Number(process.env.GBFS_TIMEOUT_MS) || 8_000;

async function fetchJSON(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`GBFS ${url} → HTTP ${res.status}`);
  return res.json();
}

/**
 * Retourne la liste des stations (données statiques).
 * Station 761 filtrée (station fantôme sans nom ni capacité).
 */
async function fetchStationInfo() {
  const data = await fetchJSON(INFO_URL);
  return data.data.stations.filter(
    (s) => s.station_id !== '761' && s.name?.trim()
  );
}

/**
 * Statut temps réel de toutes les stations (fetch upstream brut) + date de
 * génération du flux (`last_updated`, secondes POSIX, champ racine GBFS).
 * Renvoie { stations, updatedAt } (ms). Lève si la réponse est mal formée.
 */
async function fetchStationStatus(nowMs = Date.now()) {
  const data = await fetchJSON(STATUS_URL);
  const stations = data?.data?.stations;
  if (!Array.isArray(stations)) throw new Error('GBFS station_status : réponse mal formée');
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

let statusCache    = { at: 0, snapshot: null };
let lastGood       = null; // dernière réponse valide du flux : { stations, updatedAt }
let statusInflight = null;

/**
 * Statut live mutualisé. Renvoie un instantané :
 *   { stations, updatedAt (ms, date des données), upstreamOk, error? }
 * Si le flux ne répond plus ou répond mal (erreur HTTP, délai, JSON invalide),
 * on sert la dernière réponse valide avec `upstreamOk: false` plutôt qu'une erreur ;
 * seule l'absence totale de données fait lever (502 côté route).
 */
async function getStationStatus() {
  if (statusCache.snapshot && Date.now() - statusCache.at < STATUS_TTL_MS) {
    return statusCache.snapshot;
  }
  if (statusInflight) return statusInflight;

  statusInflight = fetchStationStatus()
    .then((fresh) => {
      lastGood = fresh;
      return { ...fresh, upstreamOk: true };
    })
    .catch((err) => {
      if (!lastGood) throw err;
      console.error('[gbfs] flux station_status en échec, données précédentes servies :', err.message);
      return { ...lastGood, upstreamOk: false, error: err.message };
    })
    .then((snapshot) => {
      statusCache = { at: Date.now(), snapshot };
      return snapshot;
    })
    .finally(() => { statusInflight = null; });

  return statusInflight;
}

/** Les données de l'instantané sont-elles exploitables (flux OK et récentes) ? */
function isFresh(snapshot, nowMs = Date.now()) {
  return !!snapshot?.upstreamOk && nowMs - snapshot.updatedAt < STATUS_STALE_MS;
}

/** Tests uniquement : oublie cache et dernière réponse valide. */
function resetStatusCache() {
  statusCache = { at: 0, snapshot: null };
  lastGood = null;
  statusInflight = null;
}

/**
 * Retourne les informations du système (data.data) : nom, system_id,
 * rental_apps (deep links + liens stores), etc. Données quasi statiques,
 * destinées à une synchronisation quotidienne plutôt qu'à chaque requête.
 */
async function fetchSystemInformation() {
  const data = await fetchJSON(SYSTEM_URL);
  return data.data;
}

module.exports = {
  fetchStationInfo, fetchStationStatus, getStationStatus, fetchSystemInformation,
  isFresh, resetStatusCache, STATUS_STALE_MS,
};
