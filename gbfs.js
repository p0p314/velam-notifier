// Fetch natif Node ≥ 18 — aucune dépendance supplémentaire

const INFO_URL   = 'https://api.cyclocity.fr/contracts/amiens/gbfs/v2/station_information.json';
const STATUS_URL = 'https://api.cyclocity.fr/contracts/amiens/gbfs/v2/station_status.json';

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
 * Retourne le statut temps réel de toutes les stations.
 * La liste brute est retournée telle quelle — la fusion avec les infos
 * se fait côté serveur.
 */
async function fetchStationStatus() {
  const data = await fetchJSON(STATUS_URL);
  return data.data.stations;
}

module.exports = { fetchStationInfo, fetchStationStatus };
