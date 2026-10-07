// Voies (quais) des trains : flux SIRI Lite « Estimated Timetable » de la SNCF (PAN,
// sans clé), seule source ouverte qui les publie — ni le GTFS ni le GTFS-RT ne les ont.
//
// Le flux est un gros XML (~25 Mo, non compressé, filtres SIRI sans effet : tout le réseau,
// trains des 60 prochaines minutes, mis à jour toutes les 2 min). Il est donc :
//  - lu à la demande seulement (un train proche de son horaire est consulté), jamais par
//    la boucle d'alerte ;
//  - parcouru en flux, trajet par trajet (EstimatedVehicleJourney), sans garder le texte :
//    seul un petit index « numéro de train | gare (UIC) | jour » → voies est conservé ;
//  - mis en cache 2 min, appels coalescés, dernière réponse valide resservie en cas d'échec.
//
// Format lu de façon tolérante (préfixes d'espace de noms acceptés, champs absents ignorés) :
// le premier téléchargement de chaque instance journalise l'inventaire des balises et un
// extrait, pour vérifier le contenu réel du flux.

const { localParts } = require('./gtfs/time');

const TZ = 'Europe/Paris';
const MAX_PLATFORM = 12;

const reTag = (name) => new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>([^<]*)</(?:[\\w-]+:)?${name}>`);
const reAll = (name) => new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>([^<]*)</(?:[\\w-]+:)?${name}>`, 'g');
const RE_CALL = /<(?:[\w-]+:)?(EstimatedCall|RecordedCall)(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w-]+:)?\1>/g;
const RE_OPEN_TAG = /<(?:[\w-]+:)?([A-Za-z]+)[\s>/]/g;
const RE_EVJ_END = /<\/(?:[\w-]+:)?EstimatedVehicleJourney>/g;
const RE_EVJ_START = /<(?:[\w-]+:)?EstimatedVehicleJourney[\s>]/;

const T = {
  trainNumber: reAll('TrainNumberRef'),
  journeyName: reTag('VehicleJourneyName'),
  datedRef: reTag('DatedVehicleJourneyRef'),
  frameDate: reTag('DataFrameRef'),
  stop: reTag('StopPointRef'),
  aimedDep: reTag('AimedDepartureTime'),
  aimedArr: reTag('AimedArrivalTime'),
  depPlatform: reTag('DeparturePlatformName'),
  arrPlatform: reTag('ArrivalPlatformName'),
};

const unescape = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
const first = (re, src) => { const m = re.exec(src); return m ? unescape(m[1].trim()) : null; };
const normNumber = (n) => String(n).trim().replace(/^0+(?=\d)/, '');
/** Code UIC (8 chiffres) d'une référence d'arrêt : la dernière suite de 8 chiffres. */
const uicOf = (ref) => { const all = String(ref ?? '').match(/\d{8}/g); return all ? all[all.length - 1] : null; };
const platformOf = (v) => (v && v.length <= MAX_PLATFORM ? v : null);

/** Jour de service (AAAA-MM-JJ, heure de Paris) d'un horodatage ISO, sinon `fallback`. */
function dayOf(iso, fallback) {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? fallback : localParts(t, TZ).date;
}

/** Numéros du train : TrainNumberRef, sinon nom du trajet, sinon nombres de la référence. */
function trainNumbersOf(block) {
  const nums = new Set();
  for (const m of block.matchAll(T.trainNumber)) if (/^\d+$/.test(m[1].trim())) nums.add(normNumber(m[1]));
  if (!nums.size) {
    const name = first(T.journeyName, block);
    if (name && /^\d{2,6}$/.test(name)) nums.add(normNumber(name));
  }
  if (!nums.size) {
    const ref = first(T.datedRef, block) ?? '';
    for (const m of ref.matchAll(/(?:^|\D)(\d{3,6})(?=\D|$)/g)) nums.add(normNumber(m[1]));
  }
  return [...nums];
}

/**
 * Lecteur incrémental : `push(texte)` au fil du téléchargement, `done()` à la fin.
 * Résultat : { index: Map « numéro|UIC|jour » → { dep, arr }, stats }.
 */
function createParser({ inventory = false } = {}) {
  let buf = '';
  const index = new Map();
  const stats = { journeys: 0, calls: 0, depPlatforms: 0, arrPlatforms: 0, withoutNumber: 0, tags: inventory ? new Map() : null, sample: null };

  function journey(block) {
    stats.journeys++;
    if (stats.tags) {
      for (const m of block.matchAll(RE_OPEN_TAG)) stats.tags.set(m[1], (stats.tags.get(m[1]) ?? 0) + 1);
      if (!stats.sample) stats.sample = block.slice(0, 3000);
    }
    const numbers = trainNumbersOf(block);
    if (!numbers.length) { stats.withoutNumber++; return; }
    const frameDate = first(T.frameDate, block);
    for (const c of block.matchAll(RE_CALL)) {
      const call = c[2];
      stats.calls++;
      const dep = platformOf(first(T.depPlatform, call));
      const arr = platformOf(first(T.arrPlatform, call));
      if (dep) stats.depPlatforms++;
      if (arr) stats.arrPlatforms++;
      if (!dep && !arr) continue;
      const uic = uicOf(first(T.stop, call));
      const day = dayOf(first(T.aimedDep, call) ?? first(T.aimedArr, call), /^\d{4}-\d{2}-\d{2}$/.test(frameDate ?? '') ? frameDate : null);
      if (!uic || !day) continue;
      for (const n of numbers) index.set(`${n}|${uic}|${day}`, { dep, arr });
    }
  }

  function drain() {
    RE_EVJ_END.lastIndex = 0;
    let consumed = 0;
    let m;
    while ((m = RE_EVJ_END.exec(buf))) {
      const end = m.index + m[0].length;
      const startMatch = RE_EVJ_START.exec(buf.slice(consumed, end));
      if (startMatch) journey(buf.slice(consumed + startMatch.index, end));
      consumed = end;
    }
    // Garde seulement la fin non traitée (un trajet en cours de téléchargement).
    buf = buf.slice(consumed);
    if (buf.length > 2_000_000 && !RE_EVJ_START.test(buf)) buf = buf.slice(-1000);
  }

  return {
    push(text) { buf += text; drain(); },
    done() { drain(); buf = ''; return { index, stats }; },
  };
}

