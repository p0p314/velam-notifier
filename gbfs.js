// Fetch natif Node ≥ 18 — aucune dépendance supplémentaire

const INFO_URL   = 'https://api.cyclocity.fr/contracts/amiens/gbfs/v2/station_information.json';
const STATUS_URL = 'https://api.cyclocity.fr/contracts/amiens/gbfs/v2/station_status.json';
const SYSTEM_URL = 'https://api.cyclocity.fr/contracts/amiens/gbfs/v2/system_information.json';

async function fetchJSON(url) {
  const res = await fetch(url);
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
 * Retourne le statut temps réel de toutes les stations (fetch upstream brut).
 * La liste est retournée telle quelle — la fusion avec les infos se fait côté serveur.
 */
async function fetchStationStatus() {
  const data = await fetchJSON(STATUS_URL);
  return data.data.stations;
}

// ── Cache court du statut live ──────────────────────────────────────────────
// La disponibilité change lentement (quelques vélos par minute), mais chaque
// client rafraîchit toutes les 60 s. Sans cache, N clients = N fetchs GBFS/min.
// TTL court + coalescence des requêtes concurrentes → au plus 1 fetch upstream
// par fenêtre, quel que soit le nombre de clients (éco-conception, RGESN).
const STATUS_TTL_MS = Number(process.env.STATUS_CACHE_TTL_MS) || 10_000;

let statusCache    = { at: 0, data: null };
let statusInflight = null;

/**
 * Statut live mutualisé : sert la valeur en cache si elle a moins de STATUS_TTL_MS,
 * sinon lance (ou réutilise) un unique fetch partagé par tous les appelants
 * simultanés. Propage l'erreur upstream (502 géré par l'appelant) sans polluer le cache.
 */
async function getStationStatus() {
  if (statusCache.data && Date.now() - statusCache.at < STATUS_TTL_MS) {
    return statusCache.data;
  }
  if (statusInflight) return statusInflight;

  statusInflight = fetchStationStatus()
    .then((data) => {
      statusCache = { at: Date.now(), data };
      return data;
    })
    .finally(() => { statusInflight = null; });

  return statusInflight;
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

module.exports = { fetchStationInfo, fetchStationStatus, getStationStatus, fetchSystemInformation };
