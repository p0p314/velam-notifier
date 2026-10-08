// Carte d'un train — logique pure (testable sans Mapbox) : textes de progression et de
// fraîcheur de la position, GeoJSON du tracé et des gares, vue initiale.
// Les données viennent du backend (GET /api/trains/route : TrainRoute ;
// GET /api/trains/journey : TrainJourney + position) : aucun calcul de
// rapprochement ici, seulement de la présentation.
import { fmtClock, delayLabel } from "./trains";

export const trainMapPath = (id) => `/trains/carte?id=${encodeURIComponent(id)}`;

// Une position plus ancienne n'est plus « actuelle » (même seuil que le serveur).
export const POSITION_STALE_S = 300;
// Rafraîchissement : 30 s quand des positions sont publiées pour un train en route,
// sinon la fréquence normale du temps réel (2 min, cf. trainHooks).
export const POSITION_REFRESH_MS = 30_000;

/** « 30 s », « 8 min », « 2 h ». */
export function ageLabel(s) {
  if (s < 60) return `${Math.max(0, Math.round(s))} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  return `${Math.floor(s / 3600)} h`;
}

/**
 * Fraîcheur de la position : « Position mise à jour il y a 30 s », ou, au-delà de
 * 5 min, « Position connue il y a 8 min » (jamais présentée comme actuelle).
 */
export function positionInfo(position, now = Date.now()) {
  const v = position?.vehicle;
  if (!v?.updatedAt) return null;
  const s = Math.max(0, (now - Date.parse(v.updatedAt)) / 1000);
  if (v.stale || s >= POSITION_STALE_S) return { tone: "warn", stale: true, text: `Position connue il y a ${ageLabel(s)}` };
  return { tone: "ok", stale: false, text: `Position mise à jour il y a ${ageLabel(s)}` };
}

const providerLabel = (provider) => (provider === "sncf" ? "la SNCF" : "le transporteur");

/** Pourquoi il n'y a pas de position affichée (ou null si tout va bien). */
export function positionNote(position, journey, provider = "sncf") {
  if (!journey) return null;
  if (journey.status === "cancelled") return "Train supprimé : pas de position.";
  if (!position) return null;
  if (!position.available) {
    return `La position des trains n'est pas publiée par ${providerLabel(provider)} : l'avancement est estimé d'après les horaires.`;
  }
  if (position.vehicle?.stale) return "Position ancienne : l'avancement est estimé d'après les horaires.";
  if (position.vehicle) return null;
  if (journey.phase !== "en_route") return null;
  if (position.upstream_ok === false) return "Positions indisponibles pour le moment : l'avancement est estimé d'après les horaires.";
  return "Position de ce train indisponible : l'avancement est estimé d'après les horaires.";
}

/** Note sur le tracé (approximatif quand le fournisseur ne publie pas de tracé). */
export function routeNote(route, provider = "sncf") {
  if (!route || route.geometrySource !== "stops") return null;
  return `Tracé approximatif, de gare en gare : ${providerLabel(provider)} ne publie pas le tracé des voies.`;
}

/** Heure de passage affichée d'un arrêt (estimée si connue) et retard. */
export function stopTime(stop, i, n) {
  const first = i === 0;
  const last = i === n - 1;
  const scheduled = first ? stop.scheduledDeparture : stop.scheduledArrival;
  const estimated = first ? stop.estimatedDeparture : stop.estimatedArrival;
  const changed = !!estimated && fmtClock(estimated) !== fmtClock(scheduled);
  return {
    scheduled: fmtClock(scheduled),
    estimated: changed ? fmtClock(estimated) : null,
    delay: stop.delay > 0 ? delayLabel(stop.delay) : null,
    label: first ? "Départ" : last ? "Arrivée" : "Passage",
  };
}

const BASIS_LABEL = {
  position: "D'après la position du train",
  passages: "D'après les passages en gare signalés par la SNCF",
  schedule: "Estimé d'après les horaires",
};

