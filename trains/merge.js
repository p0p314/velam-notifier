// Fusion horaires théoriques (index GTFS) + temps réel (GTFS-RT normalisé) en
// modèles métier `TrainJourney`. Fonctions pures : aucun appel réseau ni base.
//
// Règles (spécification GTFS-RT) :
//  - un TripUpdate est rattaché à un trajet théorique par son trip_id, ou par
//    l'identifiant interne du fournisseur (alias) + start_date ; un trajet ADDED
//    absent du théorique n'est pas affichable (aucune ligne, aucun horaire) : ignoré ;
//  - un retard se propage aux arrêts suivants jusqu'à la prochaine mise à jour ;
//    NO_DATA interrompt la propagation ; SKIPPED = arrêt supprimé ;
//  - sans donnée temps réel, un trajet est « théorique », JAMAIS supprimé.
const { runsOn } = require('./gtfs/staticIndex');
const { ymdToInt, addDaysYmd, gtfsToEpoch, localParts } = require('./gtfs/time');

// Effets GTFS-RT considérés comme une perturbation importante. UNKNOWN_EFFECT est
// inclus : la SNCF ne renseigne pas toujours l'effet, mieux vaut prévenir.
const MAJOR_EFFECTS = new Set([
  'NO_SERVICE', 'REDUCED_SERVICE', 'SIGNIFICANT_DELAYS', 'DETOUR', 'MODIFIED_SERVICE', 'STOP_MOVED', 'UNKNOWN_EFFECT',
]);
const isMajorAlert = (a) => a.severity === 'SEVERE' || MAJOR_EFFECTS.has(a.effect);

// ── Rattachement du temps réel au théorique ─────────────────────────────────

/** Trajets théoriques désignés par un trip_id GTFS-RT (identifiant exact ou alias). */
function candidateTrips(index, tripId) {
  if (!tripId) return [];
  const exact = index.trips.index.get(tripId);
  if (exact !== undefined) return [exact];
  return index.aliasTrips.get(tripId.trim()) ?? [];
}

/**
 * Jour de service d'un trajet sans start_date : parmi la veille, le jour et le
 * lendemain de l'horodatage du flux, celui où il circule et dont le départ est le
 * plus proche de cet horodatage.
 */
function guessServiceDate(index, tripIdx, refMs) {
  const today = localParts(refMs, index.tz).date;
  let best = null;
  for (const d of [addDaysYmd(today, -1), today, addDaysYmd(today, 1)]) {
    if (!runsOn(index, tripIdx, ymdToInt(d))) continue;
    const dep = gtfsToEpoch(d, index.stopTimes.dep[index.trips.start[tripIdx]], index.tz);
    const gap = Math.abs(dep - refMs);
    if (!best || gap < best.gap) best = { d, gap };
  }
  return best?.d ?? null;
}

/**
 * Index temps réel, construit une fois par instantané (et par version du GTFS) :
 *   trips  : Map « tripIdx|AAAA-MM-JJ » → TripUpdate normalisé
 *   alerts : tableau d'alertes normalisées
 *   byTrip / byLine / byStation : Map index → [indices d'alertes]
 */
function buildRealtimeIndex(index, rt) {
  const tu = rt?.tripUpdates;
  const sa = rt?.serviceAlerts;
  const refMs = tu?.feedTimestamp ?? Date.now();
  const trips = new Map();
  for (const u of tu?.tripUpdates ?? []) {
    const cands = candidateTrips(index, u.tripId);
    if (!cands.length) continue; // ADDED inconnu, ou train absent du théorique
    for (const t of cands) {
      const date = u.startDate ?? guessServiceDate(index, t, refMs);
      if (!date || !runsOn(index, t, ymdToInt(date))) continue;
      trips.set(`${t}|${date}`, u);
    }
  }

  const alerts = sa?.alerts ?? [];
  const byTrip = new Map();
  const byLine = new Map();
  const byStation = new Map();
  const push = (map, key, i) => {
    const list = map.get(key);
    if (!list) map.set(key, [i]);
    else if (list[list.length - 1] !== i) list.push(i);
  };
  alerts.forEach((a, i) => {
    for (const e of a.entities) {
      if (e.tripId) {
        for (const t of candidateTrips(index, e.tripId)) push(byTrip, t, i);
      } else if (e.routeId) {
        const l = index.lineById.get(e.routeId);
        if (l !== undefined) push(byLine, l, i);
      } else if (e.stopId) {
        let s = index.stationById.get(e.stopId);
        if (s === undefined) {
          const p = index.points.index.get(e.stopId);
          if (p !== undefined) s = stationOfPoint(index, p);
        }
        if (s !== undefined) push(byStation, s, i);
      }
    }
  });
  // Lignes touchées par chaque alerte (directement ou via l'un de leurs trains).
  const linesOfAlert = alerts.map(() => new Set());
  for (const [l, list] of byLine) for (const i of list) linesOfAlert[i].add(l);
  for (const [t, list] of byTrip) for (const i of list) linesOfAlert[i].add(index.trips.line[t]);
  return { trips, alerts, byTrip, byLine, byStation, linesOfAlert, feedTimestamp: refMs };
}

