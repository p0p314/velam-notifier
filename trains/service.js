// TrainService : opérations métier d'un fournisseur de transport (recherche de gares,
// de lignes, de trajets, détail, rapprochement des favoris). S'appuie sur l'index
// théorique (StaticScheduleProvider) et le temps réel (RealtimeTrainProvider) et
// renvoie uniquement des modèles métier (TrainJourney…), jamais du GTFS brut.
const { runsOn, normalize } = require('./gtfs/staticIndex');
const { ymdToInt, addDaysYmd, gtfsToEpoch, localParts, hhmmToMin } = require('./gtfs/time');
const { buildRealtimeIndex, buildJourney } = require('./merge');
const { getTripRoute } = require('./route');
const { buildVehicleIndex, vehicleView, journeyProgress, journeyIsLive } = require('./vehicles');

/** Erreur métier portant son code HTTP (404 gare inconnue, 503 horaires en chargement…). */
class TrainsError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const DAY = 86_400;
const MAX_RESULTS = 300;
// Au-delà, les données temps réel sont trop anciennes pour être affichées comme telles.
const RT_MAX_AGE_MS = 10 * 60_000;

function createTrainService(provider, env = process.env) {
  const { schedule, realtime, conventions } = provider;
  const rtMaxAge = Number(env.TRAINS_RT_MAX_AGE_MS) || RT_MAX_AGE_MS;

  function requireIndex() {
    const index = schedule.getIndex();
    if (!index) {
      schedule.load(); // en arrière-plan ; le client réessaie
      throw new TrainsError(503, 'Horaires des trains en cours de chargement, réessayez dans un instant');
    }
    schedule.maybeRevalidate();
    return index;
  }

  const today = (index, now = Date.now()) => localParts(now, index.tz).date;

  // ── Temps réel ─────────────────────────────────────────────────────────────

  let rtMemo = null; // { index, tu, sa, rtIndex } : index temps réel de l'instantané courant
  const usableFeed = (snap, now) => !!snap?.feedTimestamp && now - snap.feedTimestamp <= rtMaxAge;

  /**
   * Contexte temps réel pour des dates de service données. Le flux n'est appelé que
   * si l'une d'elles est proche d'aujourd'hui (veille → lendemain) : inutile pour une
   * date lointaine (horaires théoriques uniquement).
   */
  async function realtimeContext(index, dates, { force = false, now = Date.now() } = {}) {
    const t = today(index, now);
    const applicable = dates.some((d) => d >= addDaysYmd(t, -1) && d <= addDaysYmd(t, 1));
    if (!applicable) return { rt: null, meta: { applicable: false, available: false } };
    const { tripUpdates: tu, serviceAlerts: sa } = await realtime.get({ force });
    const tuOk = usableFeed(tu, now);
    const saOk = usableFeed(sa, now);
    if (!rtMemo || rtMemo.index !== index || rtMemo.tu !== tu || rtMemo.sa !== sa) {
      rtMemo = { index, tu, sa, rtIndex: buildRealtimeIndex(index, { tripUpdates: tuOk ? tu : null, serviceAlerts: saOk ? sa : null }) };
    }
    const updatedAt = tu?.feedTimestamp ?? null;
    return {
      rt: tuOk || saOk ? { usable: true, index: rtMemo.rtIndex } : null,
      meta: {
        applicable: true,
        available: tuOk,
        alerts_available: saOk,
        upstream_ok: !!tu?.upstreamOk,
        updated_at: updatedAt ? new Date(updatedAt).toISOString() : null,
        age_s: updatedAt ? Math.max(0, Math.round((now - updatedAt) / 1000)) : null,
        checked_at: tu?.fetchedAt ? new Date(tu.fetchedAt).toISOString() : null,
      },
    };
  }

  // ── Référentiel : gares, lignes ───────────────────────────────────────────

  /** Autocomplétion des gares : début de nom, puis début de mot, puis contient. */
  function searchStations(q, limit = 10) {
    const index = requireIndex();
    const n = normalize(q);
    if (!n) return [];
    const scored = [];
    for (const s of index.stations) {
      if (!s.served) continue;
      let score = -1;
      if (s.norm.startsWith(n)) score = 0;
      else if (s.norm.includes(` ${n}`)) score = 1;
      else if (s.norm.includes(n)) score = 2;
      if (score !== -1) scored.push({ s, score });
    }
    scored.sort((a, b) => a.score - b.score || b.s.served - a.s.served || a.s.name.localeCompare(b.s.name, 'fr'));
    return scored.slice(0, limit).map(({ s }) => ({ id: s.id, name: s.name, code: s.code }));
  }

  const lineView = (l) => ({
    id: l.id, name: l.shortName, longName: l.longName, color: l.color, textColor: l.textColor, trips: l.tripCount,
  });

  /** Recherche de lignes : nom court exact (« K44 »), puis début, puis nom long. */
  function searchLines(q, limit = 10) {
    const index = requireIndex();
    const n = normalize(q);
    if (!n) return [];
    const scored = [];
    for (const l of index.lines) {
      if (!l.tripCount) continue;
      let score = -1;
      if (l.shortNorm === n) score = 0;
      else if (l.shortNorm.startsWith(n)) score = 1;
      else if (l.norm.includes(n)) score = 2;
      if (score !== -1) scored.push({ l, score });
    }
    scored.sort((a, b) => a.score - b.score || a.l.shortName.localeCompare(b.l.shortName, 'fr', { numeric: true }) || b.l.tripCount - a.l.tripCount);
    return scored.slice(0, limit).map(({ l }) => lineView(l));
  }

  function stationIdx(index, id) {
    const s = index.stationById.get(id);
    if (s === undefined || !index.stations[s].served) throw new TrainsError(404, 'Gare inconnue');
    return s;
  }

  /**
   * Lignes désignées par `line` : identifiant exact, sinon nom court (« K44 » peut
   * désigner plusieurs lignes de régions différentes : toutes sont retenues).
   */
  function resolveLines(index, line) {
    const exact = index.lineById.get(line);
    if (exact !== undefined) return new Set([exact]);
    const n = normalize(line);
    const set = new Set();
    index.lines.forEach((l, i) => { if (l.shortNorm === n && l.tripCount) set.add(i); });
    if (!set.size) throw new TrainsError(404, 'Ligne inconnue');
    return set;
  }

  // ── Trajets ────────────────────────────────────────────────────────────────

  // Trajets (toutes périodes) passant par `from` puis `to` : indépendant de la date,
  // mémoïsé par version de l'index (favoris consultés chaque jour).
  const pairCache = new WeakMap();
  function pairTrips(index, from, to) {
    let cache = pairCache.get(index);
    if (!cache) pairCache.set(index, (cache = new Map()));
    const key = `${from}|${to}`;
    let list = cache.get(key);
    if (list) return list;
    list = [];
    const { start, list: stops } = index.stationStops;
    const { trip, station, flags } = index.stopTimes;
    for (let i = start[from]; i < start[from + 1]; i++) {
      const k = stops[i];
      if (flags[k] & 1) continue; // pas de montée
      const t = trip[k];
      const end = index.trips.start[t + 1];
      for (let j = k + 1; j < end; j++) {
        if (station[j] === to && !(flags[j] & 2)) { list.push({ t, fromK: k, toK: j }); break; }
      }
    }
    if (cache.size > 500) cache.clear();
    cache.set(key, list);
    return list;
  }

  /**
   * Candidats (trajet, jour de service, positions) circulant le jour calendaire `date`
   * au départ de `fromK` : une heure GTFS ≥ 24:00 appartient au service de la veille.
   */
  function onDate(index, cands, date, refK = 'fromK') {
    const out = [];
    const prev = addDaysYmd(date, -1);
    const dInt = ymdToInt(date);
    const pInt = ymdToInt(prev);
    for (const c of cands) {
      const secs = refK === 'fromK' ? index.stopTimes.dep[c.fromK] : index.stopTimes.arr[c.toK];
      if (secs < DAY) { if (runsOn(index, c.t, dInt)) out.push({ ...c, date }); }
      else if (secs < 2 * DAY && runsOn(index, c.t, pInt)) out.push({ ...c, date: prev });
    }
    return out;
  }

  /** Candidats d'une recherche (avant construction des TrainJourney). */
  function candidates(index, { from, to, lines }) {
    const { start, list: stops } = index.stationStops;
    const { trip, station, flags } = index.stopTimes;
    const lastOf = (t) => index.trips.start[t + 1] - 1;
    const inLines = (t) => !lines || lines.has(index.trips.line[t]);
    if (from !== null && to !== null) return pairTrips(index, from, to).filter((c) => inLines(c.t));
    const out = [];
    if (from !== null) {
      for (let i = start[from]; i < start[from + 1]; i++) {
        const k = stops[i];
        const t = trip[k];
        if (flags[k] & 1 || k === lastOf(t) || !inLines(t)) continue;
        out.push({ t, fromK: k, toK: lastOf(t) });
      }
    } else if (to !== null) {
      for (let i = start[to]; i < start[to + 1]; i++) {
        const k = stops[i];
        const t = trip[k];
        if (flags[k] & 2 || k === index.trips.start[t] || !inLines(t)) continue;
        out.push({ t, fromK: index.trips.start[t], toK: k });
      }
    } else {
      for (const l of lines) {
        for (const t of index.lineTrips[l]) out.push({ t, fromK: index.trips.start[t], toK: lastOf(t) });
      }
    }
    // Garde-fou : départ et arrivée distincts (boucles).
    return out.filter((c) => station[c.fromK] !== station[c.toK]);
  }

  /** Couverture des horaires : une date hors période renvoie une liste vide expliquée. */
  function coverage(index) {
    return { from: index.feed.start, until: index.feed.end };
  }

  /**
   * Recherche : gare de départ et/ou d'arrivée et/ou ligne, pour un jour donné.
   * `after` (« HH:MM ») : départs à partir de cette heure. Tri par heure de départ.
   */
  async function searchJourneys({ from = null, to = null, line = null, date, after = null }, { force = false, now = Date.now() } = {}) {
    const index = requireIndex();
    if (!from && !to && !line) throw new TrainsError(400, 'Indiquez une gare de départ, une gare d\'arrivée ou une ligne');
    const f = from ? stationIdx(index, from) : null;
    const t = to ? stationIdx(index, to) : null;
    if (f !== null && f === t) throw new TrainsError(400, 'Les gares de départ et d\'arrivée doivent être différentes');
    const lines = line ? resolveLines(index, line) : null;

    const refK = f === null && t !== null ? 'toK' : 'fromK';
    let found = onDate(index, candidates(index, { from: f, to: t, lines }), date, refK);
    if (after) {
      const min = hhmmToMin(after) * 60;
      found = found.filter((c) => {
        const secs = index.stopTimes.dep[c.fromK] - (c.date === date ? 0 : DAY);
        return secs >= min;
      });
    }
    found.sort((a, b) => gtfsToEpoch(a.date, index.stopTimes.dep[a.fromK], index.tz) - gtfsToEpoch(b.date, index.stopTimes.dep[b.fromK], index.tz));
    const truncated = found.length > MAX_RESULTS;
    if (truncated) found = found.slice(0, MAX_RESULTS);

    const { rt, meta } = await realtimeContext(index, [date, addDaysYmd(date, -1)], { force, now });
    const journeys = found.map((c) => buildJourney(index, { tripIdx: c.t, date: c.date, fromK: c.fromK, toK: c.toK }, { rt, now, conventions }));
    return {
      journeys,
      truncated,
      lines: lines ? [...lines].map((l) => lineView(index.lines[l])) : null,
      directions: lines ? directionsOf(journeys) : null,
      realtime: meta,
      coverage: coverage(index),
      outOfCoverage: !!(index.feed.start && index.feed.end && (date < index.feed.start || date > index.feed.end)),
    };
  }

  /**
   * Sens d'une recherche par ligne : [{ id, label }] (label = terminus le plus fréquent
   * de ce sens, « Amiens »), seulement s'il y en a au moins deux ; sinon null.
   */
  function directionsOf(journeys) {
    const byDir = new Map();
    for (const j of journeys) {
      if (j.directionId === null) continue;
      let counts = byDir.get(j.directionId);
      if (!counts) byDir.set(j.directionId, (counts = new Map()));
      counts.set(j.terminus, (counts.get(j.terminus) ?? 0) + 1);
    }
    if (byDir.size < 2) return null;
    return [...byDir.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([id, counts]) => ({ id, label: [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0] }));
  }

  /** Décode l'identifiant d'un TrainJourney (« trip_id|date|gare|gare »). */
  function locateJourney(index, id) {
    const parts = String(id).split('|');
    if (parts.length !== 4 || !/^\d{4}-\d{2}-\d{2}$/.test(parts[1])) throw new TrainsError(400, 'Identifiant de trajet invalide');
    const [tripId, date, fromId, toId] = parts;
    const tripIdx = index.trips.index.get(tripId);
    if (tripIdx === undefined) throw new TrainsError(404, 'Trajet introuvable (les horaires ont peut-être été mis à jour)');
    if (!runsOn(index, tripIdx, ymdToInt(date))) throw new TrainsError(404, 'Ce train ne circule pas ce jour-là');
    const f = stationIdx(index, fromId);
    const t = stationIdx(index, toId);
    const { station } = index.stopTimes;
    const a = index.trips.start[tripIdx];
    const b = index.trips.start[tripIdx + 1];
    let fromK = -1;
    let toK = -1;
    for (let k = a; k < b; k++) {
      if (fromK === -1 && station[k] === f) fromK = k;
      else if (fromK !== -1 && station[k] === t) { toK = k; break; }
    }
    if (fromK === -1 || toK === -1) throw new TrainsError(404, 'Ce train ne relie pas ces gares');
    return { tripIdx, date, fromK, toK };
  }

  /**
   * Position du train et progression le long du trajet :
   *   { available, upstream_ok, vehicle, progress }
   * `available` : le fournisseur publie-t-il des positions ? Le flux n'est lu que si
   * oui, et seulement autour de l'heure du trajet (journeyIsLive) : jamais pour un
   * train de demain. Sans position fraîche, la progression vient des horaires.
   */
  async function journeyPosition(index, ref, journey, { force = false, now = Date.now() } = {}) {
    const out = { available: realtime.hasVehiclePositions, upstream_ok: null, vehicle: null, progress: null };
    if (realtime.hasVehiclePositions && journeyIsLive(journey, now)) {
      const snap = await realtime.getVehicles({ force });
      const raw = buildVehicleIndex(index, snap).map.get(`${ref.tripIdx}|${ref.date}`);
      out.upstream_ok = !!snap?.upstreamOk;
      out.vehicle = vehicleView(raw, snap?.feedTimestamp, now);
    }
    out.progress = journeyProgress(journey, out.vehicle, now);
    return out;
  }

  /** Détail d'un trajet (tous les arrêts, événements, position / progression). */
  async function getJourney(id, { force = false, now = Date.now() } = {}) {
    const index = requireIndex();
    const ref = locateJourney(index, id);
    const { rt, meta } = await realtimeContext(index, [ref.date], { force, now });
    const journey = buildJourney(index, ref, { rt, now, withStops: true, conventions });
    const position = await journeyPosition(index, ref, journey, { force, now });
    return { journey, realtime: meta, position };
  }

  /**
   * Itinéraire géographique (TrainRoute) du trajet d'un TrainJourney : ne dépend que
   * du trajet et de la version des horaires (mis en cache, jamais de temps réel).
   * `segment` : positions, dans `stops`, des gares de montée et de descente.
   */
  function getJourneyRoute(id) {
    const index = requireIndex();
    const ref = locateJourney(index, id);
    const route = getTripRoute(index, ref.tripIdx);
    const a = index.trips.start[ref.tripIdx];
    const line = index.lines[index.trips.line[ref.tripIdx]];
    return {
      ...route,
      trainNumber: index.trips.number[ref.tripIdx] || null,
      line: { id: line.id, name: line.shortName, longName: line.longName, color: line.color, textColor: line.textColor },
      segment: { from: ref.fromK - a, to: ref.toK - a },
      datasetVersion: index.feed.version ?? null,
    };
  }

  // ── Favoris : retrouver « le 16:53 Lille Flandres → Amiens » à une date ──────

  const depMinutes = (index, c) => Math.round((index.stopTimes.dep[c.fromK] % DAY) / 60);
  const fmtHHMM = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
  const gap = (a, b) => Math.min(Math.abs(a - b), 1440 - Math.abs(a - b));

  /**
   * Trajet correspondant à un favori le jour `date`. Les trip_id changent à chaque
   * version du dataset : on retrouve le train par gares + numéro de train (stable)
   * à ±90 min de l'heure enregistrée (horaire modifié), sinon par gares + ligne +
   * heure (±10 min : train renuméroté). Renvoie { ref, match, departureTime } ou null.
   */
  function matchFavorite(index, fav, date) {
    const f = index.stationById.get(fav.origin_id);
    const t = index.stationById.get(fav.destination_id);
    if (f === undefined || t === undefined) return null;
    const target = hhmmToMin(fav.departure_time);
    const cands = onDate(index, pairTrips(index, f, t), date);
    const pick = (list, maxGap) => list
      .map((c) => ({ c, g: gap(depMinutes(index, c), target) }))
      .filter((x) => x.g <= maxGap)
      .sort((a, b) => a.g - b.g)[0]?.c ?? null;
    let c = fav.train_number ? pick(cands.filter((x) => index.trips.number[x.t] === fav.train_number), 90) : null;
    let match = 'exact';
    if (!c) {
      const n = normalize(fav.line_name);
      c = pick(cands.filter((x) => !n || index.lines[index.trips.line[x.t]].shortNorm === n), 10);
      match = 'approx';
    }
    if (!c) return null;
    return { ref: { tripIdx: c.t, date: c.date, fromK: c.fromK, toK: c.toK }, match, departureTime: fmtHHMM(depMinutes(index, c)) };
  }

  /**
   * Prochaines circulations d'un favori (au plus `count`, sur `days` jours) avec leur
   * état : un trajet déjà arrivé n'est plus « prochain ».
   */
  async function nextOccurrences(fav, { count = 3, days = 8, now = Date.now(), force = false } = {}) {
    const index = requireIndex();
    const found = [];
    const start = today(index, now);
    // Marge de 6 h : un train parti en retard peut encore être en route.
    const horizon = now - 6 * 3600_000;
    for (let i = -1; i < days && found.length < count + 2; i++) {
      const m = matchFavorite(index, fav, addDaysYmd(start, i));
      if (!m || found.some((x) => x.ref.tripIdx === m.ref.tripIdx && x.ref.date === m.ref.date)) continue;
      if (gtfsToEpoch(m.ref.date, index.stopTimes.arr[m.ref.toK], index.tz) < horizon) continue;
      found.push(m);
    }
    const { rt, meta } = await realtimeContext(index, found.map((m) => m.ref.date), { force, now });
    const nowIso = new Date(now).toISOString();
    const occurrences = found
      .map((m) => ({
        ...buildJourney(index, m.ref, { rt, now, conventions }),
        match: m.match,
        scheduleChanged: m.departureTime !== fav.departure_time,
      }))
      .filter((j) => (j.estimatedArrival ?? j.scheduledArrival) > nowIso)
      .slice(0, count);
    return { occurrences, realtime: meta };
  }

  /** Données nécessaires pour enregistrer un favori à partir d'un TrainJourney. */
  function favoriteFromJourney(id) {
    const index = requireIndex();
    const ref = locateJourney(index, id);
    const line = index.lines[index.trips.line[ref.tripIdx]];
    const local = (k, field) => {
      const secs = index.stopTimes[field][k] % DAY;
      return fmtHHMM(Math.round(secs / 60));
    };
    return {
      provider: provider.id,
      train_number: index.trips.number[ref.tripIdx] || '',
      line_id: line.id,
      line_name: line.shortName,
      line_long_name: line.longName,
      origin_id: index.stations[index.stopTimes.station[ref.fromK]].id,
      origin_name: index.stations[index.stopTimes.station[ref.fromK]].name,
      destination_id: index.stations[index.stopTimes.station[ref.toK]].id,
      destination_name: index.stations[index.stopTimes.station[ref.toK]].name,
      departure_time: local(ref.fromK, 'dep'),
      arrival_time: local(ref.toK, 'arr'),
      trip_id: index.trips.ids[ref.tripIdx],
    };
  }

  /** Ligne d'une alerte de ligne : identifiant, sinon nom court + nom long. */
  function lineForAlert(index, a) {
    const exact = index.lineById.get(a.line_id);
    if (exact !== undefined) return [exact];
    const sn = normalize(a.line_name);
    return index.lines
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => l.shortNorm === sn && (!a.line_long_name || l.longName === a.line_long_name))
      .map(({ i }) => i);
  }

  return {
    provider,
    requireIndex, today, realtimeContext,
    searchStations, searchLines, resolveLines, searchJourneys, getJourney, getJourneyRoute, locateJourney,
    matchFavorite, nextOccurrences, favoriteFromJourney, lineForAlert,
  };
}

module.exports = { createTrainService, TrainsError };
