const webpush = require('web-push');
const {
  getConfig, setConfig,
  countActiveAlerts, getActiveAlerts, deleteExpiredAlerts, markAlertNotified, setAlertNotifiedKey,
  getSubscriptionsByUser, removeSubscriptionById, getStations,
} = require('./db');
const { getStationStatus, isFresh } = require('./gbfs');
const { stationCity, DEFAULT_CITY } = require('./cities');
const { nowInTz, inWindow } = require('./time');
const { distanceKm, fmtDistance } = require('./geo');

const POLL_MS = 30_000;
const OFFICIAL_URL = 'https://velam.amiens.fr/fr/home';

let _vapidPublic = null; // mis en cache au démarrage (accès sync depuis la route)

/**
 * Configure web-push. En prod : clés VAPID depuis les variables d'env.
 * En dev : lues/générées dans SQLite (logique existante conservée).
 */
async function initPush() {
  let publicKey, privateKey;

  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    publicKey  = process.env.VAPID_PUBLIC_KEY;
    privateKey = process.env.VAPID_PRIVATE_KEY;
  } else {
    publicKey  = await getConfig('vapid_public');
    privateKey = await getConfig('vapid_private');
    if (!publicKey || !privateKey) {
      const keys = webpush.generateVAPIDKeys();
      publicKey  = keys.publicKey;
      privateKey = keys.privateKey;
      await setConfig('vapid_public', publicKey);
      await setConfig('vapid_private', privateKey);
      console.log('[push] Clés VAPID générées et persistées');
    }
  }

  _vapidPublic = publicKey;
  const subject = 'mailto:' + (process.env.VAPID_EMAIL || 'admin@velopulse.app');
  webpush.setVapidDetails(subject, publicKey, privateKey);
  return publicKey;
}

function getVapidPublicKey() {
  return _vapidPublic;
}

// ── Lecture du statut live ─────────────────────────────────────────────────────

/**
 * Vélos disponibles d'un type à une station. 'ebike' (UI/DB) ↔ 'electrical' (GBFS).
 * Une station qui ne loue pas (is_renting=false) n'a aucun vélo utilisable ;
 * une station absente du flux compte pour 0.
 */
function countForType(status, bikeType) {
  if (!status || status.is_renting === false) return 0;
  if (bikeType === 'any') return status.num_bikes_available ?? 0;
  const typeId = bikeType === 'ebike' ? 'electrical' : 'mechanical';
  return (status.vehicle_types_available ?? []).find((v) => v.vehicle_type_id === typeId)?.count ?? 0;
}

/** Places libres pour déposer un vélo (0 si la station ne reprend pas les vélos). */
function docksOf(status) {
  if (!status || status.is_returning === false) return 0;
  return status.num_docks_available ?? 0;
}

const compare = (count, comparison, threshold) =>
  comparison === 'at_least' ? count >= threshold : count <= threshold;

/**
 * Évalue une alerte sur le statut live.
 * Renvoie { triggered, key, count, arrivalDocks? } où `key` résume l'état notifié :
 * l'anti-spam re-notifie seulement quand cette clé change.
 */
function evaluateAlert(alert, statusMap) {
  const measure = (status) => (alert.target === 'docks' ? docksOf(status) : countForType(status, alert.bike_type));

  if (alert.group_stations?.length) {
    // Groupe : la règle porte sur la meilleure station (« au plus N » ⇒ toutes sont
    // basses ; « au moins N » ⇒ une suffit). La clé = le détail de chaque station.
    const counts = alert.group_stations.map((s) => measure(statusMap[s.station_id]));
    const count = Math.max(...counts);
    const departureHit = compare(count, alert.comparison, alert.threshold);
    return { triggered: departureHit, key: counts.join('|'), count, counts, departureHit };
  }

  const count = measure(statusMap[alert.station_id]);
  const departureHit = compare(count, alert.comparison, alert.threshold);

  if (!alert.arrival_station_id) {
    return { triggered: departureHit, key: String(count), count, departureHit };
  }
  // Trajet : problème au départ (peu de vélos) OU à l'arrivée (peu de places).
  const arrivalDocks = docksOf(statusMap[alert.arrival_station_id]);
  const arrivalHit = arrivalDocks <= alert.arrival_threshold;
  return {
    triggered: departureHit || arrivalHit,
    key: `${count}|${arrivalDocks}`,
    count, arrivalDocks, departureHit, arrivalHit,
  };
}

