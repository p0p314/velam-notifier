const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const crypto = require('crypto');
const { getConfig, setConfig, getTokenVersion } = require('./db');

// Session glissante : le client renouvelle son jeton à chaque ouverture de l'app
// (GET /api/auth/me). Seule une inactivité > TOKEN_TTL impose de se reconnecter.
const TOKEN_TTL = process.env.JWT_TTL || '30d';

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

/** `tv` : version de session du compte au moment de l'émission (révocation). */
function signToken(user) {
  return jwt.sign({ id: user.id, username: user.username, tv: Number(user.token_version ?? 0) }, getSecret(), {
    expiresIn: TOKEN_TTL,
    algorithm: 'HS256',
  });
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

  try {
    // Jetons antérieurs à la révocation (sans `tv`) : version 0, valides tant
    // qu'aucune révocation n'a eu lieu.
    const current = await getTokenVersion(payload.id);
    if (current === null || current !== Number(payload.tv ?? 0)) {
      return res.status(401).json({ ok: false, error: 'Session expirée, reconnectez-vous' });
    }
  } catch (err) {
    console.error('[auth] vérification de session', err.message);
    return res.status(500).json({ ok: false, error: 'Erreur serveur' });
  }

  req.user = { id: payload.id, username: payload.username };
  next();
}

module.exports = { initAuth, hashPassword, verifyPassword, signToken, requireAuth };
