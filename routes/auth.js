// Routes d'authentification (inscription / connexion) + rate limiting anti-bruteforce.
const express   = require('express');
const rateLimit = require('express-rate-limit');
const {
  createUser, getUserByUsername, getUserById, getUserAuthById, updatePasswordHash, deleteUser, markTutorialDone,
  bumpTokenVersion, removeOtherSubscriptions,
  touchSession, listSessions, deleteSession, deleteOtherSessions, pruneSessions, setSubscriptionSession,
  getFavorites, getAlerts, getAlertsPause, getSubscriptionsByUser,
  getTrainFavorites, getTrainAlerts, getTrainNotifications, getNotificationPrefs, modulesOf, setModules, setBikeCity,
} = require('../db');
const { DEFAULT_CITY, isCity } = require('../cities');
const {
  hashPassword, verifyPassword, signToken, requireAuth, startSession, userAgentOf, SESSION_TTL_MS,
} = require('../auth');
const { describeDevice } = require('../device');

const router = express.Router();

/**
 * Utilisateur renvoyé au client : identité, tutoriel de présentation déjà vu ou non,
 * fonctionnalités utilisées (`modules` : { bikes, trains }, au moins une), ville des
 * vélos (`city`, catalogue de cities.js).
 */
const publicUser = (user) => ({
  id: user.id, username: user.username, tutorial_done: !!user.tutorial_done, modules: modulesOf(user),
  city: isCity(user.bike_city) ? user.bike_city : DEFAULT_CITY,
});

// RATE_LIMIT_DISABLED=1 : uniquement pour les tests d'intégration (nombreux comptes créés).
const skip = () => process.env.RATE_LIMIT_DISABLED === '1';

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  standardHeaders: true, legacyHeaders: false, skip,
  message: { ok: false, error: 'Trop de tentatives, réessayez dans 15 minutes.' },
});
// Second compteur, par compte visé : freine une attaque répartie sur de nombreuses adresses IP.
// Seuls les échecs comptent (une connexion réussie ne consomme rien), et le seuil est plus
// haut que par IP pour qu'un tiers ne puisse pas bloquer facilement le compte de quelqu'un.
const accountKey = (req) => {
  const u = req.body?.username;
  return `compte:${typeof u === 'string' ? u.trim().toLowerCase().slice(0, 64) : ''}`;
};
const accountLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 20, skipSuccessfulRequests: true,
  standardHeaders: false, legacyHeaders: false, skip, keyGenerator: accountKey,
  message: { ok: false, error: 'Trop de tentatives sur ce compte, réessayez dans 15 minutes.' },
});
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 5,
  standardHeaders: true, legacyHeaders: false, skip,
  message: { ok: false, error: 'Trop de comptes créés, réessayez plus tard.' },
});

router.post('/api/auth/register', registerLimiter, async (req, res) => {
  try {
    const { username, password } = req.body ?? {};
    if (!username?.trim() || !password) {
      return res.status(400).json({ ok: false, error: 'username et password requis' });
    }
    if (username.trim().length > 32) {
      return res.status(400).json({ ok: false, error: 'Nom d\'utilisateur trop long (max 32)' });
    }
    if (password.length < 8) {
      return res.status(400).json({ ok: false, error: 'Le mot de passe doit faire au moins 8 caractères' });
    }
    if (await getUserByUsername(username.trim())) {
      return res.status(409).json({ ok: false, error: 'Ce nom d\'utilisateur est déjà pris' });
    }

    const user  = await createUser(username.trim(), await hashPassword(password));
    const token = await startSession(user, req);
    res.status(201).json({ ok: true, token, user: publicUser(user) });
  } catch (err) {
    console.error('[POST /api/auth/register]', err.message);
    res.status(500).json({ ok: false, error: 'Erreur serveur' });
  }
});

router.post('/api/auth/login', loginLimiter, accountLoginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body ?? {};
    if (!username?.trim() || !password) {
      return res.status(400).json({ ok: false, error: 'username et password requis' });
    }

    const user = await getUserByUsername(username.trim());
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return res.status(401).json({ ok: false, error: 'Identifiants incorrects' });
    }

    const token = await startSession(user, req);
    res.json({ ok: true, token, user: publicUser(user) });
  } catch (err) {
    console.error('[POST /api/auth/login]', err.message);
    res.status(500).json({ ok: false, error: 'Erreur serveur' });
  }
});

