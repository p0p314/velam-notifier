// Routes rental_apps : endpoint cron (sync quotidienne GBFS) + lecture publique.
const express = require('express');
const crypto  = require('crypto');
const { getRentalApps, getRentalAppsMap } = require('../db');
const { syncRentalApps } = require('../rentalApps');

const OFFICIAL_WEB = 'https://velam.amiens.fr/fr/home';

const router = express.Router();

/**
 * Garde l'endpoint cron : exige `Authorization: Bearer <CRON_SECRET>`.
 * Comparaison à temps constant (anti timing-attack). 503 si secret non configuré.
 */
function requireCronSecret(req, res, next) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[cron] CRON_SECRET non configuré — endpoint désactivé');
    return res.status(503).json({ ok: false, error: 'Endpoint cron non configuré' });
  }
  const header = req.get('authorization') ?? '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : '';
  const a = Buffer.from(token);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ ok: false, error: 'Token cron invalide' });
  }
  next();
}

/**
 * POST /cron/sync-rental-apps
 * Déclenché quotidiennement par GitHub Actions. Re-synchronise les rental_apps
 * depuis le flux GBFS system_information. Protégé par CRON_SECRET.
 */
router.post('/cron/sync-rental-apps', requireCronSecret, async (req, res) => {
  try {
    const apps = await syncRentalApps();
    res.json({ ok: true, count: apps.length, apps });
  } catch (err) {
    console.error('[POST /cron/sync-rental-apps]', err.message);
    res.status(502).json({ ok: false, error: 'Échec de la synchronisation rental_apps' });
  }
});

/** GET /api/rental-apps — lecture publique des deep links/stores synchronisés. */
router.get('/api/rental-apps', async (req, res) => {
  try {
    res.json({ ok: true, apps: await getRentalApps() });
  } catch (err) {
    console.error('[GET /api/rental-apps]', err.message);
    res.status(500).json({ ok: false, error: 'Erreur serveur' });
  }
});

/**
 * GET /open — cible des notifications push vers l'app Vélam.
 * Page HTML autonome (hors SPA React) servie same-origin pour satisfaire
 * iOS clients.openWindow() : tente le deep link natif, puis le store, puis le web.
 */
router.get('/open', async (req, res) => {
  let apps = {};
  try { apps = await getRentalAppsMap(); } catch (_) { /* dégrade vers web seul */ }

  const safe = (v) => JSON.stringify(v ?? null).replace(/<\//g, '<\\/');
  const deepLink     = apps.ios?.discovery_uri || apps.android?.discovery_uri || null;
  const storeIos     = apps.ios?.store_uri     || null;
  const storeAndroid = apps.android?.store_uri || null;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="robots" content="noindex">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Ouverture Vélam…</title>
  <style>
    body{font-family:sans-serif;display:flex;flex-direction:column;
         align-items:center;justify-content:center;height:100vh;
         margin:0;gap:16px;color:#374151}
    a{color:#2563eb;font-size:14px}
  </style>
</head>
<body>
  <img src="/icon-192.png" alt="VéloPulse" width="64" height="64">
  <p id="msg">Ouverture de l'application Vélam…</p>
  <a href="${OFFICIAL_WEB}">Ouvrir le site web</a>
  <script>
    var deep        = ${safe(deepLink)};
    var storeIos    = ${safe(storeIos)};
    var storeAndroid= ${safe(storeAndroid)};
    var web         = ${safe(OFFICIAL_WEB)};
    var isIOS     = /iphone|ipad|ipod/i.test(navigator.userAgent);
    var isAndroid = /android/i.test(navigator.userAgent);
    var store = isIOS ? storeIos : isAndroid ? storeAndroid : null;
    if (!deep) {
      window.location.replace(web);
    } else {
      window.location.href = deep;
      setTimeout(function() {
        if (store) {
          document.getElementById('msg').textContent = 'Redirection vers le store…';
          window.location.href = store;
          setTimeout(function() { window.location.replace(web); }, 2000);
        } else {
          window.location.replace(web);
        }
      }, 2000);
    }
  </script>
</body>
</html>`);
});

module.exports = router;
