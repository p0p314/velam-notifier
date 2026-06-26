const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');
const path      = require('path');
const fs        = require('fs');
const {
  initialize, countStations, getStations, saveStations,
  createUser, getUserByUsername,
  getFavorites, addFavorite, removeFavorite,
  addSubscription,
  getAlerts, createAlert, updateAlert, deleteAlert,
} = require('./db');
const { fetchStationInfo, fetchStationStatus } = require('./gbfs');
const { initAuth, hashPassword, verifyPassword, signToken, requireAuth } = require('./auth');
const { initPush, getVapidPublicKey, startPolling } = require('./push');
const { syncRentalApps } = require('./rentalApps');
const { getRentalApps } = require('./db');

const PORT = process.env.PORT ?? 3001;
// Origine(s) du frontend autorisée(s) en dev (CORS). En prod, front et back
// partagent le même domaine → pas de CORS. Surcharge via CORS_ORIGIN.
const ALLOWED_ORIGINS = (process.env.CORS_ORIGIN ?? 'http://localhost:5173,http://192.168.1.110:5173')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const app = express();
app.set('trust proxy', 1); // derrière le proxy Render → vraie IP client (rate-limit)

// En-têtes de sécurité. CSP adaptée au SPA : JS/CSS bundlés en 'self', styles
// inline React tolérés, API + worker same-origin.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:     ["'self'"],
      // Mapbox GL crée ses web workers depuis un blob → 'blob:' requis.
      scriptSrc:      ["'self'", "blob:"],
      styleSrc:       ["'self'", "'unsafe-inline'"],
      imgSrc:         ["'self'", "data:", "blob:"],
      connectSrc:     ["'self'", "https://api.mapbox.com", "https://events.mapbox.com", "https://*.tiles.mapbox.com"],
      manifestSrc:    ["'self'"],
      workerSrc:      ["'self'", "blob:"],
      childSrc:       ["'self'", "blob:"],
      objectSrc:      ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
}));

// CORS : whitelist explicite. En prod le domaine public, en dev localhost/LAN.
const corsOptions = process.env.NODE_ENV === 'production'
  ? { origin: process.env.FRONTEND_URL || 'https://velam-notifier.onrender.com' }
  : { origin: ALLOWED_ORIGINS };
app.use(cors(corsOptions));

app.use(express.json({ limit: '16kb' })); // borne la taille des corps (anti-DoS)

// Rate limiting anti-bruteforce sur l'authentification.
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractCount(vehicleTypes, typeId) {
  return vehicleTypes?.find((v) => v.vehicle_type_id === typeId)?.count ?? 0;
}

function mergeWithStatus(stations, statusList) {
  const statusMap = Object.fromEntries(statusList.map((s) => [s.station_id, s]));

  return stations.map((s) => {
    const live = statusMap[s.station_id] ?? {};
    const vta  = live.vehicle_types_available ?? [];
    return {
      station_id:      s.station_id,
      name:            s.name,
      address:         s.address,
      lat:             s.lat,
      lon:             s.lon,
      capacity:        s.capacity,
      // Vélos — toujours depuis l'API live
      mechanical:      extractCount(vta, 'mechanical'),
      electrical:      extractCount(vta, 'electrical'),
      total_bikes:     live.num_bikes_available    ?? 0,
      docks_available: live.num_docks_available    ?? 0,
      bikes_disabled:  live.num_bikes_disabled     ?? 0,
      is_renting:      live.is_renting             ?? false,
      is_returning:    live.is_returning            ?? false,
      last_reported:   live.last_reported           ?? null,
    };
  });
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

// ── Health (anti-sleep, public, sans auth) ──────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Routes : stations ───────────────────────────────────────────────────────────

/**
 * GET /api/stations
 * Infos stations depuis la base (fetch auto si vide).
 * Disponibilité vélos toujours récupérée en direct depuis l'API GBFS.
 */
app.get('/api/stations', async (req, res) => {
  try {
    // Auto-populate au premier appel
    if (await countStations() === 0) {
      console.log('[GET /api/stations] base vide — fetch initial...');
      const info = await fetchStationInfo();
      await saveStations(info);
    }

    const [stations, statusList] = await Promise.all([
      getStations(),
      fetchStationStatus(),
    ]);

    const merged = mergeWithStatus(stations, statusList);

    res.json({
      ok:             true,
      count:          merged.length,
      stations_cache: true,
      status_live:    true,
      fetched_at:     new Date().toISOString(),
      stations:       merged,
    });
  } catch (err) {
    console.error('[GET /api/stations]', err.message);
    res.status(502).json({ ok: false, error: 'Service temporairement indisponible' });
  }
});

/**
 * POST /api/stations/refresh
 * Force le rechargement des infos stations depuis l'API GBFS.
 */
app.post('/api/stations/refresh', async (req, res) => {
  try {
    const info = await fetchStationInfo();
    await saveStations(info);
    res.json({
      ok:      true,
      message: `${info.length} stations rechargées depuis l'API`,
      count:   info.length,
    });
  } catch (err) {
    console.error('[POST /api/stations/refresh]', err.message);
    res.status(502).json({ ok: false, error: 'Service temporairement indisponible' });
  }
});

// ── Routes : rental apps (deep links officiels) ─────────────────────────────────

const crypto = require('crypto');

/**
 * Garde l'endpoint cron : exige `Authorization: Bearer <CRON_SECRET>`.
 * Comparaison à temps constant (anti timing-attack). 503 si secret non configuré.
 */
function requireCronSecret(req, res, next) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[cron] CRON_SECRET non configuré — endpoint désactivé');
    return res.status(503).json({ ok: false, error: 'Endpoint cron non configuré' });
  }
  const header = req.get('authorization') ?? '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : '';
  const a = Buffer.from(token);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ ok: false, error: 'Token cron invalide' });
  }
  next();
}