// ── Station de repli ───────────────────────────────────────────────────────────

// Au-delà, marcher jusqu'à la station de repli n'a plus d'intérêt.
const FALLBACK_MAX_KM = 1;

/**
 * Station la plus proche de `stationId` (≤ FALLBACK_MAX_KM) où `measure(status)`
 * dépasse strictement `threshold` — c.-à-d. qui ne poserait pas le même problème.
 * Renvoie { name, km, count } ou null.
 */
function findFallback(stationId, stations, statusMap, measure, threshold) {
  const origin = stations.find((s) => s.station_id === stationId);
  if (!origin) return null;
  let best = null;
  for (const s of stations) {
    if (s.station_id === stationId) continue;
    const count = measure(statusMap[s.station_id]);
    if (count <= threshold) continue;
    const km = distanceKm(origin, s);
    if (km > FALLBACK_MAX_KM) continue;
    if (!best || km < best.km || (km === best.km && count > best.count)) best = { name: s.name, km, count };
  }
  return best;
}

/**
 * Stations de repli pertinentes pour une alerte déclenchée « en creux » (au plus N) :
 * vélos ailleurs si le départ manque de vélos, places ailleurs si l'arrivée (ou la
 * station surveillée) manque de places. Aucune pour les alertes « au moins N ».
 */
function fallbacksFor(alert, ev, stations, statusMap) {
  // Un groupe couvre déjà les stations alternatives choisies par l'utilisateur.
  if (alert.comparison !== 'at_most' || alert.group_stations?.length || !stations?.length) return {};
  const bikes = (st) => countForType(st, alert.bike_type);
  const out = {};
  if (ev.departureHit) {
    out.departure = alert.target === 'docks'
      ? findFallback(alert.station_id, stations, statusMap, docksOf, alert.threshold)
      : findFallback(alert.station_id, stations, statusMap, bikes, alert.threshold);
  }
  if (ev.arrivalHit) {
    out.arrival = findFallback(alert.arrival_station_id, stations, statusMap, docksOf, alert.arrival_threshold);
  }
  return out;
}

// ── Envoi ──────────────────────────────────────────────────────────────────────

/** Envoie à tous les appareils du compte. Renvoie { total, sent }. */
async function sendToUser(userId, payload) {
  const subs = await getSubscriptionsByUser(userId);
  let sent = 0;
  await Promise.all(subs.map(async (row) => {
    try {
      await webpush.sendNotification(JSON.parse(row.subscription), JSON.stringify(payload), {
        urgency: 'high', // réveille l'appareil même en veille
        TTL: 300,        // notif valable 5 min max (au-delà, vélos périmés → abandon)
      });
      sent++;
    } catch (err) {
      // Subscription expirée / invalide → suppression en base
      if (err.statusCode === 404 || err.statusCode === 410) {
        await removeSubscriptionById(row.id);
        console.log(`[push] subscription ${row.id} expirée — supprimée`);
      } else {
        console.error('[push] échec envoi', err.statusCode, err.body ?? err.message);
      }
    }
  }));
  return { total: subs.length, sent };
}

// ── Construction du payload ─────────────────────────────────────────────────────

