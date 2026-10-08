// Corrélation des positions temps réel (GTFS-RT VehiclePosition) avec les trajets
// théoriques, et progression d'un train le long de son trajet.
//
//   VehiclePosition → trip (trip_id exact, ou alias du fournisseur + start_date,
//   ou route_id + start_date + start_time [+ direction_id]) → TrainJourney → TrainRoute
//
// Jamais de rapprochement par le seul numéro / libellé d'un véhicule : un vehicle_id
// sans descripteur de trajet n'est rattaché à rien (les GTFS ne publient pas de
// véhicules). Fonctions pures : aucun appel réseau.
const { runsOn } = require('./gtfs/staticIndex');
const { ymdToInt, parseGtfsTime } = require('./gtfs/time');
const { candidateTrips, guessServiceDate } = require('./merge');

// Âge au-delà duquel une position n'est plus « actuelle » (affichée comme ancienne),
// puis au-delà duquel elle n'est plus montrée du tout.
const POSITION_STALE_MS = 5 * 60_000;
const POSITION_MAX_AGE_MS = 30 * 60_000;

/** Trajets d'une ligne partant à `startTime` le jour `date` (dans le sens donné). */
function tripsByRouteAndTime(index, v) {
  const l = index.lineById.get(v.routeId);
  const secs = parseGtfsTime(v.startTime);
  if (l === undefined || Number.isNaN(secs) || !v.startDate) return [];
  const d = ymdToInt(v.startDate);
  return index.lineTrips[l].filter((t) => index.stopTimes.dep[index.trips.start[t]] === secs
    && (v.directionId === null || index.trips.direction[t] === -1 || index.trips.direction[t] === v.directionId)
    && runsOn(index, t, d));
}

const memo = new WeakMap(); // instantané → { index, map, stats }

/**
 * Index des positions : Map « tripIdx|AAAA-MM-JJ » → position normalisée, plus des
 * compteurs (rattachées / non rattachées) pour le diagnostic. Calculé une fois par
 * instantané du flux et par version du GTFS.
 */
function buildVehicleIndex(index, snapshot) {
  if (!snapshot) return { map: new Map(), stats: { total: 0, matched: 0, unmatched: 0 } };
  const m = memo.get(snapshot);
  if (m && m.index === index) return m;
  const map = new Map();
  let matched = 0;
  for (const v of snapshot.vehicles ?? []) {
    let cands = candidateTrips(index, v.tripId);
    if (!cands.length && v.routeId) cands = tripsByRouteAndTime(index, v);
    let hit = false;
    for (const t of cands) {
      const date = v.startDate ?? guessServiceDate(index, t, v.timestamp ?? snapshot.feedTimestamp ?? Date.now());
      if (!date || !runsOn(index, t, ymdToInt(date))) continue;
      const key = `${t}|${date}`;
      const prev = map.get(key);
      if (!prev || (v.timestamp ?? 0) > (prev.timestamp ?? 0)) map.set(key, v);
      hit = true;
    }
    if (hit) matched++;
  }
  const out = { index, map, stats: { total: snapshot.vehicles?.length ?? 0, matched, unmatched: (snapshot.vehicles?.length ?? 0) - matched } };
  memo.set(snapshot, out);
  return out;
}

/**
 * Position présentée au client, ou null : `stale` au-delà de 5 min (« position connue
 * il y a 8 min », jamais présentée comme actuelle), masquée au-delà de 30 min.
 */
function vehicleView(v, feedTimestamp, now = Date.now()) {
  if (!v) return null;
  const at = v.timestamp ?? feedTimestamp;
  if (!at) return null;
  const age = Math.max(0, now - at);
  if (age > POSITION_MAX_AGE_MS) return null;
  return {
    lat: v.lat,
    lon: v.lon,
    bearing: v.bearing,
    speedKmh: v.speed !== null ? Math.round(v.speed * 3.6) : null,
    updatedAt: new Date(at).toISOString(),
    ageS: Math.round(age / 1000),
    stale: age > POSITION_STALE_MS,
    currentStatus: v.currentStatus,
    currentStopSequence: v.currentStopSequence ?? null,
    stopId: v.stopId ?? null,
    vehicleId: v.vehicleId,
  };
}

/** Distance (approx. planaire, en degrés « corrigés ») d'un point à un segment. */
function distToSegment(p, a, b) {
  const kx = Math.cos((p[1] * Math.PI) / 180);
  const ax = (a[0] - p[0]) * kx; const ay = a[1] - p[1];
  const bx = (b[0] - p[0]) * kx; const by = b[1] - p[1];
  const dx = bx - ax; const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
  const x = ax + t * dx; const y = ay + t * dy;
  return Math.sqrt(x * x + y * y);
}

