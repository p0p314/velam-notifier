// RealtimeTrainProvider : accès aux flux GTFS-RT (Trip Updates + Service Alerts).
//
// Responsabilité unique : télécharger, décoder (schéma protobuf officiel
// gtfs-realtime.proto), normaliser et mettre en cache. Aucune connaissance des
// horaires théoriques ici : le rapprochement avec le GTFS est fait par merge.js.
//
// Éco-conception : un flux n'est jamais appelé à chaque requête client. Cache court
// mutualisé (TTL ≈ fréquence de mise à jour du producteur, ~2 min pour les Trip
// Updates SNCF), coalescence des appels concurrents, et on ne télécharge rien tant
// que personne ne consulte les trains ou qu'aucune alerte n'est due.
const path = require('path');
const protobuf = require('protobufjs');

let FeedMessage = null;
function feedType() {
  FeedMessage ??= protobuf.loadSync(path.join(__dirname, 'gtfs-realtime.proto')).lookupType('transit_realtime.FeedMessage');
  return FeedMessage;
}

const MAX_BYTES = 30 * 1024 * 1024;

/** Texte traduit GTFS-RT → chaîne, en préférant le français. */
function translated(ts) {
  const list = ts?.translation ?? [];
  if (!list.length) return null;
  const pick = list.find((t) => /^fr/i.test(t.language ?? '')) ?? list.find((t) => !t.language) ?? list[0];
  return pick.text?.trim() || null;
}

const sec = (v) => (v === undefined || v === null ? null : Number(v));
const ms = (v) => (v === undefined || v === null || Number(v) === 0 ? null : Number(v) * 1000);
const ymdOf = (s) => (/^\d{8}$/.test(s ?? '') ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null);

function stopEvent(e) {
  if (!e) return null;
  const delay = sec(e.delay);
  const time = ms(e.time);
  return delay === null && time === null ? null : { delay, time };
}

/** TripUpdate GTFS-RT → objet normalisé (indépendant du protobuf). */
function normalizeTripUpdate(entity) {
  const tu = entity.tripUpdate;
  const trip = tu.trip ?? {};
  return {
    entityId: entity.id,
    tripId: trip.tripId ?? null,
    routeId: trip.routeId ?? null,
    startDate: ymdOf(trip.startDate),
    startTime: trip.startTime ?? null,
    // SNCF omet le champ pour un trajet normal : absent = SCHEDULED (spécification).
    relationship: trip.scheduleRelationship ?? 'SCHEDULED',
    delay: sec(tu.delay),
    timestamp: ms(tu.timestamp),
    stops: (tu.stopTimeUpdate ?? []).map((u) => ({
      seq: u.stopSequence ?? null,
      stopId: u.stopId ?? null,
      arrival: stopEvent(u.arrival),
      departure: stopEvent(u.departure),
      relationship: u.scheduleRelationship ?? 'SCHEDULED',
    })),
  };
}

/** Alert GTFS-RT → objet normalisé. Périodes : impact_period, sinon active_period. */
function normalizeAlert(entity) {
  const a = entity.alert;
  const periods = (a.impactPeriod?.length ? a.impactPeriod : a.activePeriod ?? [])
    .map((p) => ({ start: ms(p.start), end: ms(p.end) }));
  return {
    id: entity.id,
    cause: a.cause ?? 'UNKNOWN_CAUSE',
    effect: a.effect ?? 'UNKNOWN_EFFECT',
    severity: a.severityLevel ?? 'UNKNOWN_SEVERITY',
    header: translated(a.headerText),
    description: translated(a.descriptionText),
    url: translated(a.url),
    periods,
    entities: (a.informedEntity ?? []).map((e) => ({
      routeId: e.routeId ?? null,
      stopId: e.stopId ?? null,
      tripId: e.trip?.tripId ?? null,
      tripRouteId: e.trip?.routeId ?? null,
      startDate: ymdOf(e.trip?.startDate),
    })),
  };
}

/** Décode un FeedMessage protobuf → { timestamp, tripUpdates, alerts }. */
function decodeFeed(bytes) {
  const Type = feedType();
  const msg = Type.toObject(Type.decode(bytes), { longs: Number, enums: String });
  const tripUpdates = [];
  const alerts = [];
  for (const e of msg.entity ?? []) {
    if (e.isDeleted) continue;
    if (e.tripUpdate) tripUpdates.push(normalizeTripUpdate(e));
    if (e.alert) alerts.push(normalizeAlert(e));
  }
  return { timestamp: ms(msg.header?.timestamp), tripUpdates, alerts };
}