/**
 * GET /api/auth/me — valide la session et renvoie un jeton neuf (session glissante).
 * Appelé au démarrage de l'app : tant que l'utilisateur ouvre l'app au moins une
 * fois par TOKEN_TTL, il n'a jamais à se reconnecter. 401 si le compte n'existe plus.
 * Met à jour la dernière activité de l'appareil ; un jeton d'avant les sessions
 * (sans `sid`) reçoit ici sa session, et apparaît dès lors dans « Appareils connectés ».
 */
router.get('/api/auth/me', requireAuth, async (req, res) => {
  try {
    const user = await getUserById(req.user.id);
    if (!user) return res.status(401).json({ ok: false, error: 'Compte introuvable' });
    let token;
    if (req.sessionId) {
      await touchSession(req.sessionId, userAgentOf(req));
      token = signToken(user, req.sessionId);
    } else {
      token = await startSession(user, req);
    }
    res.json({ ok: true, token, user: publicUser(user) });
  } catch (err) {
    console.error('[GET /api/auth/me]', err.message);
    res.status(500).json({ ok: false, error: 'Erreur serveur' });
  }
});

const PASSWORD_MIN = 8;

/** Endpoint push de l'appareil courant (facultatif) : URL https:// fournie par le navigateur. */
function parseEndpoint(raw) {
  if (raw === undefined || raw === null || raw === '') return { ok: true, endpoint: null };
  const ok = typeof raw === 'string' && raw.length <= 1024 && raw.startsWith('https://');
  return { ok, endpoint: ok ? raw : null };
}

/**
 * Déconnecte tous les autres appareils du compte : supprime toutes les sessions,
 * invalide les jetons d'avant les sessions (version), détache les autres appareils
 * des notifications (sauf `keepEndpoint`). L'appareil courant reçoit une session
 * **neuve** : même une copie volée de son ancien jeton cesse de fonctionner.
 */
async function revokeOtherSessions(user, keepEndpoint, req) {
  const version = await bumpTokenVersion(user.id);
  await deleteOtherSessions(user.id, null);
  const devices = await removeOtherSubscriptions(user.id, keepEndpoint);
  const { token, sid } = await startSession({ ...user, token_version: version }, req, { withId: true });
  if (keepEndpoint) await setSubscriptionSession(user.id, keepEndpoint, sid);
  return { token, devices };
}

/**
 * PUT /api/auth/password — { current_password, new_password, endpoint? }.
 * Le mot de passe actuel est exigé (limité comme la connexion, anti force brute).
 * Les autres appareils sont déconnectés ; renvoie un jeton neuf pour celui-ci.
 */
router.put('/api/auth/password', requireAuth, loginLimiter, async (req, res) => {
  try {
    const { current_password: current, new_password: next } = req.body ?? {};
    if (typeof current !== 'string' || typeof next !== 'string') {
      return res.status(400).json({ ok: false, error: 'current_password et new_password requis' });
    }
    const { ok: endpointOk, endpoint } = parseEndpoint(req.body.endpoint);
    if (!endpointOk) return res.status(400).json({ ok: false, error: 'endpoint invalide' });
    if (next.length < PASSWORD_MIN) {
      return res.status(400).json({ ok: false, error: `Le nouveau mot de passe doit faire au moins ${PASSWORD_MIN} caractères` });
    }
    const user = await getUserAuthById(req.user.id);
    if (!user) return res.status(401).json({ ok: false, error: 'Compte introuvable' });
    if (!(await verifyPassword(current, user.password_hash))) {
      return res.status(403).json({ ok: false, error: 'Mot de passe actuel incorrect' });
    }
    await updatePasswordHash(user.id, await hashPassword(next));
    const { token } = await revokeOtherSessions(user, endpoint, req);
    res.json({ ok: true, token, user: publicUser(user) });
  } catch (err) {
    console.error('[PUT /api/auth/password]', err.message);
    res.status(500).json({ ok: false, error: 'Erreur serveur' });
  }
});

/**
 * POST /api/auth/logout-others — { endpoint? } : déconnecte tous les autres
 * appareils (jetons révoqués, notifications détachées). L'appareil courant reste
 * connecté avec le jeton neuf renvoyé. `devices` : appareils détachés des notifications.
 */
