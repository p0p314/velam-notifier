// Routes Web Push : clé publique VAPID (publique) + enregistrement d'une subscription.
const express = require('express');
const { addSubscription, removeSubscriptionByEndpoint } = require('../db');
const { requireAuth } = require('../auth');
const { getVapidPublicKey } = require('../push');

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

module.exports = router;
