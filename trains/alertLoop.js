// Boucle d'alerte du module Trains (distincte de celle des vélos, même principes) :
//  - un cycle par minute, jamais deux en même temps ;
//  - rien n'est téléchargé tant qu'aucune alerte n'est active ET due : une alerte de
//    trajet est due de TRAIN_LEAD_MIN avant le départ prévu jusqu'à l'arrivée, une
//    alerte de ligne pendant son créneau horaire, les jours choisis ;
//  - aucune notification sur des données temps réel absentes ou trop anciennes
//    (horaires théoriques ⇒ ni retard ni suppression inventés) ;
//  - idempotence : chaque événement a une clé (« delay:2026-10-07:10 »,
//    « cancel:2026-10-07 », « alert:<id> »…) enregistrée AVANT l'envoi dans
//    train_notifications (unique par alerte) : un même événement ne part qu'une fois.
const {
  countActiveTrainAlerts, getActiveTrainAlerts, recordTrainNotification, hasTrainNotification, purgeTrainNotifications,
} = require('../db');
const { getProvider, DEFAULT_PROVIDER } = require('./index');
const { buildJourney, isMajorAlert } = require('./merge');
const { addDaysYmd, isoDay, gtfsToEpoch, localParts, hhmmToMin } = require('./gtfs/time');
const { notify } = require('./notifier');

const POLL_MS = 60_000;
const LEAD_MIN = 180;            // surveillance à partir de 3 h avant le départ prévu
const DELAY_STEP_MIN = 10;       // nouvelle notification par palier de 10 min de retard en plus
const DELAY_CLEARED_MAX_MIN = 2; // « retard résorbé » quand il retombe à 2 min ou moins
const PURGE_AFTER_MS = 45 * 86_400_000;

// ── Évaluation (pure) ───────────────────────────────────────────────────────

const daysOf = (alert) => String(alert.days || '1,2,3,4,5,6,7').split(',').map(Number);

/**
 * Événements d'une alerte de trajet pour un TrainJourney (avec temps réel).
 * Renvoie [{ type, key, requires? }] ; `requires` : préfixe d'un événement qui doit
 * avoir été notifié auparavant (« retard résorbé » seulement après un retard notifié).
 */
function tripEvents(alert, j) {
  const events = [];
  if (!j.realtime && !j.alerts.length) return events; // théorique : rien à signaler
  const d = j.serviceDate;
  if (j.status === 'cancelled') {
    if (alert.on_cancel) events.push({ type: 'cancel', key: `cancel:${d}` });
    return events;
  }
  if (alert.delay_threshold !== null && alert.delay_threshold !== undefined && j.realtime) {
    const delay = Math.max(j.departureDelay ?? -Infinity, j.arrivalDelay ?? -Infinity);
    if (delay >= alert.delay_threshold) {
      const level = alert.delay_threshold + DELAY_STEP_MIN * Math.floor((delay - alert.delay_threshold) / DELAY_STEP_MIN);
      events.push({ type: 'delay', key: `delay:${d}:${level}`, delay });
    } else if (delay !== -Infinity && delay <= DELAY_CLEARED_MAX_MIN) {
      events.push({ type: 'delay_cleared', key: `delay_cleared:${d}`, requires: `delay:${d}:` });
    }
  }
  if (alert.on_disruption) {
    for (const a of j.alerts) {
      if (a.major && a.scope !== 'station') events.push({ type: 'disruption', key: `alert:${a.id}`, alert: a });
    }
  }
  return events;
}

/** Une alerte de ligne est-elle due maintenant (jour + créneau facultatif) ? */
function lineAlertDue(alert, { date, hhmm }) {
  if (!daysOf(alert).includes(isoDay(date))) return false;
  if (!alert.time_start || !alert.time_end) return true;
  const { time_start: s, time_end: e } = alert;
  return s <= e ? hhmm >= s && hhmm <= e : hhmm >= s || hhmm <= e;
}

/**
 * Événements d'une alerte de ligne : perturbations importantes en cours (ou à venir
 * dans la journée) et trains supprimés de la ligne au départ encore à venir.
 */
function lineEvents(alert, index, rtIndex, lineSet, now) {
  const events = [];
  const endOfDay = now + 24 * 3600_000;
  if (alert.on_disruption) {
    rtIndex.alerts.forEach((a, i) => {
      if (![...rtIndex.linesOfAlert[i]].some((l) => lineSet.has(l))) return;
      const active = !a.periods.length || a.periods.some((p) => (p.start ?? -Infinity) <= endOfDay && (p.end ?? Infinity) >= now);
      if (active && isMajorAlert(a)) events.push({ type: 'line_disruption', key: `alert:${a.id}`, alert: a });
    });
  }
  if (alert.on_cancel) {
    for (const [key, u] of rtIndex.trips) {
      if (u.relationship !== 'CANCELED') continue;
      const [t, date] = [Number(key.split('|')[0]), key.split('|')[1]];
      if (!lineSet.has(index.trips.line[t])) continue;
      const first = index.trips.start[t];
      const dep = gtfsToEpoch(date, index.stopTimes.dep[first], index.tz);
      if (dep < now - 15 * 60_000 || dep > endOfDay) continue;
      events.push({ type: 'line_cancel', key: `cancel:${date}:${index.trips.number[t] || index.trips.ids[t]}`, tripIdx: t, date });
    }
  }
  return events;
}