/**
 * Où en est le train, en texte :
 *   { title, sub, basis, basisLabel, upcoming: [{ index, name, time, inJourney }] }
 * À partir de la progression calculée par le serveur (indices dans journey.stops).
 */
export function progressInfo(journey, progress, { max = Infinity } = {}) {
  if (!journey?.stops?.length || !progress) return null;
  const stops = journey.stops;
  const n = stops.length;
  const name = (i) => stops[i]?.station.name ?? "";
  const timeOf = (i) => {
    const t = stopTime(stops[i], i, n);
    return [t.estimated ?? t.scheduled, t.delay].filter(Boolean).join(" · ");
  };
  let title;
  let sub = null;
  switch (progress.state) {
    case "not_departed":
      title = "Pas encore parti";
      sub = `Départ de ${name(0)} à ${timeOf(0)}`;
      break;
    case "at_stop":
      title = `En gare de ${name(progress.previous)}`;
      if (progress.upcoming[0] !== undefined) sub = `Prochaine gare : ${name(progress.upcoming[0])} à ${timeOf(progress.upcoming[0])}`;
      break;
    case "between":
      title = progress.upcoming[0] !== undefined ? `Prochaine gare : ${name(progress.upcoming[0])}` : `Vers ${name(n - 1)}`;
      if (progress.upcoming[0] !== undefined) sub = `Arrivée ${timeOf(progress.upcoming[0])}${progress.previous !== null ? ` · depuis ${name(progress.previous)}` : ""}`;
      break;
    case "arrived":
      title = `Arrivé à ${name(n - 1)}`;
      break;
    default:
      return null;
  }
  return {
    title,
    sub,
    basis: progress.basis,
    basisLabel: BASIS_LABEL[progress.basis] ?? BASIS_LABEL.schedule,
    upcoming: progress.upcoming.slice(0, max).map((i) => ({ index: i, name: name(i), time: timeOf(i), inJourney: !!stops[i].inJourney })),
  };
}

/** État d'un arrêt pour la carte et son popup. */
export function stopState(journey, progress, route, i) {
  const st = journey?.stops?.[i];
  if (st?.skipped) return "skipped";
  if (route?.segment) {
    if (i === route.segment.from) return "board";
    if (i === route.segment.to) return "alight";
  }
  if (progress) {
    if (progress.state === "arrived") return "passed";
    if (progress.previous !== null && progress.state !== "not_departed" && i <= progress.previous) return "passed";
    if (progress.upcoming[0] === i) return "next";
  }
  return "stop";
}

const STATE_LABEL = {
  skipped: "Arrêt supprimé", board: "Votre gare de départ", alight: "Votre gare d'arrivée",
  passed: "Desservie", next: "Prochain arrêt", stop: null,
};

/** Contenu du popup d'une gare : nom, horaires (prévu / estimé), retard, statut. */
export function stopPopup(journey, progress, route, i) {
  const st = journey?.stops?.[i] ?? null;
  const name = st?.station.name ?? route?.stops?.[i]?.station.name ?? "";
  if (!st) return { name, rows: [], status: null };
  const n = journey.stops.length;
  const rows = [];
  const row = (label, sched, est) => {
    if (!sched) return;
    const changed = est && fmtClock(est) !== fmtClock(sched);
    rows.push({ label, scheduled: fmtClock(sched), estimated: changed ? fmtClock(est) : null });
  };
  if (i > 0) row("Arrivée", st.scheduledArrival, st.estimatedArrival);
  if (i < n - 1 && !(i > 0 && st.scheduledDeparture === st.scheduledArrival)) row("Départ", st.scheduledDeparture, st.estimatedDeparture);
  const state = stopState(journey, progress, route, i);
  return {
    name,
    rows,
    platform: !st.skipped && journey.status !== "cancelled" ? st.platform ?? null : null,
    delay: !st.skipped && st.delay > 0 ? delayLabel(st.delay) : null,
    status: journey.status === "cancelled" ? "Train supprimé" : STATE_LABEL[state],
  };
}

