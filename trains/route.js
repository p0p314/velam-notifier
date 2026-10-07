// TrainRoute : itinéraire géographique d'un trajet, construit depuis l'index GTFS.
//
//  - shapes.txt publié pour ce trajet ⇒ tracé réel (`geometrySource: 'shape'`) ;
//  - sinon ⇒ ligne brisée de gare en gare (`'stops'`), approximative : c'est le cas
//    de la SNCF, qui ne publie aucun tracé. Aucun service externe n'est appelé.
//
// Une géométrie ne dépend que du trajet et de la version du dataset : elle est calculée
// une fois puis gardée (cache attaché à l'index — une nouvelle version = un nouvel
// index = un cache neuf, l'ancien est libéré avec lui).

const ROUND = 1e5; // ~1 m : précision largement suffisante, charge utile bornée
const round = (v) => Math.round(v * ROUND) / ROUND;

/** Distance à vol d'oiseau (km). */
function haversineKm(a, b) {
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b[1] - a[1]) / 2) ** 2
    + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(rad(b[0] - a[0]) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function lineLength(coords) {
  let km = 0;
  for (let i = 1; i < coords.length; i++) km += haversineKm(coords[i - 1], coords[i]);
  return km;
}

function bboxOf(coords) {
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [lon, lat] of coords) {
    if (lon < w) w = lon; if (lon > e) e = lon;
    if (lat < s) s = lat; if (lat > n) n = lat;
  }
  return [w, s, e, n];
}

const caches = new WeakMap();
const CACHE_MAX = 2000;

/**
 * Itinéraire d'un trajet (toutes ses gares, de l'origine au terminus). Mémoïsé par
 * version de l'index. Renvoie :
 *   { tripId, shapeId, geometrySource, geometry (GeoJSON LineString), distanceKm,
 *     direction, bbox, stops: [{ station: { id, name, lat, lon }, seq }] }
 */
function getTripRoute(index, tripIdx) {
  let cache = caches.get(index);
  if (!cache) caches.set(index, (cache = new Map()));
  const hit = cache.get(tripIdx);
  if (hit) return hit;

  const a = index.trips.start[tripIdx];
  const b = index.trips.start[tripIdx + 1];
  const stops = [];
  const stopCoords = [];
  for (let k = a; k < b; k++) {
    const st = index.stations[index.stopTimes.station[k]];
    stops.push({ station: { id: st.id, name: st.name, lat: st.lat, lon: st.lon }, seq: index.stopTimes.seq[k] });
    if (st.lat != null && st.lon != null) {
      const p = [round(st.lon), round(st.lat)];
      const last = stopCoords[stopCoords.length - 1];
      if (!last || last[0] !== p[0] || last[1] !== p[1]) stopCoords.push(p);
    }
  }

  const shapeId = index.trips.shape?.[tripIdx] || null;
  const shape = shapeId ? index.shapes?.get(shapeId) : null;
  let coords;
  let source;
  if (shape && shape.length >= 4) {
    coords = [];
    for (let i = 0; i < shape.length; i += 2) coords.push([round(shape[i]), round(shape[i + 1])]);
    source = 'shape';
  } else {
    coords = stopCoords;
    source = 'stops';
  }

  const route = {
    tripId: index.trips.ids[tripIdx],
    shapeId: source === 'shape' ? shapeId : null,
    geometrySource: source,
    geometry: { type: 'LineString', coordinates: coords },
    distanceKm: Math.round(lineLength(coords) * 10) / 10,
    direction: index.trips.direction[tripIdx] === -1 ? null : index.trips.direction[tripIdx],
    bbox: coords.length ? bboxOf(coords) : null,
    stops,
  };
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value); // le plus ancien
  cache.set(tripIdx, route);
  return route;
}

module.exports = { getTripRoute, haversineKm, lineLength };