// ── Messages ────────────────────────────────────────────────────────────────

const appBase = () => (process.env.APP_URL || 'https://velam-notifier.onrender.com').replace(/\/$/, '');
const hm = (isoStr, tz) => (isoStr ? localParts(Date.parse(isoStr), tz).hhmm : '');
const truncate = (s, n = 180) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s ?? '');

function tripTitle(j, tz) {
  return `${j.lineName ? `${j.lineName} ` : ''}${hm(j.scheduledDeparture, tz)} ${j.departureStation.name} → ${j.arrivalStation.name}`;
}

/** Titre + corps + lien d'une notification d'alerte de trajet. */
function tripMessage(event, j, tz) {
  const url = `${appBase()}/trains/trajet?id=${encodeURIComponent(j.id)}`;
  const tag = `train-${j.trainNumber || j.tripId}-${j.serviceDate}`;
  const what = tripTitle(j, tz);
  switch (event.type) {
    case 'cancel':
      return { title: `❌ Train supprimé — ${what}`, body: j.cancellation?.reason ?? 'Train supprimé', url, tag };
    case 'delay': {
      const parts = [];
      if (j.estimatedDeparture) parts.push(`Départ estimé ${hm(j.estimatedDeparture, tz)}`);
      if (j.estimatedArrival) parts.push(`arrivée estimée ${hm(j.estimatedArrival, tz)}`);
      return { title: `⏱ +${event.delay} min — ${what}`, body: parts.join(' · ') || 'Retard annoncé', url, tag };
    }
    case 'delay_cleared':
      return { title: `✅ Retard résorbé — ${what}`, body: `Départ ${hm(j.estimatedDeparture ?? j.scheduledDeparture, tz)} · arrivée ${hm(j.estimatedArrival ?? j.scheduledArrival, tz)}`, url, tag };
    default:
      return { title: `⚠️ Perturbation — ${what}`, body: truncate(event.alert.header || event.alert.description || 'Perturbation signalée'), url, tag: `${tag}-alert` };
  }
}

function lineLabel(alert) {
  return `${alert.line_name || 'Ligne'}${alert.line_long_name ? ` (${alert.line_long_name})` : ''}`;
}

function lineMessage(event, alert, index) {
  const url = `${appBase()}/trains?onglet=mes-trains`;
  if (event.type === 'line_cancel') {
    const t = event.tripIdx;
    const first = index.trips.start[t];
    const last = index.trips.start[t + 1] - 1;
    const st = (k) => index.stations[index.stopTimes.station[k]].name;
    const dep = localParts(gtfsToEpoch(event.date, index.stopTimes.dep[first], index.tz), index.tz).hhmm;
    return {
      title: `❌ ${alert.line_name || 'Ligne'} : train ${index.trips.number[t] || ''} supprimé`.replace('  ', ' '),
      body: `${dep} ${st(first)} → ${st(last)}`,
      url, tag: `line-${alert.id}-cancel-${index.trips.number[t]}-${event.date}`,
    };
  }
  return {
    title: `⚠️ ${lineLabel(alert)}`,
    body: truncate(event.alert.header || event.alert.description || 'Perturbation signalée'),
    url, tag: `line-${alert.id}-${event.alert.id}`,
  };
}

// ── Cycle ───────────────────────────────────────────────────────────────────

/** Enregistre puis envoie : un événement déjà présent dans le journal n'est jamais renvoyé. */
async function emit(alert, event, message, now) {
  if (event.requires && !(await hasTrainNotification(alert.id, event.requires))) return false;
  const fresh = await recordTrainNotification(alert.user_id, alert.id, event.key, event.type, now);
  if (!fresh) return false;
  await notify(alert.user_id, message);
  return true;
}

/** Favori sous la forme attendue par matchFavorite (colonnes `fav_*` de la jointure). */
const favOf = (a) => ({
  train_number: a.fav_train_number, line_name: a.fav_line_name, origin_id: a.fav_origin_id,
  destination_id: a.fav_destination_id, departure_time: a.fav_departure_time,
});

/**
 * Un cycle. `date` injectable pour les tests. Renvoie le résultat :
 * aucune_alerte | horaires_indisponibles | aucune_due | donnees_perimees | verifiees.
 */