// Quai → gare : retrouvé via le premier passage qui l'utilise (mémoïsé).
const pointStationCache = new WeakMap();
function stationOfPoint(index, p) {
  let map = pointStationCache.get(index);
  if (!map) {
    map = new Int32Array(index.points.ids.length).fill(-1);
    const { point, station, count } = index.stopTimes;
    for (let k = 0; k < count; k++) if (map[point[k]] === -1) map[point[k]] = station[k];
    pointStationCache.set(index, map);
  }
  return map[p] === -1 ? undefined : map[p];
}

// ── Estimations arrêt par arrêt ─────────────────────────────────────────────

/** Position (index de passage) d'une mise à jour d'arrêt dans le trajet, ou -1. */
function positionOf(index, tripIdx, upd) {
  const { seq, point, station } = index.stopTimes;
  const a = index.trips.start[tripIdx];
  const b = index.trips.start[tripIdx + 1];
  if (upd.seq !== null && upd.seq !== undefined) {
    for (let k = a; k < b; k++) if (seq[k] === upd.seq) return k;
  }
  if (upd.stopId) {
    const p = index.points.index.get(upd.stopId);
    if (p !== undefined) for (let k = a; k < b; k++) if (point[k] === p) return k;
    const s = index.stationById.get(upd.stopId);
    if (s !== undefined) for (let k = a; k < b; k++) if (station[k] === s) return k;
  }
  return -1;
}

/**
 * Estimations de chaque arrêt d'un trajet (ms epoch) à partir d'un TripUpdate :
 * Map position → { arr, dep, skipped }. Retard propagé (spécification GTFS-RT).
 */
function estimateStops(index, tripIdx, date, upd) {
  const { arr, dep } = index.stopTimes;
  const a = index.trips.start[tripIdx];
  const b = index.trips.start[tripIdx + 1];
  const tz = index.tz;
  const byPos = new Map();
  for (const u of upd.stops) {
    const k = positionOf(index, tripIdx, u);
    if (k !== -1) byPos.set(k, u);
  }
  const out = new Map();
  let prop = upd.delay ?? null; // retard propagé (s)
  for (let k = a; k < b; k++) {
    const sArr = gtfsToEpoch(date, arr[k], tz);
    const sDep = gtfsToEpoch(date, dep[k], tz);
    const u = byPos.get(k);
    if (u) {
      if (u.relationship === 'NO_DATA') { prop = null; out.set(k, { arr: null, dep: null, skipped: false }); continue; }
      const eArr = u.arrival?.time ?? (u.arrival?.delay != null ? sArr + u.arrival.delay * 1000 : null);
      let eDep = u.departure?.time ?? (u.departure?.delay != null ? sDep + u.departure.delay * 1000 : null);
      const arrDelay = eArr !== null ? (eArr - sArr) / 1000 : null;
      if (eDep === null && arrDelay !== null) eDep = Math.max(sDep + arrDelay * 1000, eArr);
      const depDelay = eDep !== null ? (eDep - sDep) / 1000 : null;
      out.set(k, {
        arr: eArr ?? (prop !== null ? sArr + prop * 1000 : null),
        dep: eDep ?? (prop !== null ? sDep + prop * 1000 : null),
        skipped: u.relationship === 'SKIPPED',
      });
      if (depDelay !== null) prop = depDelay;
      else if (arrDelay !== null) prop = arrDelay;
    } else {
      out.set(k, {
        arr: prop !== null ? sArr + prop * 1000 : null,
        dep: prop !== null ? sDep + prop * 1000 : null,
        skipped: false,
      });
    }
  }
  return out;
}

// ── TrainJourney ────────────────────────────────────────────────────────────

const iso = (msVal) => (msVal === null || msVal === undefined ? null : new Date(msVal).toISOString());
const delayMin = (est, sched) => (est === null || est === undefined ? null : Math.round((est - sched) / 60_000));

function stationRef(index, s) {
  const st = index.stations[s];
  return { id: st.id, name: st.name };
}

function lineRef(index, l) {
  const line = index.lines[l];
  return { id: line.id, name: line.shortName, longName: line.longName, color: line.color, textColor: line.textColor };
}

/** Alertes qui concernent ce trajet pendant [from, to] (ms), dédupliquées, les plus ciblées d'abord. */
function journeyAlerts(index, rtIndex, tripIdx, stations, from, to) {
  if (!rtIndex) return [];
  const found = new Map();
  const consider = (list, scope) => {
    for (const i of list ?? []) {
      const a = rtIndex.alerts[i];
      if (found.has(a.id)) continue;
      const overlaps = !a.periods.length || a.periods.some((p) => (p.start ?? -Infinity) <= to && (p.end ?? Infinity) >= from);
      if (overlaps) found.set(a.id, { ...a, scope });
    }
  };
  consider(rtIndex.byTrip.get(tripIdx), 'trip');
  consider(rtIndex.byLine.get(index.trips.line[tripIdx]), 'line');
  for (const s of stations) consider(rtIndex.byStation.get(s), 'station');
  return [...found.values()].map((a) => ({
    id: a.id, scope: a.scope, header: a.header, description: a.description,
    cause: a.cause, effect: a.effect, severity: a.severity, url: a.url, major: isMajorAlert(a),
    periods: a.periods.map((p) => ({ start: iso(p.start), end: iso(p.end) })),
  }));
}

