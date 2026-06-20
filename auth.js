const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const crypto = require('crypto');
const { getConfig, setConfig } = require('./db');

const TOKEN_TTL = '7d';

/**
 * Secret de signature JWT. Priorité à la variable d'env JWT_SECRET ;
 * sinon on génère un secret aléatoire persisté en base (table config).
 */
function getSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  let secret = getConfig('jwt_secret');
  if (!secret) {
    secret = crypto.randomBytes(48).toString('hex');
    setConfig('jwt_secret', secret);
    console.log('[auth] Secret JWT généré et persisté');
  }
  return secret;
}

function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

function verifyPassword(password, hash) {
  return bcrypt.compareSync(password, hash);
}

function signToken(user) {
  return jwt.sign({ id: user.id, username: user.username }, getSecret(), { expiresIn: TOKEN_TTL });
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
    const payload = jwt.verify(token, getSecret());
    req.user = { id: payload.id, username: payload.username };
    next();
  } catch {
    res.status(401).json({ ok: false, error: 'Token invalide ou expiré' });
  }
}

module.exports = { hashPassword, verifyPassword, signToken, requireAuth };
