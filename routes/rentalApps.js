// Routes rental_apps : endpoint cron (sync quotidienne GBFS) + lecture publique.
const express = require('express');
const crypto  = require('crypto');
const { getRentalApps } = require('../db');
const { syncRentalApps } = require('../rentalApps');

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

module.exports = router;
