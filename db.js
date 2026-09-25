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

/**
 * Upsert du référentiel stations en un seul INSERT multi-lignes (1 aller-retour DB,
 * atomique). Déduplique par station_id (dernier gagne) pour éviter un conflit
 * dupliqué dans la même instruction. Timestamp calculé côté JS (portable).
 */
async function saveStations(stations) {
  const unique = [...new Map(stations.map((s) => [s.station_id, s])).values()];
  if (unique.length === 0) return;

  const now = Math.floor(Date.now() / 1000);
  const row = '(?, ?, ?, ?, ?, ?, ?)';
  const values = unique.map(() => row).join(', ');
  const params = unique.flatMap((s) => [
    s.station_id, s.name, s.address?.trim() ?? '', s.lat, s.lon, s.capacity ?? 0, now,
  ]);

  await dbc.run(
    `INSERT INTO stations (station_id, name, address, lat, lon, capacity, fetched_at)
     VALUES ${values}
     ON CONFLICT(station_id) DO UPDATE SET
       name       = excluded.name,
       address    = excluded.address,
       lat        = excluded.lat,
       lon        = excluded.lon,
       capacity   = excluded.capacity,
       fetched_at = excluded.fetched_at`,
    params
  );
  console.log(`[db] ${unique.length} stations enregistrées`);
}

/**
 * Synchronise le référentiel : upsert de `stations` puis suppression de celles
 * absentes du flux. Garde-fou : si le flux renvoie moins de la moitié des stations
 * connues (flux partiel / incident), on n'en supprime aucune.
 * Renvoie { count, removed }.
 */
async function replaceStations(stations) {
  await saveStations(stations);
  const ids = [...new Set(stations.map((s) => s.station_id))];
  const known = await countStations();
  if (ids.length === 0 || ids.length < known / 2) return { count: ids.length, removed: 0 };
  const { changes } = await dbc.run(
    `DELETE FROM stations WHERE station_id NOT IN (${ids.map(() => '?').join(', ')})`,
    ids
  );
  if (changes) console.log(`[db] ${changes} station(s) retirée(s) du référentiel`);
  return { count: ids.length, removed: changes };
}

// ── Rental apps (deep links officiels, sync GBFS quotidienne) ────────────────

/**
 * Upsert d'une application de location (1 ligne par plateforme).
 * `updated_at` calculé côté JS (portable SQLite/Postgres).
 */
async function upsertRentalApp({ platform, name, discovery_uri, store_uri }) {
  const now = Math.floor(Date.now() / 1000);
  await dbc.run(
    `INSERT INTO rental_apps (platform, name, discovery_uri, store_uri, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(platform) DO UPDATE SET
       name          = excluded.name,
       discovery_uri = excluded.discovery_uri,
       store_uri     = excluded.store_uri,
       updated_at    = excluded.updated_at`,
    [platform, name, discovery_uri ?? null, store_uri ?? null, now]
  );
}

async function getRentalApps() {
  const { rows } = await dbc.query('SELECT * FROM rental_apps ORDER BY platform');
  return rows;
}

