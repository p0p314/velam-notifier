const express = require('express');
const cors    = require('cors');
const {
  initDb, countStations, getStations, saveStations,
  createUser, getUserByUsername,
  getFavorites, addFavorite, removeFavorite,
  addSubscription,
  getAlerts, createAlert, updateAlert, deleteAlert,
} = require('./db');
const { fetchStationInfo, fetchStationStatus } = require('./gbfs');
const { hashPassword, verifyPassword, signToken, requireAuth } = require('./auth');
const { initPush, getVapidPublicKey, startPolling } = require('./push');

const PORT = process.env.PORT ?? 3001;
// Origine(s) du frontend autorisée(s). Surcharge possible via CORS_ORIGIN
// (liste séparée par des virgules). Par défaut : serveur de dev Vite
// (localhost + accès LAN depuis 192.168.1.110).
const ALLOWED_ORIGINS = (process.env.CORS_ORIGIN ?? 'http://localhost:5173,http://192.168.1.110:5173')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const app = express();

app.use(cors({ origin: ALLOWED_ORIGINS }));
app.use(express.json());

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

// ── Routes : stations ───────────────────────────────────────────────────────────

/**
 * GET /api/stations
 * Infos stations depuis SQLite (fetch auto si base vide).
 * Disponibilité vélos toujours récupérée en direct depuis l'API GBFS.
 */
app.get('/api/stations', async (req, res) => {
  try {
    // Auto-populate au premier appel
    if (countStations() === 0) {
      console.log('[GET /api/stations] base vide — fetch initial...');
      const info = await fetchStationInfo();
      saveStations(info);
    }

    const [stations, statusList] = await Promise.all([
      Promise.resolve(getStations()),
      fetchStationStatus(),
    ]);

    const merged = mergeWithStatus(stations, statusList);

    res.json({
      ok:             true,
      count:          merged.length,
      stations_cache: true,   // infos stations = SQLite
      status_live:    true,   // vélos = API temps réel
      fetched_at:     new Date().toISOString(),
      stations:       merged,
    });
  } catch (err) {
    console.error('[GET /api/stations]', err.message);
    res.status(502).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/stations/refresh
 * Force le rechargement des infos stations depuis l'API GBFS.
 * À appeler manuellement si des stations sont ajoutées/supprimées.
 */
app.post('/api/stations/refresh', async (req, res) => {
  try {
    const info = await fetchStationInfo();
    saveStations(info);
    res.json({
      ok:      true,
      message: `${info.length} stations rechargées depuis l'API`,
      count:   info.length,
    });
  } catch (err) {
    console.error('[POST /api/stations/refresh]', err.message);
    res.status(502).json({ ok: false, error: err.message });
  }
});

// ── Routes : auth ─────────────────────────────────────────────────────────────

app.post('/api/auth/register', (req, res) => {
  const { username, password } = req.body ?? {};
  if (!username?.trim() || !password) {
    return res.status(400).json({ ok: false, error: 'username et password requis' });
  }
  if (password.length < 6) {
    return res.status(400).json({ ok: false, error: 'Le mot de passe doit faire au moins 6 caractères' });
  }
  if (getUserByUsername(username.trim())) {
    return res.status(409).json({ ok: false, error: 'Ce nom d\'utilisateur est déjà pris' });
  }

  const user  = createUser(username.trim(), hashPassword(password));
  const token = signToken(user);
  res.status(201).json({ ok: true, token, user: { id: user.id, username: user.username } });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body ?? {};
  if (!username?.trim() || !password) {
    return res.status(400).json({ ok: false, error: 'username et password requis' });
  }

  const user = getUserByUsername(username.trim());
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ ok: false, error: 'Identifiants incorrects' });
  }

  const token = signToken(user);
  res.json({ ok: true, token, user: { id: user.id, username: user.username } });
});

// ── Routes : favoris (protégées) ────────────────────────────────────────────────

app.get('/api/favorites', requireAuth, (req, res) => {
  res.json({ ok: true, favorites: getFavorites(req.user.id) });
});

app.post('/api/favorites', requireAuth, (req, res) => {
  const { station_id, station_name } = req.body ?? {};
  if (!station_id || !station_name) {
    return res.status(400).json({ ok: false, error: 'station_id et station_name requis' });
  }
  addFavorite(req.user.id, String(station_id), String(station_name));
  res.status(201).json({ ok: true, favorites: getFavorites(req.user.id) });
});

