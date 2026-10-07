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

/**
 * POST /cron/refresh-stations
 * Déclenché quotidiennement par GitHub Actions : recharge le référentiel des
 * stations (nouvelles stations, déplacements, suppressions). Protégé par CRON_SECRET.
 */
router.post('/cron/refresh-stations', requireCronSecret, async (req, res) => {
  try {
    const { refreshStationCatalog } = require('./stations');
    const { count, removed } = await refreshStationCatalog();
    res.json({ ok: true, count, removed });
  } catch (err) {
    console.error('[POST /cron/refresh-stations]', err.message);
    res.status(502).json({ ok: false, error: 'Échec du rechargement des stations' });
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

/** Échappement pour un attribut HTML (liens venant du flux Vélam : non fiables). */
const attr = (v) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * GET /open — cible des notifications push vers l'app Vélam.
 * Page HTML autonome (hors SPA React) servie same-origin pour satisfaire
 * iOS clients.openWindow(). Elle s'ouvre dans la fenêtre de VéloPulse : elle ne doit
 * donc JAMAIS y charger un site externe (une PWA installée n'a ni barre d'adresse
 * ni bouton retour). « Ouvrir l'app Vélam » pointe vers le site officiel, ouvert hors de
 * l'app (nouvel onglet) : c'est le lien qui fonctionne depuis une notification (le deep
 * link `discovery_uri` du flux ne s'ouvrait pas). Elle propose aussi le store et garde
 * toujours « Retour à VéloPulse ».
 * Script externe (/open.js) : la CSP (script-src 'self') bloque les scripts inline ;
 * les liens lui sont passés en attributs data-*.
 */
router.get('/open', async (req, res) => {
  let apps = {};
  try { apps = await getRentalAppsMap(); } catch (_) { /* dégrade vers web seul */ }

  // Un store par plateforme (le script choisit selon l'appareil).
  const storeIos     = apps.ios?.store_uri         || '';
  const storeAndroid = apps.android?.store_uri     || '';

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="robots" content="noindex">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Ouvrir Vélam — VéloPulse</title>
  <style>
    :root{--bg:#FBFBFA;--text:#1B1B19;--muted:#6B6B66;--accent:#2C66E0;--on:#fff;--line:#E3E3DE;--surface:#fff}
    @media (prefers-color-scheme: dark){:root{--bg:#0B0B0D;--text:#ECECEE;--muted:#9A9AA2;--accent:#4F8BFF;--line:#2A2A2E;--surface:#151517}}
    body{font-family:system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--text);margin:0;
         min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;
         gap:14px;padding:24px;box-sizing:border-box;text-align:center}
    p{margin:0;color:var(--muted);font-size:15px;max-width:320px}
    .actions{display:flex;flex-direction:column;gap:10px;width:100%;max-width:320px;margin-top:8px}
    .btn{display:block;padding:14px 16px;border-radius:12px;font-size:15px;font-weight:600;text-decoration:none;
         border:1px solid var(--line);background:var(--surface);color:var(--accent)}
    .btn.primary{background:var(--accent);border-color:var(--accent);color:var(--on)}
    .btn.back{color:var(--text)}
    [hidden]{display:none!important}
  </style>
</head>
<body data-store-ios="${attr(storeIos)}" data-store-android="${attr(storeAndroid)}">
  <img src="/icon-192.png" alt="" width="64" height="64">
  <p id="msg">Réservez votre vélo avec Vélam.</p>
  <div class="actions">
    <a class="btn primary" id="open-app" href="${attr(OFFICIAL_WEB)}" target="_blank" rel="noopener">Ouvrir l'app Vélam</a>
    <a class="btn" id="store" href="#" hidden target="_blank" rel="noopener">Installer l'app Vélam</a>
    <a class="btn back" id="back" href="/">← Retour à VéloPulse</a>
  </div>
  <script src="/open.js"></script>
</body>
</html>`);
});

/**
 * Script de /open : choisit le store selon le système de l'appareil. Rien ne s'ouvre
 * automatiquement ; si l'utilisateur quitte la page (Vélam ou store ouvert), revenir
 * dans VéloPulse ramène à l'application. Jamais de page externe dans la fenêtre.
 */
const OPEN_JS = `(function () {
  var data = document.body.dataset;
  var ua = navigator.userAgent;
  var isIOS = /iphone|ipad|ipod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  var isAndroid = /android/i.test(ua);
  var store = isIOS ? data.storeIos : isAndroid ? data.storeAndroid : "";
  var storeLink = document.getElementById("store");
  var left = false;

  if (store) { storeLink.href = store; storeLink.hidden = false; }

  // Retour dans VéloPulse : remplace /open dans l'historique.
  function backToApp() { window.location.replace("/"); }
  document.getElementById("back").addEventListener("click", function (e) { e.preventDefault(); backToApp(); });

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) { left = true; return; }
    if (left) backToApp(); // l'app Vélam (ou le store) s'est ouverte, l'utilisateur revient
  });
})();
`;

router.get('/open.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.send(OPEN_JS);
});

module.exports = router;
module.exports.requireCronSecret = requireCronSecret;