router.post('/api/auth/logout-others', requireAuth, async (req, res) => {
  try {
    const { ok: endpointOk, endpoint } = parseEndpoint(req.body?.endpoint);
    if (!endpointOk) return res.status(400).json({ ok: false, error: 'endpoint invalide' });
    const user = await getUserById(req.user.id);
    if (!user) return res.status(401).json({ ok: false, error: 'Compte introuvable' });
    const { token, devices } = await revokeOtherSessions(user, endpoint, req);
    res.json({ ok: true, token, user: publicUser(user), devices });
  } catch (err) {
    console.error('[POST /api/auth/logout-others]', err.message);
    res.status(500).json({ ok: false, error: 'Erreur serveur' });
  }
});

/** POST /api/auth/logout — ferme la session de cet appareil (il disparaît de la liste). */
router.post('/api/auth/logout', requireAuth, async (req, res) => {
  try {
    if (req.sessionId) await deleteSession(req.user.id, req.sessionId);
    res.json({ ok: true });
  } catch (err) {
    console.error('[POST /api/auth/logout]', err.message);
    res.status(500).json({ ok: false, error: 'Erreur serveur' });
  }
});

/** POST /api/auth/tutorial — tutoriel vu ou arrêté : il n'est plus proposé à ce compte. */
router.post('/api/auth/tutorial', requireAuth, async (req, res) => {
  try {
    await markTutorialDone(req.user.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('[POST /api/auth/tutorial]', err.message);
    res.status(500).json({ ok: false, error: 'Erreur serveur' });
  }
});

/**
 * PUT /api/auth/modules — { bikes, trains } (booléens ; un champ absent est inchangé) :
 * fonctionnalités utilisées par le compte, sur tous ses appareils. Au moins une reste
 * active (400 sinon). Une fonctionnalité désactivée n'envoie plus ses alertes (elles
 * sont conservées et reprennent si elle est réactivée). Renvoie l'utilisateur à jour.
 */
router.put('/api/auth/modules', requireAuth, async (req, res) => {
  try {
    const { bikes, trains } = req.body ?? {};
    const bad = [bikes, trains].some((v) => v !== undefined && typeof v !== 'boolean');
    if (bad || (bikes === undefined && trains === undefined)) {
      return res.status(400).json({ ok: false, error: 'bikes / trains : booléens attendus' });
    }
    const user = await getUserById(req.user.id);
    if (!user) return res.status(401).json({ ok: false, error: 'Compte introuvable' });
    const current = modulesOf(user);
    const next = { bikes: bikes ?? current.bikes, trains: trains ?? current.trains };
    if (!next.bikes && !next.trains) {
      return res.status(400).json({ ok: false, error: 'Gardez au moins les vélos ou les trains' });
    }
    await setModules(user.id, next);
    res.json({ ok: true, user: publicUser({ ...user, use_bikes: next.bikes ? 1 : 0, use_trains: next.trains ? 1 : 0 }) });
  } catch (err) {
    console.error('[PUT /api/auth/modules]', err.message);
    res.status(500).json({ ok: false, error: 'Erreur serveur' });
  }
});

/**
 * PUT /api/auth/city — { city } : ville des vélos du compte (tous ses appareils). Seule
 * cette ville est affichée et interrogée ; favoris et alertes des autres villes sont
 * conservés mais masqués, et leurs alertes ne sont plus envoyées. Renvoie l'utilisateur.
 */
router.put('/api/auth/city', requireAuth, async (req, res) => {
  try {
    const { city } = req.body ?? {};
    if (!isCity(city)) return res.status(400).json({ ok: false, error: 'Ville inconnue' });
    const user = await getUserById(req.user.id);
    if (!user) return res.status(401).json({ ok: false, error: 'Compte introuvable' });
    await setBikeCity(user.id, city);
    res.json({ ok: true, user: publicUser({ ...user, bike_city: city }) });
  } catch (err) {
    console.error('[PUT /api/auth/city]', err.message);
    res.status(500).json({ ok: false, error: 'Erreur serveur' });
  }
});

/**
 * GET /api/auth/sessions — appareils connectés au compte (le plus récent d'abord) :
 * { id, label (« iPhone · Safari »), created_at, last_seen_at (ms), current }.
 * Les sessions dont le jeton a forcément expiré sont purgées au passage.
 */
router.get('/api/auth/sessions', requireAuth, async (req, res) => {
  try {
    await pruneSessions(Date.now() - SESSION_TTL_MS);
    const sessions = (await listSessions(req.user.id)).map((s) => ({
      id: s.id,
      label: describeDevice(s.user_agent),
      created_at: s.created_at,
      last_seen_at: s.last_seen_at,
      current: s.id === req.sessionId,
    }));
    res.json({ ok: true, sessions });
  } catch (err) {
    console.error('[GET /api/auth/sessions]', err.message);
    res.status(500).json({ ok: false, error: 'Erreur serveur' });
  }
});

/** DELETE /api/auth/sessions/:id — déconnecte un autre appareil (et coupe ses notifications). */
router.delete('/api/auth/sessions/:id', requireAuth, async (req, res) => {
  try {
    const id = String(req.params.id);
    if (id === req.sessionId) {
      return res.status(400).json({ ok: false, error: 'Pour cet appareil, utilisez « Se déconnecter ».' });
    }
    if (!(await deleteSession(req.user.id, id))) {
      return res.status(404).json({ ok: false, error: 'Appareil introuvable' });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /api/auth/sessions]', err.message);
    res.status(500).json({ ok: false, error: 'Erreur serveur' });
  }
});

/**
 * GET /api/auth/export — toutes les données du compte en JSON (droit à la
 * portabilité, RGPD). Jamais le mot de passe (même haché) ni les clés techniques
 * des notifications.
 */
router.get('/api/auth/export', requireAuth, async (req, res) => {
  try {
    const user = await getUserById(req.user.id);
    if (!user) return res.status(401).json({ ok: false, error: 'Compte introuvable' });
    const [favorites, alerts, pausedUntil, sessions, subscriptions, trainFavorites, trainAlerts, trainNotifications] = await Promise.all([
      getFavorites(user.id), getAlerts(user.id), getAlertsPause(user.id),
      listSessions(user.id), getSubscriptionsByUser(user.id),
      getTrainFavorites(user.id), getTrainAlerts(user.id), getTrainNotifications(user.id, 500),
    ]);
    const iso = (ms) => new Date(ms).toISOString();
    res.json({
      ok: true,
      export: {
        application: 'Mox',
        exported_at: new Date().toISOString(),
        account: {
          username: user.username, created_at: user.created_at, alerts_paused_until: pausedUntil,
          notifications: await getNotificationPrefs(user.id),
          modules: modulesOf(user),
          bike_city: user.bike_city ?? DEFAULT_CITY,
        },
        favorites: favorites.map(({ user_id, id, ...f }) => f),
        alerts: alerts.map(({ user_id, ...a }) => a),
        devices: sessions.map((s) => ({
          device: describeDevice(s.user_agent), user_agent: s.user_agent,
          connected_at: iso(s.created_at), last_seen_at: iso(s.last_seen_at),
        })),
        notification_devices: subscriptions.length,
        trains: {
          favorites: trainFavorites.map(({ user_id, ...f }) => f),
          alerts: trainAlerts.map(({ user_id, ...a }) => a),
          notifications: trainNotifications.map((n) => ({ ...n, sent_at: iso(n.sent_at) })),
        },
      },
    });
  } catch (err) {
    console.error('[GET /api/auth/export]', err.message);
    res.status(500).json({ ok: false, error: 'Erreur serveur' });
  }
});

/**
 * DELETE /api/auth/me — { password } : supprime définitivement le compte et
 * toutes ses données (favoris, alertes, appareils). Droit à l'effacement (RGPD).
 */
router.delete('/api/auth/me', requireAuth, loginLimiter, async (req, res) => {
  try {
    const { password } = req.body ?? {};
    if (typeof password !== 'string' || !password) {
      return res.status(400).json({ ok: false, error: 'Mot de passe requis pour confirmer' });
    }
    const user = await getUserAuthById(req.user.id);
    if (!user) return res.status(401).json({ ok: false, error: 'Compte introuvable' });
    if (!(await verifyPassword(password, user.password_hash))) {
      return res.status(403).json({ ok: false, error: 'Mot de passe incorrect' });
    }
    await deleteUser(user.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /api/auth/me]', err.message);
    res.status(500).json({ ok: false, error: 'Erreur serveur' });
  }
});

module.exports = router;