// Le SW iOS ne peut pas ouvrir directement une URL cross-origin via clients.openWindow().
// On passe par /open (même domaine) qui répond avec une page de redirection vers
// l'app Vélam (deep link) puis le store, puis le site.
// Hors Amiens : `city` désigne l'application de la ville (site et nom du service).
function buildRedirectUrl(stationId = null) {
  const base = (process.env.APP_URL || 'https://velam-notifier.onrender.com').replace(/\/$/, '');
  const city = stationCity(stationId);
  return `${base}/open?url=${encodeURIComponent(OFFICIAL_URL)}${city === DEFAULT_CITY ? '' : `&city=${city}`}`;
}

const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;

function bikesLabel(bikeType, n) {
  const kind = bikeType === 'ebike' ? ' électrique' : bikeType === 'mechanical' ? ' mécanique' : '';
  return `${n} vélo${n > 1 ? 's' : ''}${kind}${kind && n > 1 ? 's' : ''}`;
}

const docksLabel = (n) => (n > 1 ? `${n} places libres` : `${n} place libre`);

/** Texte « N vélos » ou « N places libres » selon ce que surveille l'alerte. */
function describeDeparture(alerte, n) {
  return alerte.target === 'docks' ? docksLabel(n) : bikesLabel(alerte.bike_type, n);
}

/**
 * Titre + corps de la notification selon le type d'alerte.
 * `ev` : résultat de evaluateAlert.
 */
function buildMessage(alerte, ev) {
  const n = ev.count;

  if (alerte.group_stations?.length) return buildGroupMessage(alerte, ev);

  if (alerte.arrival_station_id) {
    const parts = [
      `Départ ${alerte.station_name} : ${bikesLabel(alerte.bike_type, n)}`,
      `Arrivée ${alerte.arrival_station_name} : ${plural(ev.arrivalDocks, 'place')}`,
    ];
    const urgent = (ev.departureHit && n === 0) || (ev.arrivalHit && ev.arrivalDocks === 0);
    return {
      title: `${urgent ? '⚠️ ' : ''}Trajet ${alerte.station_name} → ${alerte.arrival_station_name}`,
      body: parts.join(' · '),
    };
  }

  const what = describeDeparture(alerte, n);
  if (alerte.comparison === 'at_least') {
    return {
      title: `✅ Mox — ${alerte.station_name}`,
      body: alerte.target === 'docks' ? `${what} · C'est le moment` : `${what} disponible${n > 1 ? 's' : ''} · C'est le moment`,
    };
  }
  if (n === 0) {
    return {
      title: `⚠️ Mox — ${alerte.station_name}`,
      body: alerte.target === 'docks'
        ? 'Plus aucune place libre pour déposer un vélo'
        : `Plus aucun ${bikesLabel(alerte.bike_type, 1).replace(/^1 /, '')} disponible`,
    };
  }
  return {
    title: `Mox — ${alerte.station_name}`,
    body: alerte.target === 'docks'
      ? `Plus que ${what} · Pensez à une autre station`
      : `${what} disponible${n > 1 ? 's' : ''} · Réservez vite`,
  };
}

/**
 * Groupe : « Maison : peu de vélos » + le détail « Gare : 0 · Cathédrale : 1 ».
 * `ev.count` = meilleure station du groupe, `ev.counts` = une valeur par station.
 */
function buildGroupMessage(alerte, ev) {
  const label = alerte.group_name || 'Vos stations';
  const docks = alerte.target === 'docks';
  const kinds = docks ? 'places libres' : bikesLabel(alerte.bike_type, 2).replace(/^2 /, '');
  let title;
  if (alerte.comparison === 'at_least') {
    title = `✅ ${label} : ${kinds} disponibles`;
  } else if (ev.count === 0) {
    title = `⚠️ ${label} : ${docks ? 'plus aucune place libre' : `plus aucun ${bikesLabel(alerte.bike_type, 1).replace(/^1 /, '')}`}`;
  } else {
    title = `${label} : peu de ${kinds}`;
  }
  const body = alerte.group_stations
    .map((s, i) => `${s.station_name} : ${ev.counts?.[i] ?? 0}`)
    .join(' · ');
  return { title, body };
}

