// Routes Web Push : clé publique VAPID (publique) + enregistrement d'une subscription.
const express = require('express');
const { addSubscription, removeSubscriptionByEndpoint } = require('../db');
const { requireAuth } = require('../auth');
const rateLimit = require('express-rate-limit');
const { getVapidPublicKey, sendToUser, buildTestPayload } = require('../push');

// Anti-abus : une notification de test ne sert qu'à vérifier son appareil.
const testLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, max: 5,
  standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => `user:${req.user.id}`,
  skip: () => process.env.RATE_LIMIT_DISABLED === '1',
  message: { ok: false, error: 'Trop de notifications de test, réessayez dans quelques minutes.' },
});

const router = express.Router();

// Un endpoint Web Push est toujours une URL https:// fournie par le navigateur.
function isValidEndpoint(endpoint) {
  return typeof endpoint === 'string' && endpoint.length <= 1024 && endpoint.startsWith('https://');
}

router.get('/api/push/vapid-public-key', (req, res) => {
  res.json({ ok: true, publicKey: getVapidPublicKey() });
});

router.post('/api/push/subscribe', requireAuth, async (req, res) => {
  try {
    const { subscription } = req.body ?? {};
    if (!isValidEndpoint(subscription?.endpoint) || typeof subscription.keys !== 'object' || !subscription.keys) {
      return res.status(400).json({ ok: false, error: 'subscription invalide' });
    }
    await addSubscription(req.user.id, subscription);
    res.status(201).json({ ok: true });
  } catch (err) {
    console.error('[POST /api/push/subscribe]', err.message);
    res.status(500).json({ ok: false, error: 'Erreur serveur' });
  }
});

// Déconnexion : l'appareil cesse de recevoir les alertes de ce compte.
router.post('/api/push/unsubscribe', requireAuth, async (req, res) => {
  try {
    const { endpoint } = req.body ?? {};
    if (!isValidEndpoint(endpoint)) {
      return res.status(400).json({ ok: false, error: 'endpoint invalide' });
    }
    const removed = await removeSubscriptionByEndpoint(req.user.id, endpoint);
    res.json({ ok: true, removed });
  } catch (err) {
    console.error('[POST /api/push/unsubscribe]', err.message);
    res.status(500).json({ ok: false, error: 'Erreur serveur' });
  }
});

/**
 * POST /api/push/test — envoie une notification de test à tous les appareils du compte.
 * 409 si aucun appareil n'est enregistré, 502 si aucun envoi n'a abouti.
 */
router.post('/api/push/test', requireAuth, testLimiter, async (req, res) => {
  try {
    const { total, sent } = await sendToUser(req.user.id, buildTestPayload());
    if (total === 0) {
      return res.status(409).json({ ok: false, error: 'Aucun appareil enregistré : activez d\'abord les notifications.' });
    }
    if (sent === 0) {
      return res.status(502).json({ ok: false, error: 'L\'envoi a échoué. Réactivez les notifications sur cet appareil.' });
    }
    res.json({ ok: true, sent, total });
  } catch (err) {
    console.error('[POST /api/push/test]', err.message);
    res.status(500).json({ ok: false, error: 'Erreur serveur' });
  }
});

module.exports = router;
