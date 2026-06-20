const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH  = path.join(DATA_DIR, 'velam.db');

// Créer le dossier si absent
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

let _db = null;

function db() {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
  }
  return _db;
}

function initDb() {
  db().exec(`
    CREATE TABLE IF NOT EXISTS stations (
      station_id  TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      address     TEXT NOT NULL DEFAULT '',
      lat         REAL NOT NULL,
      lon         REAL NOT NULL,
      capacity    INTEGER NOT NULL DEFAULT 0,
      fetched_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
    );

    CREATE TABLE IF NOT EXISTS config (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS favorites (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER NOT NULL REFERENCES users(id),
      station_id   TEXT NOT NULL,
      station_name TEXT NOT NULL,
      UNIQUE(user_id, station_id)
    );

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER NOT NULL REFERENCES users(id),
      subscription TEXT NOT NULL,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS alerts (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER NOT NULL REFERENCES users(id),
      station_id   TEXT NOT NULL,
      station_name TEXT NOT NULL,
      bike_type    TEXT NOT NULL CHECK(bike_type IN ('mechanical', 'ebike', 'any')),
      min_count    INTEGER NOT NULL DEFAULT 1,
      time_start   TEXT NOT NULL,
      time_end     TEXT NOT NULL,
      active       INTEGER NOT NULL DEFAULT 1,
      days         TEXT NOT NULL DEFAULT '1,2,3,4,5,6,7',
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Migration idempotente de la déduplication des push.
  // SQLite n'a pas d'ADD/DROP COLUMN IF NOT EXISTS → on inspecte via PRAGMA.
  const cols = db().prepare('PRAGMA table_info(alerts)').all();
  const hasColumn = (name) => cols.some((col) => col.name === name);

  // Ajout de last_notified_date ("YYYY-MM-DD") si absente.
  if (!hasColumn('last_notified_date')) {
    db().exec('ALTER TABLE alerts ADD COLUMN last_notified_date TEXT DEFAULT NULL;');
    console.log('[db] colonne alerts.last_notified_date ajoutée');
  }

  // Ajout de days (jours actifs ISO "1,2,3,4,5,6,7" — 1=lundi … 7=dimanche).
  if (!hasColumn('days')) {
    db().exec("ALTER TABLE alerts ADD COLUMN days TEXT NOT NULL DEFAULT '1,2,3,4,5,6,7';");
    console.log('[db] colonne alerts.days ajoutée');
  }

  // Suppression de l'ancienne colonne notified si présente.
  // DROP COLUMN n'existe qu'à partir de SQLite 3.35 → on vérifie la version
  // et on ignore silencieusement sinon.
  if (hasColumn('notified')) {
    const [maj, min] = db().prepare('SELECT sqlite_version() AS v').get().v.split('.').map(Number);
    const supportsDrop = maj > 3 || (maj === 3 && min >= 35);
    if (supportsDrop) {
      try {
        db().exec('ALTER TABLE alerts DROP COLUMN notified;');
        console.log('[db] colonne alerts.notified supprimée');
      } catch (err) {
        console.warn('[db] suppression de alerts.notified ignorée :', err.message);
      }
    } else {
      console.warn('[db] DROP COLUMN non supporté (SQLite < 3.35) — alerts.notified conservée');
    }
  }

  console.log(`[db] SQLite initialisée → ${DB_PATH}`);
}

// ── Stations ────────────────────────────────────────────────────────────────

function countStations() {
  return db().prepare('SELECT COUNT(*) AS n FROM stations').get().n;
}

function getStations() {
  return db().prepare('SELECT * FROM stations ORDER BY name COLLATE NOCASE').all();
}

/**
 * Upsert d'une liste de stations.
 * Utilise une transaction pour éviter des écritures partielles.
 */
function saveStations(stations) {
  const stmt = db().prepare(`
    INSERT INTO stations (station_id, name, address, lat, lon, capacity, fetched_at)
    VALUES (@station_id, @name, @address, @lat, @lon, @capacity, strftime('%s', 'now'))
    ON CONFLICT(station_id) DO UPDATE SET
      name       = excluded.name,
      address    = excluded.address,
      lat        = excluded.lat,
      lon        = excluded.lon,
      capacity   = excluded.capacity,
      fetched_at = excluded.fetched_at
  `);

  const run = db().transaction((list) => {
    for (const s of list) {
      stmt.run({
        station_id: s.station_id,
        name:       s.name,
        address:    s.address?.trim() ?? '',
        lat:        s.lat,
        lon:        s.lon,
        capacity:   s.capacity ?? 0,
      });
    }
  });

  run(stations);
  console.log(`[db] ${stations.length} stations enregistrées`);
}

// ── Config (clés/valeurs : secret JWT, clés VAPID) ───────────────────────────

function getConfig(key) {
  return db().prepare('SELECT value FROM config WHERE key = ?').get(key)?.value ?? null;
}

function setConfig(key, value) {
  db().prepare(`
    INSERT INTO config (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}

// ── Users ────────────────────────────────────────────────────────────────────

function createUser(username, passwordHash) {
  const info = db()
    .prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
    .run(username, passwordHash);
  return { id: info.lastInsertRowid, username };
}

function getUserByUsername(username) {
  return db().prepare('SELECT * FROM users WHERE username = ?').get(username);
}

function getUserById(id) {
  return db().prepare('SELECT id, username, created_at FROM users WHERE id = ?').get(id);
}

// ── Favorites ────────────────────────────────────────────────────────────────

function getFavorites(userId) {
  return db()
    .prepare('SELECT station_id, station_name FROM favorites WHERE user_id = ? ORDER BY station_name COLLATE NOCASE')
    .all(userId);
}

function addFavorite(userId, stationId, stationName) {
  db().prepare(`
    INSERT INTO favorites (user_id, station_id, station_name) VALUES (?, ?, ?)
    ON CONFLICT(user_id, station_id) DO UPDATE SET station_name = excluded.station_name
  `).run(userId, stationId, stationName);
}

function removeFavorite(userId, stationId) {
  db().prepare('DELETE FROM favorites WHERE user_id = ? AND station_id = ?').run(userId, stationId);
}

// ── Push subscriptions ───────────────────────────────────────────────────────

function addSubscription(userId, subscriptionJson) {
  // Évite les doublons exacts pour un même user (même endpoint)
  const existing = db()
    .prepare('SELECT id FROM push_subscriptions WHERE user_id = ? AND subscription = ?')
    .get(userId, subscriptionJson);
  if (existing) return existing.id;
  return db()
    .prepare('INSERT INTO push_subscriptions (user_id, subscription) VALUES (?, ?)')
    .run(userId, subscriptionJson).lastInsertRowid;
}

function getSubscriptionsByUser(userId) {
  return db().prepare('SELECT id, subscription FROM push_subscriptions WHERE user_id = ?').all(userId);
}

function removeSubscriptionById(id) {
  db().prepare('DELETE FROM push_subscriptions WHERE id = ?').run(id);
}

// ── Alerts ───────────────────────────────────────────────────────────────────

function getAlerts(userId) {
  return db().prepare('SELECT * FROM alerts WHERE user_id = ? ORDER BY created_at DESC').all(userId);
}

function getAlert(userId, id) {
  return db().prepare('SELECT * FROM alerts WHERE id = ? AND user_id = ?').get(id, userId);
}

function createAlert(userId, a) {
  const info = db().prepare(`
    INSERT INTO alerts (user_id, station_id, station_name, bike_type, min_count, time_start, time_end, active, days)
    VALUES (@user_id, @station_id, @station_name, @bike_type, @min_count, @time_start, @time_end, @active, @days)
  `).run({
    user_id:      userId,
    station_id:   a.station_id,
    station_name: a.station_name,
    bike_type:    a.bike_type,
    min_count:    a.min_count ?? 1,
    time_start:   a.time_start,
    time_end:     a.time_end,
    active:       a.active === undefined ? 1 : (a.active ? 1 : 0),
    days:         a.days ?? '1,2,3,4,5,6,7',
  });
  return getAlert(userId, info.lastInsertRowid);
}

/**
 * Met à jour les champs fournis d'une alerte appartenant à l'utilisateur.
 * Retourne l'alerte mise à jour, ou null si elle n'existe pas / n'appartient pas à l'user.
 */
function updateAlert(userId, id, fields) {
  const current = getAlert(userId, id);
  if (!current) return null;

  const allowed = ['station_id', 'station_name', 'bike_type', 'min_count', 'time_start', 'time_end', 'active', 'days'];
  const keys = Object.keys(fields).filter((k) => allowed.includes(k));
  if (keys.length === 0) return current;

  const setClause = keys.map((k) => `${k} = @${k}`).join(', ');
  const params = { id, user_id: userId };
  for (const k of keys) {
    params[k] = k === 'active' ? (fields[k] ? 1 : 0) : fields[k];
  }

  db().prepare(`UPDATE alerts SET ${setClause} WHERE id = @id AND user_id = @user_id`).run(params);
  return getAlert(userId, id);
}

function deleteAlert(userId, id) {
  const info = db().prepare('DELETE FROM alerts WHERE id = ? AND user_id = ?').run(id, userId);
  return info.changes > 0;
}

function setAlertNotifiedDate(id, date) {
  db().prepare('UPDATE alerts SET last_notified_date = ? WHERE id = ?').run(date, id);
}

function countActiveAlerts() {
  return db().prepare('SELECT COUNT(*) AS n FROM alerts WHERE active = 1').get().n;
}

function getActiveAlerts() {
  return db().prepare('SELECT * FROM alerts WHERE active = 1').all();
}

module.exports = {
  initDb,
  // stations
  countStations, getStations, saveStations,
  // config
  getConfig, setConfig,
  // users
  createUser, getUserByUsername, getUserById,
  // favorites
  getFavorites, addFavorite, removeFavorite,
  // push
  addSubscription, getSubscriptionsByUser, removeSubscriptionById,
  // alerts
  getAlerts, getAlert, createAlert, updateAlert, deleteAlert,
  setAlertNotifiedDate, countActiveAlerts, getActiveAlerts,
};