/** « Cathédrale (350 m) : 6 vélos » */
function describeFallback(f, unit) {
  return `${f.name} (${fmtDistance(f.km)}) : ${unit(f.count)}`;
}

/** Ajoute les stations de repli au corps du message. */
function withFallbacks(message, alerte, fallbacks = {}) {
  const bikes = (n) => bikesLabel(alerte.bike_type, n);
  const extra = [];
  if (alerte.arrival_station_id) {
    if (fallbacks.departure) extra.push(`Repli départ : ${describeFallback(fallbacks.departure, bikes)}`);
    if (fallbacks.arrival) extra.push(`Repli arrivée : ${describeFallback(fallbacks.arrival, docksLabel)}`);
  } else if (fallbacks.departure) {
    extra.push(`Repli : ${describeFallback(fallbacks.departure, alerte.target === 'docks' ? docksLabel : bikes)}`);
  }
  return extra.length ? { ...message, body: `${message.body}\n${extra.join('\n')}` } : message;
}

function buildPayload(alerte, ev, fallbacks) {
  return {
    ...withFallbacks(buildMessage(alerte, ev), alerte, fallbacks),
    // Toujours une URL https:// (page /open interne) → ouvrable par le SW iOS.
    url:       buildRedirectUrl(alerte.station_id),
    stationId: alerte.station_id,
    icon:      '/icon-192.png',
    badge:     '/badge-72.png',
  };
}

// ── Résumé à heure fixe ────────────────────────────────────────────────────────

const TYPE_SHORT = { mechanical: 'méca', ebike: 'élec' };

/**
 * Vélos d'une station pour un résumé : « 3 », ou « 2 méca · 1 élec » pour les deux
 * types ; « indisponible » si la station ne loue pas ou est absente du flux.
 */
function summaryLine(status, bikeType) {
  if (!status || status.is_renting === false) return 'indisponible';
  if (bikeType !== 'any') return String(countForType(status, bikeType));
  return ['mechanical', 'ebike'].map((t) => `${countForType(status, t)} ${TYPE_SHORT[t]}`).join(' · ');
}

/** « 📊 Maison — vélos électriques » + une ligne par station. */
function buildSummaryPayload(alerte, statusMap) {
  const label = alerte.group_name || 'Vos stations';
  const kind = alerte.bike_type === 'any' ? 'vélos' : bikesLabel(alerte.bike_type, 2).replace(/^2 /, '');
  return {
    title: `📊 ${label} — ${kind}`,
    body: (alerte.group_stations ?? [])
      .map((s) => `${s.station_name} : ${summaryLine(statusMap[s.station_id], alerte.bike_type)}`)
      .join('\n'),
    url:       buildRedirectUrl(alerte.station_id),
    stationId: alerte.station_id,
    icon:      '/icon-192.png',
    badge:     '/badge-72.png',
  };
}

/** Notification de test : ouvre la page Alertes de l'app au clic. */
function buildTestPayload() {
  const base = (process.env.APP_URL || 'https://velam-notifier.onrender.com').replace(/\/$/, '');
  return {
    title: 'Mox — Notification de test',
    body:  'Les notifications fonctionnent sur cet appareil 👍',
    url:   `${base}/alertes`,
    stationId: 'test',
    icon:  '/icon-192.png',
    badge: '/badge-72.png',
  };
}

// ── Boucle de vérification ──────────────────────────────────────────────────────

/** L'alerte couvre-t-elle l'instant présent (créneau + jour, ou jour de l'alerte ponctuelle) ? */
function isDue(alert, { hhmm, isoDay, date }) {
  if (!inWindow(hhmm, alert.time_start, alert.time_end)) return false;
  if (alert.valid_on) return alert.valid_on === date;
  return alert.days ? alert.days.split(',').map(Number).includes(isoDay) : true;
}

