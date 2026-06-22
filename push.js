const webpush = require('web-push');
const {
  getConfig, setConfig,
  countActiveAlerts, getActiveAlerts, markAlertNotified, setAlertNotifiedCount,
  getSubscriptionsByUser, removeSubscriptionById,
  getRentalAppsMap,
} = require('./db');
const { fetchStationStatus } = require('./gbfs');

const POLL_MS = 30_000;
const OFFICIAL_URL = 'https://velam.amiens.fr';

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

// ── Comptage selon le type de vélo ─────────────────────────────────────────────

function countForType(status, bikeType) {
  if (!status) return 0;
  if (bikeType === 'any') return status.num_bikes_available ?? 0;
  // 'ebike' (DB) → 'electrical' (GBFS), 'mechanical' → 'mechanical'
  const typeId = bikeType === 'ebike' ? 'electrical' : 'mechanical';
  return (status.vehicle_types_available ?? []).find((v) => v.vehicle_type_id === typeId)?.count ?? 0;
}

// ── Fenêtre horaire ────────────────────────────────────────────────────────────

function nowHHMM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Gère aussi les créneaux qui passent minuit (start > end). */
function inWindow(now, start, end) {
  return start <= end ? now >= start && now <= end : now >= start || now <= end;
}

// ── Envoi ──────────────────────────────────────────────────────────────────────

async function sendToUser(userId, payload) {
  const subs = await getSubscriptionsByUser(userId);
  await Promise.all(subs.map(async (row) => {
    try {
      await webpush.sendNotification(JSON.parse(row.subscription), JSON.stringify(payload), {
        urgency: 'high', // réveille l'appareil même en veille
        TTL: 300,        // notif valable 5 min max (au-delà, vélos périmés → abandon)
      });
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
}

// ── Construction du payload (adapté si count = 0) ───────────────────────────────

/**
 * Construit l'URL https:// de la page de redirection interne (/redirect).
 *
 * iOS interdit l'ouverture d'un scheme custom (velam://) depuis un Service
 * Worker via clients.openWindow() — seules les URLs https:// sont acceptées.
 * On passe donc toujours par une page same-origin qui, côté navigateur, peut
 * ouvrir l'app native via window.location.href, avec repli store puis web.
 * Le deep link et les stores sont encodés en query params.
 */
function buildRedirectUrl(rentalApps) {
  const params = new URLSearchParams();

  const deepLink     = rentalApps?.ios?.discovery_uri || rentalApps?.android?.discovery_uri || null;
  const storeIos     = rentalApps?.ios?.store_uri     || null;
  const storeAndroid = rentalApps?.android?.store_uri || null;

  if (deepLink)     params.set('deep',    deepLink);
  if (storeIos)     params.set('ios',     storeIos);
  if (storeAndroid) params.set('android', storeAndroid);
  params.set('web', OFFICIAL_URL);

  // URL absolue vers la page de redirection de notre app (même domaine).
  const base = process.env.APP_URL || 'https://velam-notifier.onrender.com';
  return `${base}/redirect?${params.toString()}`;
}

function buildPayload(alerte, count, rentalApps) {
  const bikeLabel = alerte.bike_type === 'ebike'
    ? 'vélo(s) électrique(s)'
    : alerte.bike_type === 'mechanical'
      ? 'vélo(s) mécanique(s)'
      : 'vélo(s)';

  const base = {
    // Toujours une URL https:// (page /redirect interne) → ouvrable par le SW iOS.
    url:       buildRedirectUrl(rentalApps),
    stationId: alerte.station_id,
    icon:      '/icon-192.png',
    badge:     '/badge-72.png',
  };

  if (count === 0) {
    return {
      ...base,
      title: `⚠️ VéloPulse — ${alerte.station_name}`,
      body:  `Plus aucun ${bikeLabel} disponible`,
    };
  }

  return {
    ...base,
    title: `VéloPulse — ${alerte.station_name}`,
    body:  `${count} ${bikeLabel} disponible${count > 1 ? 's' : ''} · Réservez vite`,
  };
}

// ── Boucle de vérification ──────────────────────────────────────────────────────

async function checkAlerts() {
  // Ne rien faire si aucune alerte active n'existe en base
  if (await countActiveAlerts() === 0) return;

  const now = nowHHMM();
  // Jour ISO courant : 1 = lundi … 7 = dimanche (getDay() renvoie 0 = dimanche).
  const isoDay = ((new Date().getDay() + 6) % 7) + 1;
  const due = (await getActiveAlerts()).filter(
    (a) =>
      inWindow(now, a.time_start, a.time_end) &&
      (a.days ? a.days.split(',').map(Number).includes(isoDay) : true)
  );
  if (due.length === 0) return;

  let statusList;
  try {
    statusList = await fetchStationStatus();
  } catch (err) {
    console.error('[push] fetch GBFS status', err.message);
    return;
  }

  const statusMap = Object.fromEntries(statusList.map((s) => [s.station_id, s]));
  const today = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"

  // Deep links officiels (sync quotidienne) — chargés une fois par cycle.
  let rentalApps = {};
  try {
    rentalApps = await getRentalAppsMap();
  } catch (err) {
    console.error('[push] lecture rental_apps', err.message); // dégrade vers web seul
  }

  for (const alert of due) {
    const count = countForType(statusMap[alert.station_id], alert.bike_type);
    const dejaNotifieAujourdhui = alert.last_notified_date === today;

    // ── Condition 1 : première descente sous le seuil aujourd'hui ──────────────
    if (count < alert.min_count && !dejaNotifieAujourdhui) {
      await sendToUser(alert.user_id, buildPayload(alert, count, rentalApps));
      await markAlertNotified(alert.id, today, count);
      continue;
    }

    // ── Condition 2 : déjà notifié aujourd'hui, toujours sous le seuil ──────────
    // Re-notifie si le nombre a changé depuis le dernier envoi, ou après un reset
    // (last_notified_count remis à NULL suite à une remontée puis redescente).
    if (count < alert.min_count && dejaNotifieAujourdhui) {
      if (alert.last_notified_count === null || count !== alert.last_notified_count) {
        await sendToUser(alert.user_id, buildPayload(alert, count, rentalApps));
        await setAlertNotifiedCount(alert.id, count);
      }
      continue;
    }

    // ── Reset : count repassé au-dessus du seuil → prépare la prochaine descente ──
    if (count >= alert.min_count && dejaNotifieAujourdhui) {
      await setAlertNotifiedCount(alert.id, null);
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

module.exports = { initPush, getVapidPublicKey, startPolling, stopPolling };
