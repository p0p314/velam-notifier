const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const crypto = require('crypto');
const { getConfig, setConfig } = require('./db');

const TOKEN_TTL = '7d';

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

function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

function verifyPassword(password, hash) {
  return bcrypt.compareSync(password, hash);
}

function signToken(user) {
  return jwt.sign({ id: user.id, username: user.username }, getSecret(), {
    expiresIn: TOKEN_TTL,
    algorithm: 'HS256',
  });
}

/**
 * Middleware : exige un header `Authorization: Bearer <token>` valide.
 * Injecte req.user = { id, username } et appelle next(), sinon 401.
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization ?? '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ ok: false, error: 'Authentification requise' });
  }

  try {
    const payload = jwt.verify(token, getSecret(), { algorithms: ['HS256'] });
    req.user = { id: payload.id, username: payload.username };
    next();
  } catch {
    res.status(401).json({ ok: false, error: 'Token invalide ou expiré' });
  }
}

module.exports = { initAuth, hashPassword, verifyPassword, signToken, requireAuth };
