// Temps GTFS. Une heure GTFS (« 25:10:00 ») est comptée depuis « midi moins 12 h »
// du jour de service, dans le fuseau de l'agence : elle peut dépasser 24:00 (train
// de nuit) et reste juste les jours de changement d'heure. Tout est converti ici
// en millisecondes epoch, sans dépendance (Intl suffit).

/** « HH:MM:SS » (heures possiblement ≥ 24) → secondes ; NaN si invalide. */
function parseGtfsTime(s) {
  const m = /^(\d{1,3}):([0-5]\d):([0-5]\d)$/.exec(s ?? '');
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : NaN;
}

/** 20261007 ⇄ « 2026-10-07 ». */
const ymdToInt = (ymd) => Number(String(ymd).replace(/-/g, ''));
const intToYmd = (n) => {
  const s = String(n);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
};

/** Ajoute `n` jours à une date « YYYY-MM-DD » (calcul calendaire). */
function addDaysYmd(ymd, n) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Jour ISO (1 = lundi … 7 = dimanche) d'une date « YYYY-MM-DD ». */
function isoDay(ymd) {
  const d = new Date(`${ymd}T12:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

const formatters = new Map();
function partsIn(epochMs, tz) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    formatters.set(tz, f);
  }
  const p = Object.fromEntries(f.formatToParts(new Date(epochMs)).map((x) => [x.type, x.value]));
  return {
    year: Number(p.year), month: Number(p.month), day: Number(p.day),
    hour: p.hour === '24' ? 0 : Number(p.hour), minute: Number(p.minute), second: Number(p.second),
  };
}

/** Décalage (ms) du fuseau `tz` par rapport à UTC à l'instant `epochMs`. */
function tzOffsetMs(epochMs, tz) {
  const p = partsIn(epochMs, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(epochMs / 1000) * 1000;
}

const dayStartCache = new Map();
/**
 * Origine des heures GTFS du jour de service `ymd` (« YYYY-MM-DD ») : midi local
 * moins 12 h, en ms epoch. Mémoïsé (quelques centaines de jours au plus).
 */
function serviceDayOrigin(ymd, tz) {
  const key = `${tz}|${ymd}`;
  let v = dayStartCache.get(key);
  if (v === undefined) {
    const [y, m, d] = ymd.split('-').map(Number);
    const guess = Date.UTC(y, m - 1, d, 12);
    let noon = guess - tzOffsetMs(guess, tz);
    noon = guess - tzOffsetMs(noon, tz);
    v = noon - 12 * 3600_000;
    if (dayStartCache.size > 2000) dayStartCache.clear();
    dayStartCache.set(key, v);
  }
  return v;
}

/** Instant (ms epoch) d'une heure GTFS `secs` du jour de service `ymd`. */
const gtfsToEpoch = (ymd, secs, tz) => serviceDayOrigin(ymd, tz) + secs * 1000;

/** Date locale « YYYY-MM-DD » et heure « HH:MM » d'un instant, dans `tz`. */
function localParts(epochMs, tz) {
  const p = partsIn(epochMs, tz);
  const pad = (n) => String(n).padStart(2, '0');
  return {
    date: `${p.year}-${pad(p.month)}-${pad(p.day)}`,
    hhmm: `${pad(p.hour)}:${pad(p.minute)}`,
    secondsOfDay: p.hour * 3600 + p.minute * 60 + p.second,
  };
}

/** « HH:MM » → minutes depuis minuit. */
const hhmmToMin = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));

module.exports = {
  parseGtfsTime, ymdToInt, intToYmd, addDaysYmd, isoDay, tzOffsetMs, serviceDayOrigin, gtfsToEpoch, localParts, hhmmToMin,
};
