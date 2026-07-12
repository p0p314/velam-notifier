// Routes Web Push : clé publique VAPID (publique) + enregistrement d'une subscription.
const express = require('express');
const { addSubscription } = require('../db');
const { requireAuth } = require('../auth');
const { getVapidPublicKey } = require('../push');

const router = express.Router();

router.get('/api/push/vapid-public-key', (req, res) => {
  res.json({ ok: true, publicKey: getVapidPublicKey() });
});

router.post('/api/push/subscribe', requireAuth, async (req, res) => {
  try {
    const { subscription } = req.body ?? {};
    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({ ok: false, error: 'subscription invalide' });
    }
    await addSubscription(req.user.id, JSON.stringify(subscription));
    res.status(201).json({ ok: true });
  } catch (err) {
    console.error('[POST /api/push/subscribe]', err.message);
    res.status(500).json({ ok: false, error: 'Erreur serveur' });
  }
});

module.exports = router;
