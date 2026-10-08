// Routes Web Push : clé publique VAPID (publique) + enregistrement d'une subscription.
const express = require('express');
const { addSubscription, removeSubscriptionByEndpoint, getNotificationPrefs, setNotificationPrefs } = require('../db');
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

// Services de notification des navigateurs (Chrome / Android / Edge Chromium / Opera / Samsung :
// FCM ; Safari : Apple ; Firefox : Mozilla ; Edge historique : Windows). Le serveur n'envoie
// jamais de requête vers un autre hôte : sans cette liste, un compte pourrait lui faire
// contacter n'importe quelle adresse (sondage de services, boucle d'alerte bloquée).
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^(?:[a-z0-9-]+\.)*push\.apple\.com$/,
  /^(?:[a-z0-9-]+\.)*push\.services\.mozilla\.com$/,
  /^(?:[a-z0-9-]+\.)*notify\.windows\.com$/,
];

/** Endpoint Web Push : URL https:// d'un service de notification connu, port par défaut. */
function isValidEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || endpoint.length > 1024) return false;
  let url;
  try { url = new URL(endpoint); } catch { return false; }
  return url.protocol === 'https:' && !url.port && !url.username && !url.password
    && PUSH_HOSTS.some((re) => re.test(url.hostname));
}

/** Clés de chiffrement d'une subscription : deux chaînes base64url courtes. */
const KEY_RE = /^[A-Za-z0-9_-]{8,200}={0,2}$/;
const isValidKeys = (keys) => !!keys && typeof keys === 'object' && KEY_RE.test(keys.p256dh ?? '') && KEY_RE.test(keys.auth ?? '');

router.get('/api/push/vapid-public-key', (req, res) => {
  res.json({ ok: true, publicKey: getVapidPublicKey() });
});

router.post('/api/push/subscribe', requireAuth, async (req, res) => {
  try {
    const { subscription } = req.body ?? {};
    if (!isValidEndpoint(subscription?.endpoint) || !isValidKeys(subscription.keys)) {
      return res.status(400).json({ ok: false, error: 'subscription invalide' });
    }
    // Seuls l'endpoint et les clés sont conservés (jamais le reste de l'objet envoyé).
    const clean = { endpoint: subscription.endpoint, keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth } };
    await addSubscription(req.user.id, clean, req.sessionId);
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
/**
 * Types d'alertes notifiés pour le compte (tous les appareils) : { bikes, trains }.
 * Couper un type ne supprime aucune alerte : elles ne sont simplement plus envoyées.
 */
router.get('/api/notifications/preferences', requireAuth, async (req, res) => {
  try {
    res.json({ ok: true, preferences: await getNotificationPrefs(req.user.id) });
  } catch (err) {
    console.error('[GET /api/notifications/preferences]', err.message);
    res.status(500).json({ ok: false, error: 'Erreur serveur' });
  }
});

router.put('/api/notifications/preferences', requireAuth, async (req, res) => {
  try {
    const { bikes, trains } = req.body ?? {};
    const bad = [bikes, trains].some((v) => v !== undefined && typeof v !== 'boolean');
    if (bad || (bikes === undefined && trains === undefined)) {
      return res.status(400).json({ ok: false, error: 'bikes / trains : booléens attendus' });
    }
    res.json({ ok: true, preferences: await setNotificationPrefs(req.user.id, { bikes, trains }) });
  } catch (err) {
    console.error('[PUT /api/notifications/preferences]', err.message);
    res.status(500).json({ ok: false, error: 'Erreur serveur' });
  }
});

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
