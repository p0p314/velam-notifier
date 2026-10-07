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
  return dbc.get('SELECT id, username, password_hash, token_version, tutorial_done, use_bikes, use_trains FROM users WHERE id = ?', [id]);
}

/** Version de session du compte (null si le compte n'existe plus). */
async function getTokenVersion(id) {
  const row = await dbc.get('SELECT token_version FROM users WHERE id = ?', [id]);
  return row ? Number(row.token_version ?? 0) : null;
}

// ── Sessions (un appareil connecté = une ligne) ─────────────────────────────

const toSession = (row) => row && {
  ...row,
  created_at: Number(row.created_at),
  last_seen_at: Number(row.last_seen_at),
};

async function createSession(id, userId, userAgent, now = Date.now()) {
  await dbc.run(
    'INSERT INTO sessions (id, user_id, user_agent, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)',
    [id, userId, userAgent, now, now]
  );
}

/** Session + version de session du compte, en une lecture (vérification de chaque requête). */
async function getSessionAuth(id) {
  return dbc.get(
    `SELECT s.id, s.user_id, u.token_version FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
    [id]
  );
}

async function touchSession(id, userAgent, now = Date.now()) {
  await dbc.run('UPDATE sessions SET last_seen_at = ?, user_agent = COALESCE(?, user_agent) WHERE id = ?', [now, userAgent, id]);
}

async function listSessions(userId) {
  const { rows } = await dbc.query(
    'SELECT id, user_agent, created_at, last_seen_at FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC',
    [userId]
  );
  return rows.map(toSession);
}

/** Supprime une session du compte et détache les notifications de cet appareil. */
async function deleteSession(userId, id) {
  await dbc.run('DELETE FROM push_subscriptions WHERE user_id = ? AND session_id = ?', [userId, id]);
  const { changes } = await dbc.run('DELETE FROM sessions WHERE user_id = ? AND id = ?', [userId, id]);
  return changes > 0;
}

/** Rattache l'abonnement push de cet appareil à sa nouvelle session. */
async function setSubscriptionSession(userId, endpoint, sessionId) {
  await dbc.run('UPDATE push_subscriptions SET session_id = ? WHERE user_id = ? AND endpoint = ?', [sessionId, userId, endpoint]);
}

/** Supprime toutes les sessions du compte sauf `keepId`. */
async function deleteOtherSessions(userId, keepId = null) {
  const { changes } = keepId
    ? await dbc.run('DELETE FROM sessions WHERE user_id = ? AND id <> ?', [userId, keepId])
    : await dbc.run('DELETE FROM sessions WHERE user_id = ?', [userId]);
  return changes;
}

/** Sessions inactives depuis `before` (ms) : leur jeton a expiré, l'appareil n'est plus connecté. */
async function pruneSessions(before) {
  const { changes } = await dbc.run('DELETE FROM sessions WHERE last_seen_at < ?', [before]);
  return changes;
}

/** Invalide tous les jetons émis pour ce compte. Renvoie la nouvelle version. */
async function bumpTokenVersion(id) {
  await dbc.run('UPDATE users SET token_version = token_version + 1 WHERE id = ?', [id]);
  return getTokenVersion(id);
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
  for (const table of ['train_notifications', 'train_alerts', 'train_favorites', 'alerts', 'favorites', 'push_subscriptions', 'sessions']) {
    await dbc.run(`DELETE FROM ${table} WHERE user_id = ?`, [id]);
  }
  const { changes } = await dbc.run('DELETE FROM users WHERE id = ?', [id]);
  return changes > 0;
}

/** Tutoriel de présentation vu (ou arrêté) : il n'est plus proposé à ce compte. */
async function markTutorialDone(id) {
  await dbc.run('UPDATE users SET tutorial_done = 1 WHERE id = ?', [id]);
}

async function getUserById(id) {
  return dbc.get('SELECT id, username, token_version, tutorial_done, use_bikes, use_trains, created_at FROM users WHERE id = ?', [id]);
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
async function addSubscription(userId, subscription, sessionId = null) {
  const { id } = await dbc.run(
    `INSERT INTO push_subscriptions (user_id, endpoint, subscription, session_id) VALUES (?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, subscription = excluded.subscription,
       session_id = excluded.session_id`,
    [userId, subscription.endpoint, JSON.stringify(subscription), sessionId]
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

/**
 * Détache du compte tous les appareils sauf `keepEndpoint` (l'appareil courant,
 * facultatif) : un appareil déconnecté ne doit plus recevoir les alertes du compte.
 */
async function removeOtherSubscriptions(userId, keepEndpoint = null) {
  const { changes } = keepEndpoint
    ? await dbc.run('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint <> ?', [userId, keepEndpoint])
    : await dbc.run('DELETE FROM push_subscriptions WHERE user_id = ?', [userId]);
  return changes;
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

/**
 * Ligne SQL → alerte : `group_stations` (JSON en base) devient un tableau, ou null ;
 * `send_times` (CSV) devient un tableau d'heures pour un résumé — `[time_start]` pour
 * un résumé d'avant la v1.5 — et null pour une alerte de disponibilité.
 */
function toAlert(row) {
  if (!row) return row;
  let group = null;
  if (row.group_stations) {
    try { group = JSON.parse(row.group_stations); } catch { group = null; }
  }
  const sendTimes = row.kind !== 'summary' ? null
    : row.send_times ? row.send_times.split(',') : [row.time_start];
  return { ...row, group_stations: Array.isArray(group) && group.length ? group : null, send_times: sendTimes };
}

/** Valeur SQL d'un champ d'alerte (tableau de stations → JSON, heures → CSV, booléen → 0/1). */
function alertValue(key, value) {
  if (key === 'active') return value ? 1 : 0;
  if (key === 'group_stations') return value?.length ? JSON.stringify(value) : null;
  if (key === 'send_times') return value?.length ? value.join(',') : null;
  return value;
}

/** Alertes de l'utilisateur ; si `today` est fourni, masque les ponctuelles expirées. */
async function getAlerts(userId, today = null) {
  const { rows } = await dbc.query(
    `SELECT * FROM alerts WHERE user_id = ? AND (valid_on IS NULL OR valid_on >= ?)
     ORDER BY created_at DESC, id DESC`,
    [userId, today ?? '0000-00-00']
  );
  return rows.map(toAlert);
}

async function getAlert(userId, id) {
  return toAlert(await dbc.get('SELECT * FROM alerts WHERE id = ? AND user_id = ?', [id, userId]));
}

// Champs d'alerte modifiables par l'utilisateur (whitelist SQL).
const ALERT_FIELDS = [
  'kind', 'station_id', 'station_name', 'bike_type', 'target', 'comparison', 'threshold',
  'arrival_station_id', 'arrival_station_name', 'arrival_threshold', 'valid_on',
  'group_name', 'group_stations', 'send_times', 'time_start', 'time_end', 'days', 'active',
];

async function createAlert(userId, a) {
  const row = {
    kind: 'threshold', bike_type: 'any', target: 'bikes', comparison: 'at_most', threshold: 1,
    arrival_station_id: null, arrival_station_name: null, arrival_threshold: null,
    group_name: null, group_stations: null, send_times: null,
    valid_on: null, days: '1,2,3,4,5,6,7', active: 1,
    ...a,
  };
  const cols = ALERT_FIELDS.filter((k) => row[k] !== undefined);
  const { id } = await dbc.run(
    `INSERT INTO alerts (user_id, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`,
    [userId, ...cols.map((k) => alertValue(k, row[k]))]
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
  const params = keys.map((k) => alertValue(k, fields[k]));
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
     WHERE a.active = 1 AND u.notify_bikes = 1 AND u.use_bikes = 1
       AND (u.alerts_paused_until IS NULL OR u.alerts_paused_until < ?)
       AND (a.valid_on IS NULL OR a.valid_on = ?)`,
    [today, today]
  );
  return rows.map(toAlert);
}

/** Supprime les alertes ponctuelles dont le jour est passé. Renvoie le nombre supprimé. */
async function deleteExpiredAlerts(today) {
  const { changes } = await dbc.run('DELETE FROM alerts WHERE valid_on IS NOT NULL AND valid_on < ?', [today]);
  return changes;
}

// ── Types d'alertes notifiés (par compte) ────────────────────────────────────

async function getNotificationPrefs(userId) {
  const row = await dbc.get('SELECT notify_bikes, notify_trains FROM users WHERE id = ?', [userId]);
  return { bikes: Number(row?.notify_bikes ?? 1) === 1, trains: Number(row?.notify_trains ?? 1) === 1 };
}

/** `prefs` : { bikes?, trains? } (booléens) ; les champs absents sont inchangés. */
async function setNotificationPrefs(userId, prefs) {
  if (typeof prefs.bikes === 'boolean') await dbc.run('UPDATE users SET notify_bikes = ? WHERE id = ?', [prefs.bikes ? 1 : 0, userId]);
  if (typeof prefs.trains === 'boolean') await dbc.run('UPDATE users SET notify_trains = ? WHERE id = ?', [prefs.trains ? 1 : 0, userId]);
  return getNotificationPrefs(userId);
}

// ── Fonctionnalités utilisées (par compte) ───────────────────────────────────

/** { bikes, trains } d'une ligne `users` (colonnes absentes = activées). */
const modulesOf = (row) => ({ bikes: Number(row?.use_bikes ?? 1) === 1, trains: Number(row?.use_trains ?? 1) === 1 });

/** `modules` : { bikes, trains } complet et valide (au moins un des deux, vérifié par la route). */
async function setModules(userId, modules) {
  await dbc.run('UPDATE users SET use_bikes = ?, use_trains = ? WHERE id = ?', [modules.bikes ? 1 : 0, modules.trains ? 1 : 0, userId]);
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

// ── Trains : favoris, alertes, journal des notifications ────────────────────

const TRAIN_FAV_FIELDS = [
  'provider', 'train_number', 'line_id', 'line_name', 'line_long_name', 'origin_id', 'origin_name',
  'destination_id', 'destination_name', 'departure_time', 'arrival_time', 'trip_id',
];

/** Favoris trains, par heure de départ puis gare de départ. */
async function getTrainFavorites(userId) {
  const { rows } = await dbc.query(
    'SELECT * FROM train_favorites WHERE user_id = ? ORDER BY departure_time, LOWER(origin_name), id',
    [userId]
  );
  return rows;
}

async function getTrainFavorite(userId, id) {
  return dbc.get('SELECT * FROM train_favorites WHERE id = ? AND user_id = ?', [id, userId]);
}

async function countTrainFavorites(userId) {
  const row = await dbc.get('SELECT COUNT(*) AS n FROM train_favorites WHERE user_id = ?', [userId]);
  return Number(row?.n ?? 0);
}

/**
 * Ajoute un trajet favori. Déjà présent (mêmes gares, heure et numéro) : mise à jour
 * des noms et du dernier trip_id connu, sans doublon. Renvoie la ligne.
 */
async function addTrainFavorite(userId, fav) {
  const cols = TRAIN_FAV_FIELDS.filter((k) => fav[k] !== undefined);
  await dbc.run(
    `INSERT INTO train_favorites (user_id, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})
     ON CONFLICT(user_id, provider, origin_id, destination_id, departure_time, train_number) DO UPDATE SET
       line_id = excluded.line_id, line_name = excluded.line_name, line_long_name = excluded.line_long_name,
       origin_name = excluded.origin_name, destination_name = excluded.destination_name,
       arrival_time = excluded.arrival_time, trip_id = excluded.trip_id`,
    [userId, ...cols.map((k) => fav[k])]
  );
  return dbc.get(
    `SELECT * FROM train_favorites WHERE user_id = ? AND provider = ? AND origin_id = ? AND destination_id = ?
     AND departure_time = ? AND train_number = ?`,
    [userId, fav.provider ?? 'sncf', fav.origin_id, fav.destination_id, fav.departure_time, fav.train_number ?? '']
  );
}

async function setTrainFavoriteLabel(userId, id, label) {
  const { changes } = await dbc.run('UPDATE train_favorites SET label = ? WHERE id = ? AND user_id = ?', [label, id, userId]);
  return changes > 0;
}

/** Retire un favori et son alerte (suppression explicite : pas de cascade en SQLite de dev sans FK). */
async function removeTrainFavorite(userId, id) {
  const alerts = await dbc.query('SELECT id FROM train_alerts WHERE favorite_id = ? AND user_id = ?', [id, userId]);
  for (const a of alerts.rows) await deleteTrainAlert(userId, a.id);
  const { changes } = await dbc.run('DELETE FROM train_favorites WHERE id = ? AND user_id = ?', [id, userId]);
  return changes > 0;
}

const TRAIN_ALERT_FIELDS = [
  'scope', 'favorite_id', 'provider', 'line_id', 'line_name', 'line_long_name',
  'delay_threshold', 'on_cancel', 'on_disruption', 'days', 'time_start', 'time_end', 'active',
];
const flag = (v) => (v ? 1 : 0);
const toTrainAlert = (row) => row && {
  ...row,
  on_cancel: !!Number(row.on_cancel),
  on_disruption: !!Number(row.on_disruption),
  active: !!Number(row.active),
};
const trainAlertValue = (k, v) => (['on_cancel', 'on_disruption', 'active'].includes(k) ? flag(v) : v);

async function getTrainAlerts(userId) {
  const { rows } = await dbc.query('SELECT * FROM train_alerts WHERE user_id = ? ORDER BY id', [userId]);
  return rows.map(toTrainAlert);
}

async function getTrainAlert(userId, id) {
  return toTrainAlert(await dbc.get('SELECT * FROM train_alerts WHERE id = ? AND user_id = ?', [id, userId]));
}

async function createTrainAlert(userId, a) {
  const cols = TRAIN_ALERT_FIELDS.filter((k) => a[k] !== undefined);
  const { id } = await dbc.run(
    `INSERT INTO train_alerts (user_id, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`,
    [userId, ...cols.map((k) => trainAlertValue(k, a[k]))]
  );
  return getTrainAlert(userId, id);
}

/**
 * Met à jour une alerte. Le journal des notifications est conservé : un même
 * événement (même train, même jour) n'est pas renvoyé parce que l'alerte a été modifiée.
 */
async function updateTrainAlert(userId, id, fields) {
  const keys = Object.keys(fields).filter((k) => TRAIN_ALERT_FIELDS.includes(k) && !['scope', 'favorite_id', 'provider'].includes(k));
  if (keys.length) {
    await dbc.run(
      `UPDATE train_alerts SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ? AND user_id = ?`,
      [...keys.map((k) => trainAlertValue(k, fields[k])), id, userId]
    );
  }
  return getTrainAlert(userId, id);
}

async function deleteTrainAlert(userId, id) {
  await dbc.run('DELETE FROM train_notifications WHERE alert_id = ? AND user_id = ?', [id, userId]);
  const { changes } = await dbc.run('DELETE FROM train_alerts WHERE id = ? AND user_id = ?', [id, userId]);
  return changes > 0;
}

async function countActiveTrainAlerts() {
  const row = await dbc.get('SELECT COUNT(*) AS n FROM train_alerts WHERE active = 1');
  return Number(row?.n ?? 0);
}

/**
 * Alertes trains actives à évaluer (comptes non en pause le jour `today`), avec le
 * favori associé pour les alertes de trajet (colonnes préfixées `fav_`).
 */
async function getActiveTrainAlerts(today) {
  const { rows } = await dbc.query(
    `SELECT a.*, f.train_number AS fav_train_number, f.line_id AS fav_line_id, f.line_name AS fav_line_name,
            f.origin_id AS fav_origin_id, f.origin_name AS fav_origin_name,
            f.destination_id AS fav_destination_id, f.destination_name AS fav_destination_name,
            f.departure_time AS fav_departure_time, f.label AS fav_label
     FROM train_alerts a
     JOIN users u ON u.id = a.user_id
     LEFT JOIN train_favorites f ON f.id = a.favorite_id
     WHERE a.active = 1 AND u.notify_trains = 1 AND u.use_trains = 1
       AND (u.alerts_paused_until IS NULL OR u.alerts_paused_until < ?)`,
    [today]
  );
  return rows.map(toTrainAlert);
}

/**
 * Enregistre un événement notifié. Renvoie true s'il est nouveau (la notification
 * doit partir), false s'il l'a déjà été — l'unicité (alert_id, event_key) en base
 * garantit l'idempotence même si deux cycles se chevauchaient.
 */
async function recordTrainNotification(userId, alertId, eventKey, type, now = Date.now()) {
  const { changes } = await dbc.run(
    `INSERT INTO train_notifications (user_id, alert_id, event_key, type, sent_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(alert_id, event_key) DO NOTHING`,
    [userId, alertId, eventKey, type, now]
  );
  return changes > 0;
}

/** Un événement dont la clé commence par `prefix` a-t-il déjà été notifié pour cette alerte ? */
async function hasTrainNotification(alertId, prefix) {
  const row = await dbc.get(
    'SELECT 1 AS x FROM train_notifications WHERE alert_id = ? AND event_key LIKE ? LIMIT 1',
    [alertId, `${prefix.replace(/[%_]/g, '')}%`]
  );
  return !!row;
}

async function getTrainNotifications(userId, limit = 50) {
  const { rows } = await dbc.query(
    'SELECT alert_id, event_key, type, sent_at FROM train_notifications WHERE user_id = ? ORDER BY sent_at DESC LIMIT ?',
    [userId, limit]
  );
  return rows.map((r) => ({ ...r, sent_at: Number(r.sent_at) }));
}

/** Purge du journal (les clés d'événement sont datées : au-delà, plus aucun doublon possible). */
async function purgeTrainNotifications(before) {
  const { changes } = await dbc.run('DELETE FROM train_notifications WHERE sent_at < ?', [before]);
  return changes;
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
  createUser, getUserByUsername, getUserById, getUserAuthById, updatePasswordHash, deleteUser, markTutorialDone,
  getTokenVersion, bumpTokenVersion,
  createSession, getSessionAuth, setSubscriptionSession, touchSession, listSessions, deleteSession, deleteOtherSessions, pruneSessions,
  // favorites
  getFavorites, addFavorite, removeFavorite, setFavoriteLabel, reorderFavorites,
  // push
  addSubscription, removeSubscriptionByEndpoint, removeOtherSubscriptions, getSubscriptionsByUser, removeSubscriptionById,
  // alerts
  getAlerts, getAlert, createAlert, updateAlert, deleteAlert,
  markAlertNotified, setAlertNotifiedKey, countActiveAlerts, getActiveAlerts, deleteExpiredAlerts,
  getAlertsPause, setAlertsPause, getNotificationPrefs, setNotificationPrefs, modulesOf, setModules,
  // trains
  getTrainFavorites, getTrainFavorite, countTrainFavorites, addTrainFavorite, setTrainFavoriteLabel, removeTrainFavorite,
  getTrainAlerts, getTrainAlert, createTrainAlert, updateTrainAlert, deleteTrainAlert,
  countActiveTrainAlerts, getActiveTrainAlerts, recordTrainNotification, hasTrainNotification,
  getTrainNotifications, purgeTrainNotifications,
};