/**
 * Construit le TrainJourney d'un trajet `tripIdx`, jour de service `date`, de la
 * position `fromK` à `toK` (indices de passages). `rt` : { index, usable } —
 * `usable` faux (flux en panne / trop ancien) ⇒ horaires théoriques uniquement.
 * `withStops` : détail de tous les arrêts (page de détail).
 */
function buildJourney(index, { tripIdx, date, fromK, toK }, { rt = null, now = Date.now(), withStops = false, conventions = {} } = {}) {
  const tz = index.tz;
  const { arr, dep, station } = index.stopTimes;
  const tripId = index.trips.ids[tripIdx];
  const schedDep = gtfsToEpoch(date, dep[fromK], tz);
  const schedArr = gtfsToEpoch(date, arr[toK], tz);
  const upd = rt?.usable ? rt.index.trips.get(`${tripIdx}|${date}`) ?? null : null;
  const est = upd ? estimateStops(index, tripIdx, date, upd) : null;

  const tripCancelled = upd?.relationship === 'CANCELED' || upd?.relationship === 'DELETED';
  const eFrom = est?.get(fromK);
  const eTo = est?.get(toK);
  let cancellation = null;
  if (tripCancelled) cancellation = { partial: false, reason: 'Train supprimé' };
  else if (eFrom?.skipped) cancellation = { partial: true, reason: `Ne s'arrête plus à ${index.stations[station[fromK]].name}` };
  else if (eTo?.skipped) cancellation = { partial: true, reason: `Ne s'arrête plus à ${index.stations[station[toK]].name}` };

  const estimatedDeparture = cancellation ? null : eFrom?.dep ?? null;
  const estimatedArrival = cancellation ? null : eTo?.arr ?? null;
  const departureDelay = delayMin(estimatedDeparture, schedDep);
  const arrivalDelay = delayMin(estimatedArrival, schedArr);

  let status;
  if (cancellation) status = 'cancelled';
  else if (!upd) status = 'scheduled';
  else if (Math.max(departureDelay ?? 0, arrivalDelay ?? 0) >= 1) status = 'delayed';
  else status = 'on_time';

  const depAt = estimatedDeparture ?? schedDep;
  const arrAt = estimatedArrival ?? schedArr;
  const phase = cancellation ? null : now < depAt ? 'upcoming' : now < arrAt ? 'en_route' : 'arrived';

  const lastK = index.trips.start[tripIdx + 1] - 1;
  const line = lineRef(index, index.trips.line[tripIdx]);
  const alerts = rt?.usable
    ? journeyAlerts(index, rt.index, tripIdx, [station[fromK], station[toK]], schedDep - 30 * 60_000, schedArr + 30 * 60_000)
    : [];

  const journey = {
    id: `${tripId}|${date}|${index.stations[station[fromK]].id}|${index.stations[station[toK]].id}`,
    tripId,
    serviceDate: date,
    lineId: line.id,
    lineName: line.name,
    line,
    trainNumber: index.trips.number[tripIdx] || null,
    brand: conventions.brand?.(tripId) ?? null,
    mode: index.trips.road[tripIdx] ? 'car' : 'train',
    terminus: index.stations[station[lastK]].name,
    departureStation: stationRef(index, station[fromK]),
    arrivalStation: stationRef(index, station[toK]),
    scheduledDeparture: iso(schedDep),
    estimatedDeparture: iso(estimatedDeparture),
    scheduledArrival: iso(schedArr),
    estimatedArrival: iso(estimatedArrival),
    departureDelay,
    arrivalDelay,
    status,
    phase,
    cancellation,
    realtime: !!upd,
    alerts,
    disrupted: alerts.some((a) => a.major && a.scope !== 'station'),
  };

  if (withStops) {
    const a = index.trips.start[tripIdx];
    journey.stops = [];
    for (let k = a; k <= lastK; k++) {
      const sa = gtfsToEpoch(date, arr[k], tz);
      const sd = gtfsToEpoch(date, dep[k], tz);
      const e = est?.get(k);
      journey.stops.push({
        station: stationRef(index, station[k]),
        scheduledArrival: iso(sa),
        scheduledDeparture: iso(sd),
        estimatedArrival: tripCancelled ? null : iso(e?.arr ?? null),
        estimatedDeparture: tripCancelled ? null : iso(e?.dep ?? null),
        delay: tripCancelled || !e ? null : delayMin(e.dep ?? e.arr, e.dep !== null ? sd : sa),
        skipped: !!e?.skipped,
        inJourney: k >= fromK && k <= toK,
      });
    }
  }
  return journey;
}

module.exports = {
  buildRealtimeIndex, buildJourney, estimateStops, candidateTrips, guessServiceDate, isMajorAlert, MAJOR_EFFECTS,
};