// Retard toléré après l'heure d'un résumé (boucle en pause, flux Vélam momentanément
// périmé…). Au-delà, un résumé « de 8 h » reçu à midi induirait en erreur : on l'abandonne.
const SUMMARY_GRACE_MIN = 15;
const minutesOf = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/**
 * Heure de résumé à envoyer maintenant (« HH:MM »), ou null : bon jour, heure atteinte
 * depuis au plus 15 min, et pas encore envoyée aujourd'hui. `last_notified_key` garde la
 * dernière heure envoyée du jour : les heures ≤ à celle-ci sont faites (heures triées,
 * comparées en texte). Si deux heures sont dans la tolérance, seule la plus récente part.
 */
function summarySlotDue(alert, { hhmm, isoDay, date }) {
  if (!alert.days.split(',').map(Number).includes(isoDay)) return null;
  const sentUpTo = alert.last_notified_date === date ? alert.last_notified_key ?? '' : null;
  const slot = (alert.send_times ?? [alert.time_start])
    .filter((t) => {
      const late = minutesOf(hhmm) - minutesOf(t);
      return late >= 0 && late <= SUMMARY_GRACE_MIN;
    })
    .pop();
  if (!slot) return null;
  // Envoi d'avant la v1.5 (clé NULL, date du jour) : l'heure unique est faite.
  if (sentUpTo === '') return null;
  return sentUpTo !== null && slot <= sentUpTo ? null : slot;
}

/** Résumé à envoyer maintenant (au moins une de ses heures est due). */
const isSummaryDue = (alert, now) => summarySlotDue(alert, now) !== null;

/** `date` injectable pour les tests (défaut : maintenant). */
async function checkAlerts(date = new Date()) {
  // Ne rien faire si aucune alerte active n'existe en base
  if (await countActiveAlerts() === 0) return 'aucune_alerte';

  // Heure / jour / date courants dans le fuseau des alertes (pas l'UTC serveur).
  const now = nowInTz(date);
  await deleteExpiredAlerts(now.date); // alertes ponctuelles des jours passés

  // Seulement les alertes de la ville choisie par le compte (les autres sont conservées,
  // masquées, et ne sont plus envoyées — comme une fonctionnalité désactivée).
  const due = (await getActiveAlerts(now.date))
    .filter((a) => stationCity(a.station_id) === (a.user_city ?? DEFAULT_CITY))
    .filter((a) => (a.kind === 'summary' ? isSummaryDue(a, now) : isDue(a, now)));
  if (due.length === 0) return 'aucune_due';

  // Une ville à la fois, et seulement celles qui ont une alerte due.
  const byCity = new Map();
  for (const a of due) {
    const c = stationCity(a.station_id);
    if (!byCity.has(c)) byCity.set(c, []);
    byCity.get(c).push(a);
  }
  const outcomes = [];
  for (const [city, alerts] of byCity) outcomes.push(await checkCity(city, alerts, now));
  // Résultat du cycle : celui d'Amiens s'il y en a, sinon le premier (santé de la boucle).
  return outcomes.includes('verifiees') ? undefined : outcomes[0];
}