// ── GeoJSON ─────────────────────────────────────────────────────────────────

const sq = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
function nearestVertex(coords, p, from = 0) {
  let best = from;
  for (let k = from; k < coords.length; k++) if (sq(coords[k], p) < sq(coords[best], p)) best = k;
  return best;
}

/**
 * Portion du tracé entre deux gares (montée → descente). Tracé de gare en gare :
 * les sommets sont les gares ; tracé réel : sommets les plus proches des gares.
 */
export function segmentCoords(route) {
  const coords = route?.geometry?.coordinates ?? [];
  const seg = route?.segment;
  if (!seg || coords.length < 2) return coords;
  const a = route.stops[seg.from]?.station;
  const b = route.stops[seg.to]?.station;
  if (a?.lat == null || b?.lat == null) return coords;
  const i = nearestVertex(coords, [a.lon, a.lat]);
  const j = nearestVertex(coords, [b.lon, b.lat], i);
  return j > i ? coords.slice(i, j + 1) : coords;
}

const line = (coordinates, properties = {}) => ({ type: "Feature", properties, geometry: { type: "LineString", coordinates } });

/** Tracé complet et portion du voyageur. */
export function routeGeoJSON(route) {
  if (!route?.geometry?.coordinates?.length) return { full: emptyFC(), segment: emptyFC() };
  return {
    full: { type: "FeatureCollection", features: [line(route.geometry.coordinates)] },
    segment: { type: "FeatureCollection", features: [line(segmentCoords(route))] },
  };
}

export const emptyFC = () => ({ type: "FeatureCollection", features: [] });

/** Gares du trajet (points cliquables), avec leur état pour le style. */
export function stationsGeoJSON(route, journey, progress) {
  if (!route?.stops?.length) return emptyFC();
  const n = route.stops.length;
  return {
    type: "FeatureCollection",
    features: route.stops
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.station.lat != null && s.station.lon != null)
      .map(({ s, i }) => {
        const state = stopState(journey, progress, route, i);
        const key = state === "board" || state === "alight" || i === 0 || i === n - 1;
        return {
          type: "Feature",
          properties: { index: i, name: s.station.name, state, key, label: key ? s.station.name : "" },
          geometry: { type: "Point", coordinates: [s.station.lon, s.station.lat] },
        };
      }),
  };
}

/**
 * Vue initiale : centrée sur le train si une position actuelle est connue, sinon le
 * trajet entier (emprise du tracé).
 */
export function initialView(route, position) {
  const v = position?.vehicle;
  if (v && !v.stale) return { center: [v.lon, v.lat], zoom: 11 };
  if (route?.bbox) return { bounds: [[route.bbox[0], route.bbox[1]], [route.bbox[2], route.bbox[3]]] };
  return null;
}

/** Fréquence de rafraîchissement de la carte d'un train. */
export function mapRefreshMs(data, fallbackMs) {
  const live = data?.position?.available && data?.journey && data.journey.status !== "cancelled" && data.journey.phase !== "arrived";
  return live ? POSITION_REFRESH_MS : fallbackMs;
}

/** Le trajet passe-t-il près d'Amiens (stations Vélam) ? Rayon en km. */
export function routeNear(route, point, km = 15) {
  if (!route?.stops) return false;
  const rad = (d) => (d * Math.PI) / 180;
  return route.stops.some(({ station: s }) => {
    if (s.lat == null) return false;
    const h = Math.sin(rad(s.lat - point.lat) / 2) ** 2
      + Math.cos(rad(point.lat)) * Math.cos(rad(s.lat)) * Math.sin(rad(s.lon - point.lng) / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.sqrt(h)) <= km;
  });
}