/** { ios: {...}, android: {...} } — pratique pour enrichir les notifications. */
async function getRentalAppsMap() {
  const rows = await getRentalApps();
  return Object.fromEntries(rows.map((r) => [r.platform, r]));
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

/** Avec le hash du mot de passe : réservé aux vérifications d'identité. */
async function getUserAuthById(id) {
  return dbc.get('SELECT id, username, password_hash FROM users WHERE id = ?', [id]);
}

async function updatePasswordHash(id, hash) {
  await dbc.run('UPDATE users SET password_hash = ? WHERE id = ?', [hash, id]);
}

/**
 * Supprime le compte et toutes ses données (droit à l'effacement, RGPD).
 * Suppression explicite des tables liées : les clés étrangères SQLite de dev
 * n'ont pas d'ON DELETE CASCADE.
 */
async function deleteUser(id) {
  for (const table of ['alerts', 'favorites', 'push_subscriptions']) {
    await dbc.run(`DELETE FROM ${table} WHERE user_id = ?`, [id]);
  }
  const { changes } = await dbc.run('DELETE FROM users WHERE id = ?', [id]);
  return changes > 0;
}

async function getUserById(id) {
  return dbc.get('SELECT id, username, created_at FROM users WHERE id = ?', [id]);
}

// ── Favorites ────────────────────────────────────────────────────────────────

/**
 * Favoris dans l'ordre choisi par l'utilisateur (sort_order), puis alphabétique
 * pour ceux jamais ordonnés. `label` : nom personnalisé facultatif.
 */
async function getFavorites(userId) {
  const { rows } = await dbc.query(
    `SELECT station_id, station_name, label, sort_order FROM favorites WHERE user_id = ?
     ORDER BY CASE WHEN sort_order IS NULL THEN 1 ELSE 0 END, sort_order, LOWER(station_name)`,
    [userId]
  );
  return rows;
}

/**
 * Ajoute un favori. Tant que l'utilisateur n'a jamais ordonné ses favoris, tous
 * restent sans position (ordre alphabétique) ; ensuite, un nouveau favori va en
 * fin de liste. Un favori existant garde son nom personnalisé et sa place.
 */
async function addFavorite(userId, stationId, stationName) {
  const row = await dbc.get('SELECT MAX(sort_order) AS m FROM favorites WHERE user_id = ?', [userId]);
  const next = row?.m == null ? null : Number(row.m) + 1;
  await dbc.run(
    `INSERT INTO favorites (user_id, station_id, station_name, sort_order) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, station_id) DO UPDATE SET station_name = excluded.station_name`,
    [userId, stationId, stationName, next]
  );
}

async function removeFavorite(userId, stationId) {
  await dbc.run('DELETE FROM favorites WHERE user_id = ? AND station_id = ?', [userId, stationId]);
}

/** Renomme un favori (`label` null = nom de la station). Renvoie false si absent. */
async function setFavoriteLabel(userId, stationId, label) {
  const { changes } = await dbc.run(
    'UPDATE favorites SET label = ? WHERE user_id = ? AND station_id = ?',
    [label, userId, stationId]
  );
  return changes > 0;
}

/**
 * Enregistre l'ordre : `stationIds[i]` prend la position i. Les favoris absents de
 * la liste passent après, dans leur ordre actuel ; les identifiants inconnus sont ignorés.
 */
async function reorderFavorites(userId, stationIds) {
  const current = (await getFavorites(userId)).map((f) => f.station_id);
  const known = new Set(current);
  const wanted = [...new Set(stationIds)].filter((id) => known.has(id));
  const order = [...wanted, ...current.filter((id) => !wanted.includes(id))];
  for (let i = 0; i < order.length; i++) {
    await dbc.run('UPDATE favorites SET sort_order = ? WHERE user_id = ? AND station_id = ?', [i, userId, order[i]]);
  }
}

// ── Push subscriptions ───────────────────────────────────────────────────────

/**
 * Enregistre (ou réattribue) la subscription d'un appareil. L'endpoint est unique :
 * si l'appareil était lié à un autre compte, il passe au compte courant, ce qui
 * évite qu'un téléphone partagé reçoive les alertes de plusieurs utilisateurs.
 */
async function addSubscription(userId, subscription) {
  const { id } = await dbc.run(
    `INSERT INTO push_subscriptions (user_id, endpoint, subscription) VALUES (?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, subscription = excluded.subscription`,
    [userId, subscription.endpoint, JSON.stringify(subscription)]
  );
  return id;
}

/** Détache un appareil du compte (déconnexion). Renvoie true si une ligne a été supprimée. */
async function removeSubscriptionByEndpoint(userId, endpoint) {
  const { changes } = await dbc.run(
    'DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?',
    [userId, endpoint]
  );
  return changes > 0;
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

/** Alertes de l'utilisateur ; si `today` est fourni, masque les ponctuelles expirées. */
async function getAlerts(userId, today = null) {
  const { rows } = await dbc.query(
    `SELECT * FROM alerts WHERE user_id = ? AND (valid_on IS NULL OR valid_on >= ?)
     ORDER BY created_at DESC, id DESC`,
    [userId, today ?? '0000-00-00']
  );
  return rows;
}

async function getAlert(userId, id) {
  return dbc.get('SELECT * FROM alerts WHERE id = ? AND user_id = ?', [id, userId]);
}

// Champs d'alerte modifiables par l'utilisateur (whitelist SQL).
const ALERT_FIELDS = [
  'station_id', 'station_name', 'bike_type', 'target', 'comparison', 'threshold',
  'arrival_station_id', 'arrival_station_name', 'arrival_threshold', 'valid_on',
  'time_start', 'time_end', 'days', 'active',
];

async function createAlert(userId, a) {
  const row = {
    bike_type: 'any', target: 'bikes', comparison: 'at_most', threshold: 1,
    arrival_station_id: null, arrival_station_name: null, arrival_threshold: null,
    valid_on: null, days: '1,2,3,4,5,6,7', active: 1,
    ...a,
  };
  row.active = row.active ? 1 : 0;
  const cols = ALERT_FIELDS.filter((k) => row[k] !== undefined);
  const { id } = await dbc.run(
    `INSERT INTO alerts (user_id, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`,
    [userId, ...cols.map((k) => row[k])]
  );
  return getAlert(userId, id);
}

/**
 * Met à jour les champs fournis d'une alerte de l'utilisateur.
 * Toute modification réarme l'anti-spam (last_notified_*) : une alerte éditée
 * (nouveau seuil, nouvel horaire…) doit pouvoir notifier à nouveau le jour même.
 * Retourne l'alerte mise à jour, ou null si introuvable / non possédée.
 */
async function updateAlert(userId, id, fields) {
  const current = await getAlert(userId, id);
  if (!current) return null;

  const keys = Object.keys(fields).filter((k) => ALERT_FIELDS.includes(k));
  if (keys.length === 0) return current;

  const setClause = [...keys.map((k) => `${k} = ?`), 'last_notified_date = NULL', 'last_notified_key = NULL'].join(', ');
  const params = keys.map((k) => (k === 'active' ? (fields[k] ? 1 : 0) : fields[k]));
  params.push(id, userId);

  await dbc.run(`UPDATE alerts SET ${setClause} WHERE id = ? AND user_id = ?`, params);
  return getAlert(userId, id);
}

async function deleteAlert(userId, id) {
  const { changes } = await dbc.run('DELETE FROM alerts WHERE id = ? AND user_id = ?', [id, userId]);
  return changes > 0;
}

/** Première notification du jour : mémorise la date et l'état notifié. */
async function markAlertNotified(id, date, key) {
  await dbc.run('UPDATE alerts SET last_notified_date = ?, last_notified_key = ? WHERE id = ?', [date, key, id]);
}

/** Met à jour l'état notifié (null = réarmée : la prochaine atteinte du seuil re-notifie). */
async function setAlertNotifiedKey(id, key) {
  await dbc.run('UPDATE alerts SET last_notified_key = ? WHERE id = ?', [key, id]);
}

async function countActiveAlerts() {
  const row = await dbc.get('SELECT COUNT(*) AS n FROM alerts WHERE active = 1');
  return Number(row?.n ?? 0);
}

/**
 * Alertes actives à évaluer le jour `today` (YYYY-MM-DD, fuseau des alertes) :
 * exclut les comptes en pause (alerts_paused_until >= today) et les alertes
 * ponctuelles d'un autre jour.
 */
async function getActiveAlerts(today) {
  const { rows } = await dbc.query(
    `SELECT a.* FROM alerts a JOIN users u ON u.id = a.user_id
     WHERE a.active = 1
       AND (u.alerts_paused_until IS NULL OR u.alerts_paused_until < ?)
       AND (a.valid_on IS NULL OR a.valid_on = ?)`,
    [today, today]
  );
  return rows;
}

/** Supprime les alertes ponctuelles dont le jour est passé. Renvoie le nombre supprimé. */
async function deleteExpiredAlerts(today) {
  const { changes } = await dbc.run('DELETE FROM alerts WHERE valid_on IS NOT NULL AND valid_on < ?', [today]);
  return changes;
}

// ── Pause globale des alertes ────────────────────────────────────────────────

async function getAlertsPause(userId) {
  const row = await dbc.get('SELECT alerts_paused_until FROM users WHERE id = ?', [userId]);
  return row?.alerts_paused_until ?? null;
}

/** `until` : YYYY-MM-DD (inclus) ou null pour reprendre. */
async function setAlertsPause(userId, until) {
  await dbc.run('UPDATE users SET alerts_paused_until = ? WHERE id = ?', [until, userId]);
}

module.exports = {
  initialize,
  // stations
  countStations, getStations, saveStations, replaceStations,
  // rental apps
  upsertRentalApp, getRentalApps, getRentalAppsMap,
  // config
  getConfig, setConfig,
  // users
  createUser, getUserByUsername, getUserById, getUserAuthById, updatePasswordHash, deleteUser,
  // favorites
  getFavorites, addFavorite, removeFavorite, setFavoriteLabel, reorderFavorites,
  // push
  addSubscription, removeSubscriptionByEndpoint, getSubscriptionsByUser, removeSubscriptionById,
  // alerts
  getAlerts, getAlert, createAlert, updateAlert, deleteAlert,
  markAlertNotified, setAlertNotifiedKey, countActiveAlerts, getActiveAlerts, deleteExpiredAlerts,
  getAlertsPause, setAlertsPause,
};
