// Routes d'authentification (inscription / connexion) + rate limiting anti-bruteforce.
const express   = require('express');
const rateLimit = require('express-rate-limit');
const { createUser, getUserByUsername } = require('../db');
const { hashPassword, verifyPassword, signToken } = require('../auth');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  standardHeaders: true, legacyHeaders: false,
  message: { ok: false, error: 'Trop de tentatives, réessayez dans 15 minutes.' },
});
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 5,
  standardHeaders: true, legacyHeaders: false,
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

    const user  = await createUser(username.trim(), hashPassword(password));
    const token = signToken(user);
    res.status(201).json({ ok: true, token, user: { id: user.id, username: user.username } });
  } catch (err) {
    console.error('[POST /api/auth/register]', err.message);
    res.status(500).json({ ok: false, error: 'Erreur serveur' });
  }
});

router.post('/api/auth/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body ?? {};
    if (!username?.trim() || !password) {
      return res.status(400).json({ ok: false, error: 'username et password requis' });
    }

    const user = await getUserByUsername(username.trim());
    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ ok: false, error: 'Identifiants incorrects' });
    }

    const token = signToken(user);
    res.json({ ok: true, token, user: { id: user.id, username: user.username } });
  } catch (err) {
    console.error('[POST /api/auth/login]', err.message);
    res.status(500).json({ ok: false, error: 'Erreur serveur' });
  }
});

module.exports = router;