/**
 * POST /cron/sync-rental-apps
 * Déclenché quotidiennement par GitHub Actions. Re-synchronise les rental_apps
 * depuis le flux GBFS system_information. Protégé par CRON_SECRET.
 */
app.post('/cron/sync-rental-apps', requireCronSecret, async (req, res) => {
  try {
    const apps = await syncRentalApps();
    res.json({ ok: true, count: apps.length, apps });
  } catch (err) {
    console.error('[POST /cron/sync-rental-apps]', err.message);
    res.status(502).json({ ok: false, error: 'Échec de la synchronisation rental_apps' });
  }
});

/** GET /api/rental-apps — lecture publique des deep links/stores synchronisés. */
app.get('/api/rental-apps', async (req, res) => {
  try {
    res.json({ ok: true, apps: await getRentalApps() });
  } catch (err) {
    console.error('[GET /api/rental-apps]', err.message);
    res.status(500).json({ ok: false, error: 'Erreur serveur' });
  }
});

// ── Routes : auth ─────────────────────────────────────────────────────────────

app.post('/api/auth/register', registerLimiter, async (req, res) => {
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

app.post('/api/auth/login', loginLimiter, async (req, res) => {
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

// ── Routes : favoris (protégées) ────────────────────────────────────────────────

app.get('/api/favorites', requireAuth, async (req, res) => {
  try {
    res.json({ ok: true, favorites: await getFavorites(req.user.id) });
  } catch (err) {
    console.error('[GET /api/favorites]', err.message);
    res.status(500).json({ ok: false, error: 'Erreur serveur' });
  }
});

app.post('/api/favorites', requireAuth, async (req, res) => {
  try {
    const { station_id, station_name } = req.body ?? {};
    if (!station_id || !station_name) {
      return res.status(400).json({ ok: false, error: 'station_id et station_name requis' });
    }
    await addFavorite(req.user.id, String(station_id), String(station_name));
    res.status(201).json({ ok: true, favorites: await getFavorites(req.user.id) });
  } catch (err) {
    console.error('[POST /api/favorites]', err.message);
    res.status(500).json({ ok: false, error: 'Erreur serveur' });
  }
});

app.delete('/api/favorites/:station_id', requireAuth, async (req, res) => {
  try {
    await removeFavorite(req.user.id, req.params.station_id);
    res.json({ ok: true, favorites: await getFavorites(req.user.id) });
  } catch (err) {
    console.error('[DELETE /api/favorites]', err.message);
    res.status(500).json({ ok: false, error: 'Erreur serveur' });
  }
});

// ── Routes : push (protégées sauf clé publique) ─────────────────────────────────

app.get('/api/push/vapid-public-key', (req, res) => {
  res.json({ ok: true, publicKey: getVapidPublicKey() });
});

app.post('/api/push/subscribe', requireAuth, async (req, res) => {
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

// ── Routes : alertes (protégées) ────────────────────────────────────────────────

function validateAlertPayload(body, { partial = false } = {}) {
  const fields = {};
  const errors = [];

  const has = (k) => body[k] !== undefined && body[k] !== null;

  if (!partial || has('station_id'))   { has('station_id')   && String(body.station_id).length   <= 64  ? (fields.station_id   = String(body.station_id))   : errors.push('station_id'); }
  if (!partial || has('station_name')) { has('station_name') && String(body.station_name).length <= 128 ? (fields.station_name = String(body.station_name)) : errors.push('station_name'); }
  if (!partial || has('bike_type')) {
    if (['mechanical', 'ebike', 'any'].includes(body.bike_type)) fields.bike_type = body.bike_type;
    else errors.push('bike_type (mechanical|ebike|any)');
  }
  if (!partial || has('min_count')) {
    const n = Number(body.min_count);
    if (Number.isInteger(n) && n >= 1 && n <= 50) fields.min_count = n;
    else if (!partial) fields.min_count = 1;
    else errors.push('min_count (entier 1-50)');
  }
  if (!partial || has('time_start')) { HHMM.test(body.time_start ?? '') ? (fields.time_start = body.time_start) : errors.push('time_start (HH:MM)'); }
  if (!partial || has('time_end'))   { HHMM.test(body.time_end ?? '')   ? (fields.time_end   = body.time_end)   : errors.push('time_end (HH:MM)'); }
  if (!partial || has('days')) {
    if (typeof body.days === 'string' && /^[1-7](,[1-7])*$/.test(body.days)) {
      fields.days = [...new Set(body.days.split(',').map(Number))].sort((a, b) => a - b).join(',');
    } else if (!partial) {
      fields.days = '1,2,3,4,5,6,7';
    } else {
      errors.push('days (ex: "1,2,3" — chiffres 1-7)');
    }
  }
  if (has('active')) fields.active = body.active ? 1 : 0;

  return { fields, errors };
}

app.get('/api/alerts', requireAuth, async (req, res) => {
  try {
    res.json({ ok: true, alerts: await getAlerts(req.user.id) });
  } catch (err) {
    console.error('[GET /api/alerts]', err.message);
    res.status(500).json({ ok: false, error: 'Erreur serveur' });
  }
});

app.post('/api/alerts', requireAuth, async (req, res) => {
  try {
    const { fields, errors } = validateAlertPayload(req.body ?? {});
    if (errors.length) {
      return res.status(400).json({ ok: false, error: `Champs invalides : ${errors.join(', ')}` });
    }
    const alert = await createAlert(req.user.id, fields);
    res.status(201).json({ ok: true, alert });
  } catch (err) {
    console.error('[POST /api/alerts]', err.message);
    res.status(500).json({ ok: false, error: 'Erreur serveur' });
  }
});

app.patch('/api/alerts/:id', requireAuth, async (req, res) => {
  try {
    const { fields, errors } = validateAlertPayload(req.body ?? {}, { partial: true });
    if (errors.length) {
      return res.status(400).json({ ok: false, error: `Champs invalides : ${errors.join(', ')}` });
    }
    const alert = await updateAlert(req.user.id, Number(req.params.id), fields);
    if (!alert) return res.status(404).json({ ok: false, error: 'Alerte introuvable' });
    res.json({ ok: true, alert });
  } catch (err) {
    console.error('[PATCH /api/alerts]', err.message);
    res.status(500).json({ ok: false, error: 'Erreur serveur' });
  }
});

app.delete('/api/alerts/:id', requireAuth, async (req, res) => {
  try {
    const ok = await deleteAlert(req.user.id, Number(req.params.id));
    if (!ok) return res.status(404).json({ ok: false, error: 'Alerte introuvable' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /api/alerts]', err.message);
    res.status(500).json({ ok: false, error: 'Erreur serveur' });
  }
});

// ── Routes : santé API ──────────────────────────────────────────────────────────

app.get('/api/health', async (req, res) => {
  res.json({
    ok:              true,
    stations_in_db:  await countStations(),
    uptime_seconds:  Math.round(process.uptime()),
    node_version:    process.version,
  });
});

// ── Redirection notifications → app Vélam ────────────────────────────────────────
// Le SW iOS ne peut ouvrir que des URLs same-origin ; cette route redirige (302)
// vers velam.amiens.fr pour que iOS brise le contexte PWA et ouvre Safari/l'app.
app.get('/open', (req, res) => {
  const target = String(req.query.url || '');
  if (target.startsWith('https://velam.amiens.fr/')) {
    return res.redirect(302, target);
  }
  res.redirect(302, 'https://velam.amiens.fr/fr/home');
});

// ── Production : sert le build Vite (SPA) après toutes les routes /api ───────────

if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, 'frontend', 'dist');
  // Garde-fou : alerte uniquement si le build frontend est absent.
  if (!fs.existsSync(distPath)) console.error('[server] build frontend introuvable à :', distPath);
  app.use(express.static(distPath));
  // Fallback SPA : toute route non-API renvoie index.html.
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// ── Boot ──────────────────────────────────────────────────────────────────────

(async () => {
  await initialize();   // crée/migre les tables (SQLite dev / PostgreSQL prod)
  await initAuth();     // résout le secret JWT
  await initPush();     // configure les clés VAPID
  startPolling();

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\nVéloPulse server → port ${PORT} (0.0.0.0)`);
    console.log(`  DB : ${process.env.DATABASE_URL ? 'PostgreSQL' : 'SQLite (dev)'}`);
    console.log(`  CORS autorisé pour : ${ALLOWED_ORIGINS.join(', ')}`);
    console.log(`  GET  /health                — anti-sleep`);
    console.log(`  GET  /api/stations          — infos + statut live`);
    console.log(`  CRUD /api/favorites /api/alerts /api/push/* — protégées (JWT)\n`);
  });
})().catch((err) => {
  console.error('[boot] échec du démarrage :', err);
  process.exit(1);
});