/** Évalue les alertes dues d'une ville (un seul appel GBFS pour toutes). */
async function checkCity(city, due, now) {
  let status;
  try {
    status = await getStationStatus(city);
  } catch (err) {
    console.error(`[push] fetch GBFS status (${city})`, err.message);
    return 'flux_indisponible';
  }
  // Flux en panne ou données figées : on n'alerte pas sur des chiffres périmés.
  if (!isFresh(status)) {
    console.warn(`[push] disponibilités périmées (${city}) — alertes de cette ville ignorées`);
    return 'donnees_perimees';
  }

  const statusMap = Object.fromEntries(status.stations.map((s) => [s.station_id, s]));

  // Référentiel (coordonnées) pour les stations de repli — lu en base, 1 fois par cycle.
  let stations = [];
  try {
    stations = await getStations(city);
  } catch (err) {
    console.error('[push] lecture stations', err.message); // dégrade : pas de repli
  }

  for (const alert of due) {
    if (alert.kind === 'summary') {
      // Une fois par heure d'envoi : date + dernière heure envoyée empêchent tout doublon.
      const slot = summarySlotDue(alert, now);
      await sendToUser(alert.user_id, buildSummaryPayload(alert, statusMap));
      await markAlertNotified(alert.id, now.date, slot);
      continue;
    }
    const ev = evaluateAlert(alert, statusMap);
    const notifiedToday = alert.last_notified_date === now.date;

    if (ev.triggered) {
      // Première atteinte du jour, ou état changé depuis la dernière notification
      // (y compris après réarmement : last_notified_key remis à NULL).
      if (!notifiedToday || alert.last_notified_key !== ev.key) {
        await sendToUser(alert.user_id, buildPayload(alert, ev, fallbacksFor(alert, ev, stations, statusMap)));
        if (notifiedToday) await setAlertNotifiedKey(alert.id, ev.key);
        else await markAlertNotified(alert.id, now.date, ev.key);
      }
    } else if (notifiedToday && alert.last_notified_key !== null) {
      // Condition levée → réarmée : la prochaine atteinte re-notifie.
      await setAlertNotifiedKey(alert.id, null);
    }
  }
  return 'verifiees';
}

// ── Ordonnancement (instance unique + cycle non concurrent) ──────────────────────

let pollingTimer = null;
let isRunning    = false;

// État de la boucle, exposé par /api/health (une panne silencieuse devient visible).
const loop = {
  runs: 0,
  lastRunAt: null,      // ms, début du dernier cycle terminé
  lastDurationMs: null,
  lastOutcome: null,    // aucune_alerte | aucune_due | flux_indisponible | donnees_perimees | verifiees
  lastError: null,      // { message, at }
};

/** Enveloppe checkAlerts d'un verrou : un cycle lent ne chevauche pas le suivant. */
async function runPollCycle(date) {
  if (isRunning) return;
  isRunning = true;
  const started = Date.now();
  try {
    loop.lastOutcome = (await checkAlerts(date)) ?? 'verifiees';
  } catch (err) {
    loop.lastOutcome = 'erreur';
    loop.lastError = { message: err.message, at: new Date().toISOString() };
    console.error('[push] boucle', err.message);
  } finally {
    loop.runs++;
    loop.lastRunAt = started;
    loop.lastDurationMs = Date.now() - started;
    isRunning = false;
  }
}

/**
 * Santé de la boucle d'alerte. `healthy` = démarrée et un cycle a abouti depuis
 * moins de 3 intervalles (sinon elle est bloquée ou arrêtée) sans erreur au dernier cycle.
 */
function getAlertLoopHealth(nowMs = Date.now()) {
  const lagMs = loop.lastRunAt === null ? null : nowMs - loop.lastRunAt;
  const healthy = !!pollingTimer && lagMs !== null && lagMs < 3 * POLL_MS && loop.lastOutcome !== 'erreur';
  return {
    started: !!pollingTimer,
    running: isRunning,
    healthy,
    runs: loop.runs,
    last_run_at: loop.lastRunAt === null ? null : new Date(loop.lastRunAt).toISOString(),
    last_duration_ms: loop.lastDurationMs,
    last_outcome: loop.lastOutcome,
    last_error: loop.lastError,
    interval_s: POLL_MS / 1000,
  };
}

function startPolling() {
  if (pollingTimer) return; // déjà lancé, ne pas dupliquer
  pollingTimer = setInterval(runPollCycle, POLL_MS);
  console.log(`[push] polling des alertes activé (toutes les ${POLL_MS / 1000}s)`);
}

function stopPolling() {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
  }
}

module.exports = {
  initPush, getVapidPublicKey, startPolling, stopPolling, getAlertLoopHealth,
  // exposés pour les tests
  checkAlerts, runPollCycle, getAlertLoopHealth, findFallback, fallbacksFor, buildTestPayload, countForType, docksOf, evaluateAlert, buildMessage, buildPayload, buildSummaryPayload, isSummaryDue, sendToUser, inWindow, nowInTz,
};
