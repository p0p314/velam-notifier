// Construction de l'index des horaires théoriques à partir d'un dataset GTFS.
//
// Le dataset SNCF compte ~60 000 trajets-périodes et ~525 000 passages en gare
// (stop_times) : on ne garde en mémoire que des tableaux typés compacts (~20 Mo),
// jamais les lignes CSV brutes, et rien de tout cela ne va en base (référentiel
// volumineux, volatil, entièrement reconstruit à chaque version publiée).
//
// L'index expose des modèles normalisés (gares, lignes, trajets) : le reste du
// module ne manipule jamais le format GTFS brut.
const { Readable } = require('stream');
const { parseCsvStream } = require('./csv');
const { parseGtfsTime, ymdToInt, intToYmd, addDaysYmd } = require('./time');

/** Tableau d'entiers extensible (évite des millions de petits objets). */
class IntBuf {
  constructor(Type = Int32Array, cap = 1024) { this.Type = Type; this.a = new Type(cap); this.n = 0; }
  push(v) {
    if (this.n === this.a.length) { const b = new this.Type(this.a.length * 2); b.set(this.a); this.a = b; }
    this.a[this.n++] = v;
  }
  done() { return this.a.slice(0, this.n); }
}

/** Nom normalisé pour la recherche : minuscules, sans accents ni ponctuation. */
function normalize(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Lecteur de fichiers GTFS au-dessus d'un objet { 'stops.txt': texte } (tests, dev). */
function filesReader(files) {
  return {
    has: (name) => files[name] !== undefined,
    stream: (name) => Readable.from([files[name]]),
  };
}

async function readAll(reader, name, columns) {
  const rows = [];
  if (!reader.has(name)) return rows;
  await parseCsvStream(reader.stream(name), columns, (r) => rows.push(r));
  return rows;
}

/** shapes.txt → Map shape_id → Float64Array [lon, lat, lon, lat…] (ordre de passage). */
async function readShapes(reader, wanted) {
  const out = new Map();
  if (!wanted.size || !reader.has('shapes.txt')) return out;
  const pts = new Map(); // shape_id → [[seq, lon, lat]]
  await parseCsvStream(reader.stream('shapes.txt'),
    ['shape_id', 'shape_pt_lat', 'shape_pt_lon', 'shape_pt_sequence'], (r) => {
      if (!wanted.has(r.shape_id)) return;
      const lat = Number(r.shape_pt_lat);
      const lon = Number(r.shape_pt_lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
      let list = pts.get(r.shape_id);
      if (!list) pts.set(r.shape_id, (list = []));
      list.push([Number(r.shape_pt_sequence) || 0, lon, lat]);
    });
  for (const [id, list] of pts) {
    if (list.length < 2) continue;
    list.sort((a, b) => a[0] - b[0]);
    const arr = new Float64Array(list.length * 2);
    list.forEach(([, lon, lat], i) => { arr[2 * i] = lon; arr[2 * i + 1] = lat; });
    out.set(id, arr);
  }
  return out;
}

/** Conventions par défaut (GTFS générique) ; un fournisseur peut les surcharger. */
const DEFAULT_CONVENTIONS = {
  trainNumber: (trip) => trip.trip_short_name || '',
  realtimeAliases: () => [],
  // route_type de base 3 (bus) ou étendu 7xx (bus) / 2xx (car) ⇒ route ; sinon rail.
  isRoad: (trip, route) => {
    const t = Number(route.route_type);
    return t === 3 || (t >= 200 && t < 300) || (t >= 700 && t < 800);
  },
  stationCode: () => null,
};

/**
 * Jours de circulation de chaque service : calendar.txt (motif hebdomadaire sur une
 * période) puis calendar_dates.txt (ajouts / retraits). Renvoie Map service_id →
 * Int32Array triée de dates AAAAMMJJ.
 */
function buildServices(calendar, calendarDates) {
  const days = new Map();
  const WEEK = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  for (const c of calendar) {
    const set = new Set();
    if (!/^\d{8}$/.test(c.start_date) || !/^\d{8}$/.test(c.end_date)) continue;
    let d = intToYmd(c.start_date);
    const end = intToYmd(c.end_date);
    for (let guard = 0; d <= end && guard < 800; guard++, d = addDaysYmd(d, 1)) {
      const wd = (new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7; // 0 = lundi
      if (c[WEEK[wd]] === '1') set.add(ymdToInt(d));
    }
    days.set(c.service_id, set);
  }
  for (const r of calendarDates) {
    if (!/^\d{8}$/.test(r.date)) continue;
    let set = days.get(r.service_id);
    if (!set) { set = new Set(); days.set(r.service_id, set); }
    if (r.exception_type === '1') set.add(Number(r.date));
    else if (r.exception_type === '2') set.delete(Number(r.date));
  }
  const out = new Map();
  for (const [id, set] of days) out.set(id, Int32Array.from([...set].sort((a, b) => a - b)));
  return out;
}

/**
 * Construit l'index. `reader` : { has(name), stream(name) } ; `conventions` :
 * particularités du fournisseur (numéro de train, alias temps réel, mode).
 */
async function buildIndex(reader, conventions = {}) {
  const conv = { ...DEFAULT_CONVENTIONS, ...conventions };
  for (const required of ['stops.txt', 'routes.txt', 'trips.txt', 'stop_times.txt']) {
    if (!reader.has(required)) throw new Error(`GTFS incomplet : ${required} manquant`);
  }

  const [agencies, feedInfo] = await Promise.all([
    readAll(reader, 'agency.txt', ['agency_id', 'agency_name', 'agency_timezone']),
    readAll(reader, 'feed_info.txt', ['feed_version', 'feed_start_date', 'feed_end_date', 'feed_publisher_name']),
  ]);
  const tz = agencies.find((a) => a.agency_timezone)?.agency_timezone || conv.timezone || 'Europe/Paris';

  // ── Gares (zones d'arrêt) et points d'arrêt ────────────────────────────────
  const stops = await readAll(reader, 'stops.txt',
    ['stop_id', 'stop_name', 'stop_lat', 'stop_lon', 'location_type', 'parent_station']);
  const stations = [];
  const stationById = new Map();
  const addStation = (s) => {
    const idx = stations.length;
    stations.push({
      id: s.stop_id, name: s.stop_name, lat: Number(s.stop_lat) || null, lon: Number(s.stop_lon) || null,
      norm: normalize(s.stop_name), code: conv.stationCode(s.stop_id), served: 0,
    });
    stationById.set(s.stop_id, idx);
    return idx;
  };
  for (const s of stops) if (s.location_type === '1') addStation(s);
  // Point d'arrêt (quai) → gare parente ; un arrêt sans parent est sa propre gare.
  const stopPointStation = new Map();
  for (const s of stops) {
    if (s.location_type !== '' && s.location_type !== '0') continue;
    let st = s.parent_station ? stationById.get(s.parent_station) : undefined;
    if (st === undefined) st = addStation(s);
    stopPointStation.set(s.stop_id, st);
  }

  // ── Lignes ─────────────────────────────────────────────────────────────────
  const routes = await readAll(reader, 'routes.txt',
    ['route_id', 'agency_id', 'route_short_name', 'route_long_name', 'route_type', 'route_color', 'route_text_color']);
  const lines = routes.map((r) => ({
    id: r.route_id,
    shortName: r.route_short_name || '',
    longName: r.route_long_name && r.route_long_name !== '-' ? r.route_long_name : '',
    type: Number(r.route_type),
    color: /^[0-9a-f]{6}$/i.test(r.route_color) ? r.route_color.toUpperCase() : null,
    textColor: /^[0-9a-f]{6}$/i.test(r.route_text_color) ? r.route_text_color.toUpperCase() : null,
    agencyId: r.agency_id,
    norm: normalize(`${r.route_short_name} ${r.route_long_name}`),
    shortNorm: normalize(r.route_short_name),
  }));
  const lineById = new Map(lines.map((l, i) => [l.id, i]));
  const routeRows = new Map(routes.map((r) => [r.route_id, r]));

  // ── Calendrier ─────────────────────────────────────────────────────────────
  const [calendar, calendarDates] = await Promise.all([
    readAll(reader, 'calendar.txt', ['service_id', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'start_date', 'end_date']),
    readAll(reader, 'calendar_dates.txt', ['service_id', 'date', 'exception_type']),
  ]);
  const serviceDays = buildServices(calendar, calendarDates);
  const serviceIds = [...serviceDays.keys()];
  const serviceIdx = new Map(serviceIds.map((id, i) => [id, i]));
  const services = serviceIds.map((id) => serviceDays.get(id));
  let minDay = Infinity;
  let maxDay = -Infinity;
  for (const d of services) if (d.length) { minDay = Math.min(minDay, d[0]); maxDay = Math.max(maxDay, d[d.length - 1]); }

  // ── Trajets ────────────────────────────────────────────────────────────────
  const tripIds = [];
  const tripIndex = new Map();
  const tripLine = new IntBuf();
  const tripService = new IntBuf();
  const tripDirection = new IntBuf(Int8Array);
  const tripRoad = new IntBuf(Uint8Array);
  const tripNumber = [];
  const tripHeadsign = [];
  const tripShape = []; // shape_id GTFS ('' : aucun tracé publié — cas de la SNCF)
  const aliasTrips = new Map();
  await parseCsvStream(reader.stream('trips.txt'),
    ['route_id', 'service_id', 'trip_id', 'trip_headsign', 'trip_short_name', 'direction_id', 'shape_id'], (t) => {
      const line = lineById.get(t.route_id);
      const svc = serviceIdx.get(t.service_id);
      if (line === undefined || svc === undefined || tripIndex.has(t.trip_id)) return;
      const idx = tripIds.length;
      tripIds.push(t.trip_id);
      tripIndex.set(t.trip_id, idx);
      tripLine.push(line);
      tripService.push(svc);
      tripDirection.push(t.direction_id === '' ? -1 : Number(t.direction_id));
      tripRoad.push(conv.isRoad(t, routeRows.get(t.route_id)) ? 1 : 0);
      tripNumber.push(conv.trainNumber(t));
      tripHeadsign.push(t.trip_headsign || '');
      tripShape.push(t.shape_id || '');
      for (const alias of conv.realtimeAliases(t.trip_id)) {
        let list = aliasTrips.get(alias);
        if (!list) aliasTrips.set(alias, (list = []));
        list.push(idx);
      }
    });
  const tripCount = tripIds.length;

  // ── Tracés (shapes.txt, facultatif) ────────────────────────────────────────
  // Seuls les tracés utilisés par un trajet sont gardés, en Float64Array [lon, lat, …]
  // triés par shape_pt_sequence. La SNCF n'en publie pas (shape_id vide partout).
  const shapes = await readShapes(reader, new Set(tripShape.filter(Boolean)));

  // ── Passages en gare (le gros fichier, lu en flux) ─────────────────────────
  const stTrip = new IntBuf(Int32Array, 1 << 16);
  const stSeq = new IntBuf(Int32Array, 1 << 16);
  const stStation = new IntBuf(Int32Array, 1 << 16);
  const stPoint = new IntBuf(Int32Array, 1 << 16);
  const stArr = new IntBuf(Int32Array, 1 << 16);
  const stDep = new IntBuf(Int32Array, 1 << 16);
  const stFlags = new IntBuf(Uint8Array, 1 << 16); // bit 0 : pas de montée ; bit 1 : pas de descente
  const pointIds = [];
  const pointIdx = new Map();
  let lastTripId = null;
  let lastTrip = -1;
  await parseCsvStream(reader.stream('stop_times.txt'),
    ['trip_id', 'arrival_time', 'departure_time', 'stop_id', 'stop_sequence', 'pickup_type', 'drop_off_type'], (r) => {
      if (r.trip_id !== lastTripId) { lastTripId = r.trip_id; lastTrip = tripIndex.get(r.trip_id) ?? -1; }
      if (lastTrip === -1) return;
      const station = stopPointStation.get(r.stop_id);
      if (station === undefined) return;
      let p = pointIdx.get(r.stop_id);
      if (p === undefined) { p = pointIds.length; pointIds.push(r.stop_id); pointIdx.set(r.stop_id, p); }
      const arr = parseGtfsTime(r.arrival_time);
      const dep = parseGtfsTime(r.departure_time);
      stTrip.push(lastTrip);
      stSeq.push(Number(r.stop_sequence) || 0);
      stStation.push(station);
      stPoint.push(p);
      stArr.push(Number.isNaN(arr) ? (Number.isNaN(dep) ? -1 : dep) : arr);
      stDep.push(Number.isNaN(dep) ? (Number.isNaN(arr) ? -1 : arr) : dep);
      stFlags.push((r.pickup_type === '1' ? 1 : 0) | (r.drop_off_type === '1' ? 2 : 0));
    });

  // Tri par (trajet, ordre de passage) : comptage par trajet puis tri local.
  const n = stTrip.n;
  const tripStart = new Int32Array(tripCount + 1);
  for (let i = 0; i < n; i++) tripStart[stTrip.a[i] + 1]++;
  for (let t = 0; t < tripCount; t++) tripStart[t + 1] += tripStart[t];
  const order = new Int32Array(n);
  const fill = tripStart.slice(0, tripCount);
  for (let i = 0; i < n; i++) order[fill[stTrip.a[i]]++] = i;
  for (let t = 0; t < tripCount; t++) {
    const a = tripStart[t];
    const b = tripStart[t + 1];
    let sorted = true;
    for (let k = a + 1; k < b; k++) if (stSeq.a[order[k]] < stSeq.a[order[k - 1]]) { sorted = false; break; }
    if (!sorted) {
      const slice = Array.from(order.subarray(a, b)).sort((x, y) => stSeq.a[x] - stSeq.a[y]);
      order.set(slice, a);
    }
  }
  const permute = (buf) => {
    const out = new buf.Type(n);
    for (let k = 0; k < n; k++) out[k] = buf.a[order[k]];
    return out;
  };
  const seq = permute(stSeq);
  const station = permute(stStation);
  const point = permute(stPoint);
  const arr = permute(stArr);
  const dep = permute(stDep);
  const flags = permute(stFlags);
  const tripOf = new Int32Array(n); // passage → trajet
  for (let t = 0; t < tripCount; t++) tripOf.fill(t, tripStart[t], tripStart[t + 1]);
  // Heures manquantes (arrêt non minuté) : reprise de l'heure précédente du trajet.
  for (let t = 0; t < tripCount; t++) {
    for (let k = tripStart[t] + 1; k < tripStart[t + 1]; k++) {
      if (arr[k] < 0) arr[k] = dep[k - 1];
      if (dep[k] < 0) dep[k] = arr[k];
    }
  }

  // Index gare → passages (format CSR) et ligne → trajets.
  const stationStart = new Int32Array(stations.length + 1);
  for (let k = 0; k < n; k++) stationStart[station[k] + 1]++;
  for (let s = 0; s < stations.length; s++) {
    stations[s].served = stationStart[s + 1];
    stationStart[s + 1] += stationStart[s];
  }
  const stationStops = new Int32Array(n);
  const sFill = stationStart.slice(0, stations.length);
  for (let k = 0; k < n; k++) stationStops[sFill[station[k]]++] = k;
  const tripLineArr = tripLine.done();
  const lineTrips = lines.map(() => []);
  for (let t = 0; t < tripCount; t++) if (tripStart[t + 1] > tripStart[t]) lineTrips[tripLineArr[t]].push(t);
  lines.forEach((l, i) => { l.tripCount = lineTrips[i].length; });

  const feed = feedInfo[0] ?? {};
  return {
    tz,
    builtAt: Date.now(),
    feed: {
      version: feed.feed_version || null,
      publisher: feed.feed_publisher_name || agencies[0]?.agency_name || null,
      start: /^\d{8}$/.test(feed.feed_start_date) ? intToYmd(feed.feed_start_date) : (minDay !== Infinity ? intToYmd(minDay) : null),
      end: /^\d{8}$/.test(feed.feed_end_date) ? intToYmd(feed.feed_end_date) : (maxDay !== -Infinity ? intToYmd(maxDay) : null),
    },
    stations, stationById,
    lines, lineById, lineTrips,
    services,
    trips: {
      count: tripCount,
      ids: tripIds, index: tripIndex,
      line: tripLineArr, service: tripService.done(), direction: tripDirection.done(), road: tripRoad.done(),
      number: tripNumber, headsign: tripHeadsign, shape: tripShape,
      start: tripStart,
    },
    aliasTrips,
    shapes,
    stopTimes: { count: n, trip: tripOf, seq, station, point, arr, dep, flags },
    stationStops: { start: stationStart, list: stationStops },
    points: { ids: pointIds, index: pointIdx },
  };
}

/** Le service `svc` circule-t-il le jour `ymdInt` (AAAAMMJJ) ? Recherche dichotomique. */
function runsOn(index, tripIdx, ymdInt) {
  const days = index.services[index.trips.service[tripIdx]];
  let lo = 0;
  let hi = days.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (days[mid] === ymdInt) return true;
    if (days[mid] < ymdInt) lo = mid + 1; else hi = mid - 1;
  }
  return false;
}

module.exports = { buildIndex, filesReader, runsOn, normalize };
