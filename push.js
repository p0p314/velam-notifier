const webpush = require('web-push');
const {
  getConfig, setConfig,
  countActiveAlerts, getActiveAlerts, deleteExpiredAlerts, markAlertNotified, setAlertNotifiedKey,
  getSubscriptionsByUser, removeSubscriptionById, getStations,
} = require('./db');
const { getStationStatus } = require('./gbfs');
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
  const status = statusMap[alert.station_id];
  const count = alert.target === 'docks' ? docksOf(status) : countForType(status, alert.bike_type);
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
  if (alert.comparison !== 'at_most' || !stations?.length) return {};
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
function buildRedirectUrl() {
  const base = (process.env.APP_URL || 'https://velam-notifier.onrender.com').replace(/\/$/, '');
  return `${base}/open?url=${encodeURIComponent(OFFICIAL_URL)}`;
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
      title: `✅ VéloPulse — ${alerte.station_name}`,
      body: alerte.target === 'docks' ? `${what} · C'est le moment` : `${what} disponible${n > 1 ? 's' : ''} · C'est le moment`,
    };
  }
  if (n === 0) {
    return {
      title: `⚠️ VéloPulse — ${alerte.station_name}`,
      body: alerte.target === 'docks'
        ? 'Plus aucune place libre pour déposer un vélo'
        : `Plus aucun ${bikesLabel(alerte.bike_type, 1).replace(/^1 /, '')} disponible`,
    };
  }
  return {
    title: `VéloPulse — ${alerte.station_name}`,
    body: alerte.target === 'docks'
      ? `Plus que ${what} · Pensez à une autre station`
      : `${what} disponible${n > 1 ? 's' : ''} · Réservez vite`,
  };
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
    url:       buildRedirectUrl(),
    stationId: alerte.station_id,
    icon:      '/icon-192.png',
    badge:     '/badge-72.png',
  };
}

/** Notification de test : ouvre la page Alertes de l'app au clic. */
function buildTestPayload() {
  const base = (process.env.APP_URL || 'https://velam-notifier.onrender.com').replace(/\/$/, '');
  return {
    title: 'VéloPulse — Notification de test',
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

/** `date` injectable pour les tests (défaut : maintenant). */
async function checkAlerts(date = new Date()) {
  // Ne rien faire si aucune alerte active n'existe en base
  if (await countActiveAlerts() === 0) return;

  // Heure / jour / date courants dans le fuseau des alertes (pas l'UTC serveur).
  const now = nowInTz(date);
  await deleteExpiredAlerts(now.date); // alertes ponctuelles des jours passés

  const due = (await getActiveAlerts(now.date)).filter((a) => isDue(a, now));
  if (due.length === 0) return;

  let statusList;
  try {
    statusList = await getStationStatus();
  } catch (err) {
    console.error('[push] fetch GBFS status', err.message);
    return;
  }
  const statusMap = Object.fromEntries(statusList.map((s) => [s.station_id, s]));

  // Référentiel (coordonnées) pour les stations de repli — lu en base, 1 fois par cycle.
  let stations = [];
  try {
    stations = await getStations();
  } catch (err) {
    console.error('[push] lecture stations', err.message); // dégrade : pas de repli
  }

  for (const alert of due) {
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
}

// ── Ordonnancement (instance unique + cycle non concurrent) ──────────────────────

let pollingTimer = null;
let isRunning    = false;

/** Enveloppe checkAlerts d'un verrou : un cycle lent ne chevauche pas le suivant. */
async function runPollCycle() {
  if (isRunning) return;
  isRunning = true;
  try {
    await checkAlerts();
  } catch (err) {
    console.error('[push] boucle', err.message);
  } finally {
    isRunning = false;
  }
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
  initPush, getVapidPublicKey, startPolling, stopPolling,
  // exposés pour les tests
  checkAlerts, findFallback, fallbacksFor, buildTestPayload, countForType, docksOf, evaluateAlert, buildMessage, buildPayload, sendToUser, inWindow, nowInTz,
};