async function checkTrainAlerts(date = new Date()) {
  if (await countActiveTrainAlerts() === 0) return 'aucune_alerte';
  const provider = getProvider(DEFAULT_PROVIDER);
  const service = provider.service;
  const index = provider.schedule.getIndex();
  if (!index) return 'horaires_indisponibles';
  const now = date.getTime();
  const local = localParts(now, index.tz);

  const alerts = (await getActiveTrainAlerts(local.date)).filter((a) => (a.provider || DEFAULT_PROVIDER) === provider.id);
  const due = [];
  for (const a of alerts) {
    if (a.scope === 'line') {
      if (lineAlertDue(a, local)) due.push({ a });
      continue;
    }
    if (!a.fav_origin_id) continue; // favori supprimé entre-temps
    for (const d of [addDaysYmd(local.date, -1), local.date, addDaysYmd(local.date, 1)]) {
      if (!daysOf(a).includes(isoDay(d))) continue;
      const m = service.matchFavorite(index, favOf(a), d);
      if (!m) continue;
      const dep = gtfsToEpoch(m.ref.date, index.stopTimes.dep[m.ref.fromK], index.tz);
      const arr = gtfsToEpoch(m.ref.date, index.stopTimes.arr[m.ref.toK], index.tz);
      // Jusqu'à l'arrivée prévue + 2 h (un train très en retard reste surveillé).
      if (now >= dep - LEAD_MIN * 60_000 && now <= arr + 2 * 3600_000) due.push({ a, ref: m.ref });
    }
  }
  if (!due.length) return 'aucune_due';

  const { rt } = await service.realtimeContext(index, [addDaysYmd(local.date, -1), local.date], { now });
  if (!rt) {
    console.warn('[trains] temps réel indisponible ou périmé — cycle d\'alerte ignoré');
    return 'donnees_perimees';
  }

  for (const { a, ref } of due) {
    try {
      if (a.scope === 'line') {
        const lineSet = new Set(service.lineForAlert(index, a));
        if (!lineSet.size) continue;
        for (const ev of lineEvents(a, index, rt.index, lineSet, now)) await emit(a, ev, lineMessage(ev, a, index), now);
      } else {
        const j = buildJourney(index, ref, { rt, now, conventions: provider.conventions });
        // Un train arrivé (heure estimée dépassée) ne génère plus rien.
        if (j.phase === 'arrived') continue;
        for (const ev of tripEvents(a, j)) await emit(a, ev, tripMessage(ev, j, index.tz), now);
      }
    } catch (err) {
      console.error(`[trains] alerte ${a.id} :`, err.message);
    }
  }
  return 'verifiees';
}

// ── Ordonnancement ──────────────────────────────────────────────────────────

let timer = null;
let running = false;
const loop = { runs: 0, lastRunAt: null, lastOutcome: null, lastError: null, lastPurgeAt: 0 };

async function runTrainCycle(date) {
  if (running) return;
  running = true;
  const started = Date.now();
  try {
    loop.lastOutcome = await checkTrainAlerts(date);
    if (started - loop.lastPurgeAt > 6 * 3600_000) {
      loop.lastPurgeAt = started;
      await purgeTrainNotifications(started - PURGE_AFTER_MS);
    }
  } catch (err) {
    loop.lastOutcome = 'erreur';
    loop.lastError = { message: err.message, at: new Date().toISOString() };
    console.error('[trains] boucle', err.message);
  } finally {
    loop.runs++;
    loop.lastRunAt = started;
    running = false;
  }
}

function startTrainAlerts() {
  if (timer || process.env.TRAINS_ENABLED === '0') return;
  timer = setInterval(runTrainCycle, POLL_MS);
  console.log(`[trains] boucle d'alerte activée (toutes les ${POLL_MS / 1000}s)`);
}

function stopTrainAlerts() {
  if (timer) { clearInterval(timer); timer = null; }
}

function getTrainLoopHealth(nowMs = Date.now()) {
  const lag = loop.lastRunAt === null ? null : nowMs - loop.lastRunAt;
  return {
    started: !!timer,
    healthy: !!timer && lag !== null && lag < 3 * POLL_MS && loop.lastOutcome !== 'erreur',
    runs: loop.runs,
    last_run_at: loop.lastRunAt ? new Date(loop.lastRunAt).toISOString() : null,
    last_outcome: loop.lastOutcome,
    last_error: loop.lastError,
    interval_s: POLL_MS / 1000,
  };
}

module.exports = {
  checkTrainAlerts, runTrainCycle, startTrainAlerts, stopTrainAlerts, getTrainLoopHealth,
  tripEvents, lineEvents, lineAlertDue, tripMessage, LEAD_MIN,
};