/** Encode un FeedMessage (objet JS au format protobufjs) — tests et outillage. */
function encodeFeed(object) {
  const Type = feedType();
  return Buffer.from(Type.encode(Type.fromObject(object)).finish());
}

async function fetchFeed(url, timeoutMs) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { Accept: 'application/x-protobuf' } });
  if (!res.ok) throw new Error(`GTFS-RT ${url} → HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error(`GTFS-RT ${url} : réponse trop volumineuse`);
  return decodeFeed(buf);
}

/**
 * Flux GTFS-RT mis en cache. Renvoie un instantané :
 *   { tripUpdates, alerts, feedTimestamp (ms), fetchedAt (ms), upstreamOk, error? }
 * En cas d'échec, la dernière réponse valide est resservie (upstreamOk: false) ;
 * sans réponse valide antérieure, l'instantané est vide (jamais d'exception) :
 * l'appelant affiche alors les horaires théoriques.
 */
function createFeed({ url, ttlMs, timeoutMs }) {
  let cache = null;      // { at, snapshot }
  let lastGood = null;
  let inflight = null;

  async function get({ force = false, minForceMs = 30_000 } = {}) {
    const age = cache ? Date.now() - cache.at : Infinity;
    if (cache && (age < ttlMs && !(force && age >= minForceMs))) return cache.snapshot;
    if (inflight) return inflight;
    inflight = fetchFeed(url, timeoutMs)
      .then((feed) => {
        const now = Date.now();
        lastGood = { ...feed, feedTimestamp: feed.timestamp ?? now, fetchedAt: now };
        return { ...lastGood, upstreamOk: true };
      })
      .catch((err) => {
        console.error(`[trains] flux temps réel en échec (${url}) :`, err.message);
        return lastGood
          ? { ...lastGood, upstreamOk: false, error: err.message }
          : { tripUpdates: [], alerts: [], feedTimestamp: null, fetchedAt: null, upstreamOk: false, error: err.message };
      })
      .then((snapshot) => {
        cache = { at: Date.now(), snapshot };
        return snapshot;
      })
      .finally(() => { inflight = null; });
    return inflight;
  }

  return {
    get,
    /** Dernier état connu, sans appel réseau (santé). */
    peek: () => cache?.snapshot ?? null,
    peekCheckedAt: () => cache?.at ?? null,
    reset: () => { cache = null; lastGood = null; inflight = null; },
  };
}

/**
 * Fournisseur temps réel : Trip Updates (retards, suppressions) et Service Alerts
 * (perturbations), chacun avec son cache. Les alertes changent moins vite que les
 * retards : TTL plus long.
 */
function createRealtimeProvider({ tripUpdatesUrl, serviceAlertsUrl, env = process.env }) {
  const timeoutMs = Number(env.TRAINS_RT_TIMEOUT_MS) || 15_000;
  const tripUpdates = createFeed({ url: tripUpdatesUrl, ttlMs: Number(env.TRAINS_RT_TTL_MS) || 120_000, timeoutMs });
  const serviceAlerts = createFeed({ url: serviceAlertsUrl, ttlMs: Number(env.TRAINS_ALERTS_TTL_MS) || 300_000, timeoutMs });
  return {
    /** Les deux flux (appels en parallèle, chacun mutualisé). */
    async get({ force = false } = {}) {
      const [tu, sa] = await Promise.all([tripUpdates.get({ force }), serviceAlerts.get({ force })]);
      return { tripUpdates: tu, serviceAlerts: sa };
    },
    peek: () => ({ tripUpdates: tripUpdates.peek(), serviceAlerts: serviceAlerts.peek() }),
    peekCheckedAt: () => ({ tripUpdates: tripUpdates.peekCheckedAt(), serviceAlerts: serviceAlerts.peekCheckedAt() }),
    reset: () => { tripUpdates.reset(); serviceAlerts.reset(); },
  };
}

module.exports = { createRealtimeProvider, decodeFeed, encodeFeed, normalizeTripUpdate, normalizeAlert };
