const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const crypto = require('crypto');
const { getConfig, setConfig, getTokenVersion, getSessionAuth, createSession } = require('./db');

// Session glissante : le client renouvelle son jeton à chaque ouverture de l'app
// (GET /api/auth/me). Seule une inactivité > TOKEN_TTL impose de se reconnecter.
const TOKEN_TTL = process.env.JWT_TTL || '30d';

/** Durée de vie d'un jeton en ms (« 30d », « 12h », « 90m », « 3600 » s) — sessions à purger au-delà. */
function ttlMs(ttl = TOKEN_TTL) {
  const m = /^(\d+)\s*([smhd]?)$/.exec(String(ttl).trim());
  if (!m) return 30 * 86_400_000;
  return Number(m[1]) * { '': 1000, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2]];
}
const SESSION_TTL_MS = ttlMs();

let _secret = null;

/**
 * Résout le secret JWT une fois au démarrage et le met en cache (sync ensuite).
 * Priorité à JWT_SECRET (env) ; sinon secret aléatoire persisté en base (dev).
 */
async function initAuth() {
  if (process.env.JWT_SECRET) {
    _secret = process.env.JWT_SECRET;
    return;
  }
  _secret = await getConfig('jwt_secret');
  if (!_secret) {
    _secret = crypto.randomBytes(48).toString('hex');
    await setConfig('jwt_secret', _secret);
    console.log('[auth] Secret JWT généré et persisté');
  }
}

function getSecret() {
  if (!_secret) throw new Error('Auth non initialisée (appeler initAuth au démarrage)');
  return _secret;
}

// Versions async : bcrypt est volontairement lent (~70 ms) ; la variante sync
// bloquerait la boucle d'événements (toutes les requêtes + la boucle d'alerte).
function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

/**
 * `tv` : version de session du compte au moment de l'émission (révocation globale) ;
 * `sid` : appareil (ligne `sessions`) auquel le jeton appartient (révocation ciblée).
 */
function signToken(user, sid = null) {
  const payload = { id: user.id, username: user.username, tv: Number(user.token_version ?? 0) };
  if (sid) payload.sid = sid;
  return jwt.sign(payload, getSecret(), {
    expiresIn: TOKEN_TTL,
    algorithm: 'HS256',
  });
}

/** Navigateur de l'appareil (pour le nommer dans « Appareils connectés »), borné. */
const userAgentOf = (req) => (req.get?.('user-agent') ?? '').slice(0, 300) || null;

/** Ouvre une session pour cet appareil ; renvoie `{ token, sid }` si `withId`, sinon le jeton. */
async function startSession(user, req, { withId = false } = {}) {
  const sid = crypto.randomUUID();
  await createSession(sid, user.id, userAgentOf(req));
  const token = signToken(user, sid);
  return withId ? { token, sid } : token;
}

/**
 * Middleware : exige un header `Authorization: Bearer <token>` valide, émis pour
 * la version de session courante du compte (sinon révoqué : « déconnecter les
 * autres appareils », changement de mot de passe) et d'un compte existant.
 * Injecte req.user = { id, username } et appelle next(), sinon 401.
 * Coût : une lecture par clé primaire par requête authentifiée.
 */
async function requireAuth(req, res, next) {
  const header = req.headers.authorization ?? '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ ok: false, error: 'Authentification requise' });
  }

  let payload;
  try {
    payload = jwt.verify(token, getSecret(), { algorithms: ['HS256'] });
  } catch {
    return res.status(401).json({ ok: false, error: 'Token invalide ou expiré' });
  }

  const expired = () => res.status(401).json({ ok: false, error: 'Session expirée, reconnectez-vous' });
  try {
    if (payload.sid) {
      // Jeton d'appareil : la session doit exister (appareil non déconnecté).
      const session = await getSessionAuth(payload.sid);
      if (!session || Number(session.user_id) !== payload.id) return expired();
    } else {
      // Jetons antérieurs aux sessions (sans `sid`, `tv` absent = 0) : valides tant
      // qu'aucune révocation globale n'a eu lieu ; /api/auth/me leur ouvre une session.
      const current = await getTokenVersion(payload.id);
      if (current === null || current !== Number(payload.tv ?? 0)) return expired();
    }
  } catch (err) {
    console.error('[auth] vérification de session', err.message);
    return res.status(500).json({ ok: false, error: 'Erreur serveur' });
  }

  req.user = { id: payload.id, username: payload.username };
  req.sessionId = payload.sid ?? null;
  next();
}

module.exports = {
  initAuth, hashPassword, verifyPassword, signToken, requireAuth, startSession, userAgentOf, ttlMs, SESSION_TTL_MS,
};