/**
 * Où en est le train ? Positions dans `journey.stops` (0 = origine du trajet) :
 *   { basis: 'position' | 'passages' | 'schedule', state: 'not_departed' | 'at_stop' | 'between' | 'arrived',
 *     previous, next, upcoming: [positions des prochaines gares desservies] }
 * - avec une position fraîche : arrêt courant du flux (stop_sequence / stop_id +
 *   current_status), sinon projection sur la ligne des gares ;
 * - sinon, passages en gare signalés (`stops[].passed`, flux SIRI) : dernière gare desservie ;
 * - sinon : horaires (estimés si le temps réel en donne, théoriques sinon).
 * null pour un train supprimé.
 */
function journeyProgress(journey, vehicle, now = Date.now()) {
  if (!journey?.stops?.length || journey.status === 'cancelled') return null;
  const stops = journey.stops;
  const n = stops.length;
  const t = (iso) => (iso ? Date.parse(iso) : null);
  const arrAt = (i) => t(stops[i].estimatedArrival) ?? t(stops[i].scheduledArrival);
  const depAt = (i) => t(stops[i].estimatedDeparture) ?? t(stops[i].scheduledDeparture);
  const served = (i) => !stops[i].skipped;
  const upcomingFrom = (i) => {
    const out = [];
    for (let k = i; k < n; k++) if (served(k)) out.push(k);
    return out;
  };

  if (vehicle && !vehicle.stale) {
    let k = -1;
    if (vehicle.currentStopSequence !== null && vehicle.currentStopSequence !== undefined) {
      k = stops.findIndex((s) => s.seq === vehicle.currentStopSequence);
    }
    if (k === -1 && vehicle.stopId) k = stops.findIndex((s) => s.station.id === vehicle.stopId || s.stopId === vehicle.stopId);
    if (k !== -1) {
      if (vehicle.currentStatus === 'STOPPED_AT') {
        return { basis: 'position', state: k === n - 1 ? 'arrived' : 'at_stop', previous: k, next: k + 1 < n ? k + 1 : null, upcoming: upcomingFrom(k + 1) };
      }
      return { basis: 'position', state: 'between', previous: k > 0 ? k - 1 : null, next: k, upcoming: upcomingFrom(k) };
    }
    // Projection : segment entre deux gares le plus proche de la position.
    let best = null;
    for (let i = 0; i + 1 < n; i++) {
      const a = stops[i].station; const b = stops[i + 1].station;
      if (a.lat == null || b.lat == null) continue;
      const d = distToSegment([vehicle.lon, vehicle.lat], [a.lon, a.lat], [b.lon, b.lat]);
      if (!best || d < best.d) best = { i, d };
    }
    if (best) return { basis: 'position', state: 'between', previous: best.i, next: best.i + 1, upcoming: upcomingFrom(best.i + 1) };
  }

  // Passages signalés : la dernière gare desservie ; en gare tant que son départ n'est pas passé.
  let last = -1;
  stops.forEach((s, i) => { if (s.passed === true) last = i; });
  // « Pas encore parti » seulement si l'origine elle-même est signalée à venir.
  if (last !== -1 || stops[0].passed === false) {
    if (last === -1) return { basis: 'passages', state: 'not_departed', previous: null, next: 0, upcoming: upcomingFrom(0) };
    if (last === n - 1) return { basis: 'passages', state: 'arrived', previous: n - 1, next: null, upcoming: [] };
    const upcoming = upcomingFrom(last + 1);
    const state = last > 0 && now < depAt(last) ? 'at_stop' : 'between';
    return { basis: 'passages', state, previous: last, next: upcoming[0] ?? null, upcoming };
  }

  // Horaires (estimés si disponibles).
  if (now < depAt(0)) return { basis: 'schedule', state: 'not_departed', previous: null, next: 0, upcoming: upcomingFrom(0) };
  if (now >= arrAt(n - 1)) return { basis: 'schedule', state: 'arrived', previous: n - 1, next: null, upcoming: [] };
  for (let i = 0; i < n - 1; i++) {
    if (now >= depAt(i) && now < arrAt(i + 1)) {
      return { basis: 'schedule', state: 'between', previous: i, next: i + 1, upcoming: upcomingFrom(i + 1) };
    }
    if (now >= arrAt(i + 1) && now < depAt(i + 1)) {
      return { basis: 'schedule', state: 'at_stop', previous: i + 1, next: i + 2 < n ? i + 2 : null, upcoming: upcomingFrom(i + 2) };
    }
  }
  return null;
}

/** Fenêtre où une position a du sens : de 30 min avant le départ à 1 h après l'arrivée. */
function journeyIsLive(journey, now = Date.now()) {
  const dep = Date.parse(journey.estimatedDeparture ?? journey.scheduledDeparture);
  const arr = Date.parse(journey.estimatedArrival ?? journey.scheduledArrival);
  return journey.status !== 'cancelled' && now >= dep - 30 * 60_000 && now <= arr + 60 * 60_000;
}

module.exports = {
  buildVehicleIndex, vehicleView, journeyProgress, journeyIsLive, POSITION_STALE_MS, POSITION_MAX_AGE_MS,
};