/** Analyse d'un document complet (tests, outillage). */
function parseEstimatedTimetable(xml, opts) {
  const p = createParser(opts);
  p.push(xml);
  return p.done();
}

/** Inventaire lisible : « EstimatedCall 26800, DeparturePlatformName 16300, … » (balises les plus fréquentes). */
function inventoryText(stats, max = 60) {
  if (!stats.tags) return '';
  return [...stats.tags.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([k, v]) => `${k} ${v}`).join(', ');
}

/**
 * Fournisseur de voies : `get({ force })` → instantané { index, stats, fetchedAt,
 * upstreamOk, error? } (null si désactivé) ; `platform(numéro, uic, jour)`.
 */
function createPlatformsProvider({ url, env = process.env, log = console }) {
  const ttlMs = Number(env.TRAINS_SIRI_TTL_MS) || 120_000;
  const timeoutMs = Number(env.TRAINS_SIRI_TIMEOUT_MS) || 45_000;
  const maxBytes = Number(env.TRAINS_SIRI_MAX_BYTES) || 80 * 1024 * 1024;
  const enabled = !!url && url !== 'off';
  let cache = null; // { at, snapshot }
  let lastGood = null;
  let inflight = null;
  let inventoryLogged = false;

  async function download() {
    const started = Date.now();
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { Accept: 'application/xml, text/xml', 'Accept-Encoding': 'gzip' } });
    if (!res.ok) throw new Error(`SIRI ET ${res.status}`);
    const parser = createParser({ inventory: !inventoryLogged });
    const decoder = new TextDecoder();
    let bytes = 0;
    for await (const chunk of res.body) {
      bytes += chunk.length;
      if (bytes > maxBytes) throw new Error('SIRI ET : réponse trop volumineuse');
      parser.push(decoder.decode(chunk, { stream: true }));
    }
    parser.push(decoder.decode());
    const { index, stats } = parser.done();
    if (!stats.journeys) throw new Error('SIRI ET : aucun trajet lu');
    if (!inventoryLogged) {
      inventoryLogged = true;
      log.log(`[trains] SIRI ET : ${stats.journeys} trajets, ${stats.calls} passages, voies départ ${stats.depPlatforms} / arrivée ${stats.arrPlatforms}, sans numéro ${stats.withoutNumber}, ${index.size} entrées, ${(bytes / 1e6).toFixed(1)} Mo en ${Date.now() - started} ms`);
      log.log(`[trains] SIRI ET — balises : ${inventoryText(stats)}`);
      log.log(`[trains] SIRI ET — extrait : ${stats.sample?.replace(/\s+/g, ' ')}`);
      stats.tags = null;
      stats.sample = null;
    }
    return { index, stats, bytes };
  }

  async function get({ force = false, minForceMs = 30_000 } = {}) {
    if (!enabled) return null;
    const age = cache ? Date.now() - cache.at : Infinity;
    if (cache && age < ttlMs && !(force && age >= minForceMs)) return cache.snapshot;
    if (inflight) return inflight;
    inflight = download()
      .then(({ index, stats }) => {
        lastGood = { index, stats, fetchedAt: Date.now() };
        return { ...lastGood, upstreamOk: true };
      })
      .catch((err) => {
        log.error('[trains] voies (SIRI ET) indisponibles :', err.message);
        return lastGood ? { ...lastGood, upstreamOk: false, error: err.message } : { index: new Map(), stats: null, fetchedAt: null, upstreamOk: false, error: err.message };
      })
      .then((snapshot) => { cache = { at: Date.now(), snapshot }; return snapshot; })
      .finally(() => { inflight = null; });
    return inflight;
  }

  return {
    enabled,
    get,
    /** Voies d'un passage : { dep, arr } (chacune null si inconnue). */
    platform(snapshot, trainNumber, uic, day) {
      if (!snapshot || !trainNumber || !uic || !day) return null;
      return snapshot.index.get(`${normNumber(trainNumber)}|${uic}|${day}`) ?? null;
    },
    peek: () => cache?.snapshot ?? null,
    reset: () => { cache = null; lastGood = null; inflight = null; inventoryLogged = false; },
  };
}

module.exports = { createPlatformsProvider, parseEstimatedTimetable, createParser, uicOf, inventoryText };