app.delete('/api/favorites/:station_id', requireAuth, (req, res) => {
  removeFavorite(req.user.id, req.params.station_id);
  res.json({ ok: true, favorites: getFavorites(req.user.id) });
});

// ── Routes : push (protégées sauf clé publique) ─────────────────────────────────

app.get('/api/push/vapid-public-key', (req, res) => {
  res.json({ ok: true, publicKey: getVapidPublicKey() });
});

app.post('/api/push/subscribe', requireAuth, (req, res) => {
  const { subscription } = req.body ?? {};
  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ ok: false, error: 'subscription invalide' });
  }
  addSubscription(req.user.id, JSON.stringify(subscription));
  res.status(201).json({ ok: true });
});

// ── Routes : alertes (protégées) ────────────────────────────────────────────────

function validateAlertPayload(body, { partial = false } = {}) {
  const fields = {};
  const errors = [];

  const has = (k) => body[k] !== undefined && body[k] !== null;

  if (!partial || has('station_id'))   { has('station_id')   ? (fields.station_id   = String(body.station_id))   : errors.push('station_id'); }
  if (!partial || has('station_name')) { has('station_name') ? (fields.station_name = String(body.station_name)) : errors.push('station_name'); }
  if (!partial || has('bike_type')) {
    if (['mechanical', 'ebike', 'any'].includes(body.bike_type)) fields.bike_type = body.bike_type;
    else errors.push('bike_type (mechanical|ebike|any)');
  }
  if (!partial || has('min_count')) {
    const n = Number(body.min_count);
    if (Number.isInteger(n) && n >= 1) fields.min_count = n;
    else if (!partial) fields.min_count = 1;
    else errors.push('min_count (entier >= 1)');
  }
  if (!partial || has('time_start')) { HHMM.test(body.time_start ?? '') ? (fields.time_start = body.time_start) : errors.push('time_start (HH:MM)'); }
  if (!partial || has('time_end'))   { HHMM.test(body.time_end ?? '')   ? (fields.time_end   = body.time_end)   : errors.push('time_end (HH:MM)'); }
  if (!partial || has('days')) {
    // "1,2,3" — jours ISO 1..7 ; on normalise (unique + trié).
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

app.get('/api/alerts', requireAuth, (req, res) => {
  res.json({ ok: true, alerts: getAlerts(req.user.id) });
});

app.post('/api/alerts', requireAuth, (req, res) => {
  const { fields, errors } = validateAlertPayload(req.body ?? {});
  if (errors.length) {
    return res.status(400).json({ ok: false, error: `Champs invalides : ${errors.join(', ')}` });
  }
  const alert = createAlert(req.user.id, fields);
  res.status(201).json({ ok: true, alert });
});

app.patch('/api/alerts/:id', requireAuth, (req, res) => {
  const { fields, errors } = validateAlertPayload(req.body ?? {}, { partial: true });
  if (errors.length) {
    return res.status(400).json({ ok: false, error: `Champs invalides : ${errors.join(', ')}` });
  }
  const alert = updateAlert(req.user.id, Number(req.params.id), fields);
  if (!alert) return res.status(404).json({ ok: false, error: 'Alerte introuvable' });
  res.json({ ok: true, alert });
});

app.delete('/api/alerts/:id', requireAuth, (req, res) => {
  const ok = deleteAlert(req.user.id, Number(req.params.id));
  if (!ok) return res.status(404).json({ ok: false, error: 'Alerte introuvable' });
  res.json({ ok: true });
});

// ── Routes : santé ──────────────────────────────────────────────────────────────

app.get('/api/health', (req, res) => {
  res.json({
    ok:              true,
    stations_in_db:  countStations(),
    uptime_seconds:  Math.round(process.uptime()),
    node_version:    process.version,
  });
});

// ── Boot ──────────────────────────────────────────────────────────────────────

initDb();
initPush();
startPolling();

app.listen(PORT, () => {
  console.log(`\nVélam server → http://localhost:${PORT}`);
  console.log(`  CORS autorisé pour : ${ALLOWED_ORIGINS.join(', ')}`);
  console.log(`  GET  /api/stations          — infos + statut live`);
  console.log(`  POST /api/stations/refresh  — force re-fetch des infos stations`);
  console.log(`  POST /api/auth/register|login — authentification`);
  console.log(`  CRUD /api/favorites /api/alerts /api/push/* — protégées (JWT)`);
  console.log(`  GET  /api/health            — état du serveur\n`);
});
