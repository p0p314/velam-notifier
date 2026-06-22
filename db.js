// Couche d'accès aux données (domaine). N'utilise QUE l'interface unifiée `dbc`
// (database/) — jamais better-sqlite3 directement. Toutes les fonctions sont async.
const { dbc } = require('./database');

async function initialize() {
  await dbc.initialize();
}

// ── Stations ────────────────────────────────────────────────────────────────

async function countStations() {
  const row = await dbc.get('SELECT COUNT(*) AS n FROM stations');
  return Number(row?.n ?? 0);
}

async function getStations() {
  const { rows } = await dbc.query('SELECT * FROM stations ORDER BY LOWER(name)');
  return rows;
}

/** Upsert d'une liste de stations (timestamp calculé côté JS, portable). */
async function saveStations(stations) {
  const now = Math.floor(Date.now() / 1000);
  const sql = `
    INSERT INTO stations (station_id, name, address, lat, lon, capacity, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(station_id) DO UPDATE SET
      name       = excluded.name,
      address    = excluded.address,
      lat        = excluded.lat,
      lon        = excluded.lon,
      capacity   = excluded.capacity,
      fetched_at = excluded.fetched_at
  `;
  for (const s of stations) {
    await dbc.run(sql, [
      s.station_id, s.name, s.address?.trim() ?? '', s.lat, s.lon, s.capacity ?? 0, now,
    ]);
  }
  console.log(`[db] ${stations.length} stations enregistrées`);
}

// ── Config (clés/valeurs : secret JWT, clés VAPID) ───────────────────────────

async function getConfig(key) {
  const row = await dbc.get('SELECT value FROM config WHERE key = ?', [key]);
  return row?.value ?? null;
}

async function setConfig(key, value) {
  await dbc.run(
    'INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value]
  );
}

// ── Users ────────────────────────────────────────────────────────────────────

async function createUser(username, passwordHash) {
  const { id } = await dbc.run(
    'INSERT INTO users (username, password_hash) VALUES (?, ?)',
    [username, passwordHash]
  );
  return { id, username };
}

async function getUserByUsername(username) {
  return dbc.get('SELECT * FROM users WHERE username = ?', [username]);
}

async function getUserById(id) {
  return dbc.get('SELECT id, username, created_at FROM users WHERE id = ?', [id]);
}

// ── Favorites ────────────────────────────────────────────────────────────────

async function getFavorites(userId) {
  const { rows } = await dbc.query(
    'SELECT station_id, station_name FROM favorites WHERE user_id = ? ORDER BY LOWER(station_name)',
    [userId]
  );
  return rows;
}

async function addFavorite(userId, stationId, stationName) {
  await dbc.run(
    `INSERT INTO favorites (user_id, station_id, station_name) VALUES (?, ?, ?)
     ON CONFLICT(user_id, station_id) DO UPDATE SET station_name = excluded.station_name`,
    [userId, stationId, stationName]
  );
}

async function removeFavorite(userId, stationId) {
  await dbc.run('DELETE FROM favorites WHERE user_id = ? AND station_id = ?', [userId, stationId]);
}

// ── Push subscriptions ───────────────────────────────────────────────────────

async function addSubscription(userId, subscriptionJson) {
  const existing = await dbc.get(
    'SELECT id FROM push_subscriptions WHERE user_id = ? AND subscription = ?',
    [userId, subscriptionJson]
  );
  if (existing) return existing.id;
  const { id } = await dbc.run(
    'INSERT INTO push_subscriptions (user_id, subscription) VALUES (?, ?)',
    [userId, subscriptionJson]
  );
  return id;
}

async function getSubscriptionsByUser(userId) {
  const { rows } = await dbc.query(
    'SELECT id, subscription FROM push_subscriptions WHERE user_id = ?',
    [userId]
  );
  return rows;
}

async function removeSubscriptionById(id) {
  await dbc.run('DELETE FROM push_subscriptions WHERE id = ?', [id]);
}

// ── Alerts ───────────────────────────────────────────────────────────────────

async function getAlerts(userId) {
  const { rows } = await dbc.query('SELECT * FROM alerts WHERE user_id = ? ORDER BY created_at DESC', [userId]);
  return rows;
}

async function getAlert(userId, id) {
  return dbc.get('SELECT * FROM alerts WHERE id = ? AND user_id = ?', [id, userId]);
}

async function createAlert(userId, a) {
  const { id } = await dbc.run(
    `INSERT INTO alerts (user_id, station_id, station_name, bike_type, min_count, time_start, time_end, active, days)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
      a.station_id,
      a.station_name,
      a.bike_type,
      a.min_count ?? 1,
      a.time_start,
      a.time_end,
      a.active === undefined ? 1 : (a.active ? 1 : 0),
      a.days ?? '1,2,3,4,5,6,7',
    ]
  );
  return getAlert(userId, id);
}

/**
 * Met à jour les champs fournis d'une alerte de l'utilisateur.
 * Retourne l'alerte mise à jour, ou null si introuvable / non possédée.
 */
async function updateAlert(userId, id, fields) {
  const current = await getAlert(userId, id);
  if (!current) return null;

  const allowed = ['station_id', 'station_name', 'bike_type', 'min_count', 'time_start', 'time_end', 'active', 'days'];
  const keys = Object.keys(fields).filter((k) => allowed.includes(k));
  if (keys.length === 0) return current;

  const setClause = keys.map((k) => `${k} = ?`).join(', ');
  const params = keys.map((k) => (k === 'active' ? (fields[k] ? 1 : 0) : fields[k]));
  params.push(id, userId);

  await dbc.run(`UPDATE alerts SET ${setClause} WHERE id = ? AND user_id = ?`, params);
  return getAlert(userId, id);
}

async function deleteAlert(userId, id) {
  const { changes } = await dbc.run('DELETE FROM alerts WHERE id = ? AND user_id = ?', [id, userId]);
  return changes > 0;
}

async function markAlertNotified(id, date, count) {
  await dbc.run('UPDATE alerts SET last_notified_date = ?, last_notified_count = ? WHERE id = ?', [date, count, id]);
}

async function setAlertNotifiedCount(id, count) {
  await dbc.run('UPDATE alerts SET last_notified_count = ? WHERE id = ?', [count, id]);
}

async function countActiveAlerts() {
  const row = await dbc.get('SELECT COUNT(*) AS n FROM alerts WHERE active = 1');
  return Number(row?.n ?? 0);
}

async function getActiveAlerts() {
  const { rows } = await dbc.query('SELECT * FROM alerts WHERE active = 1');
  return rows;
}

module.exports = {
  initialize,
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
  markAlertNotified, setAlertNotifiedCount, countActiveAlerts, getActiveAlerts,
};
