// Schéma unifié. SQLite en dev (syntaxe d'origine conservée + migrations
// incrémentales), PostgreSQL en prod (SERIAL / TIMESTAMPTZ).
// Le choix du dialecte suit la présence de DATABASE_URL.

/**
 * push_subscriptions.endpoint : identifiant unique d'un appareil/navigateur.
 * Rétro-remplit la colonne depuis le JSON, supprime les doublons (garde le plus
 * récent) puis pose l'index unique — sans quoi un même téléphone pouvait être
 * rattaché à plusieurs comptes et recevoir les alertes de chacun.
 */
async function migratePushEndpoint(db) {
  const { rows } = await db.query('SELECT id, subscription FROM push_subscriptions WHERE endpoint IS NULL');
  for (const r of rows) {
    let endpoint = null;
    try { endpoint = JSON.parse(r.subscription).endpoint ?? null; } catch { /* JSON corrompu */ }
    if (endpoint) await db.run('UPDATE push_subscriptions SET endpoint = ? WHERE id = ?', [endpoint, r.id]);
    else          await db.run('DELETE FROM push_subscriptions WHERE id = ?', [r.id]);
  }
  await db.run(`DELETE FROM push_subscriptions WHERE id NOT IN (
    SELECT MAX(id) FROM push_subscriptions GROUP BY endpoint
  )`);
  await db.run('CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_endpoint_uq ON push_subscriptions(endpoint)');
}

/** Colonnes existantes d'une table, quel que soit le dialecte. */
async function columnsOf(db, table) {
  if (db.dialect === 'postgres') {
    const { rows } = await db.query(
      'SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ?',
      [table]
    );
    return new Set(rows.map((r) => r.column_name));
  }
  const { rows } = await db.query(`PRAGMA table_info(${table})`);
  return new Set(rows.map((r) => r.name));
}

/** Ajoute une colonne si absente (ALTER idempotent, portable SQLite / Postgres). */
async function addColumn(db, table, name, definition) {
  if ((await columnsOf(db, table)).has(name)) return false;
  await db.run(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  console.log(`[db] colonne ${table}.${name} ajoutée`);
  return true;
}

/** Supprime une colonne héritée si présente (DROP COLUMN : SQLite ≥ 3.35 / Postgres). */
async function dropColumn(db, table, name) {
  if (!(await columnsOf(db, table)).has(name)) return;
  try {
    await db.run(`ALTER TABLE ${table} DROP COLUMN ${name}`);
    console.log(`[db] colonne ${table}.${name} supprimée`);
  } catch (err) {
    console.warn(`[db] suppression de ${table}.${name} ignorée :`, err.message);
  }
}

/**
 * v1.1 — alertes généralisées :
 *  - `target` (bikes|docks), `comparison` (at_most|at_least), `threshold` (remplace
 *    min_count, dont le nom était trompeur), trajet (`arrival_*`), alerte ponctuelle
 *    (`valid_on`), anti-spam générique (`last_notified_key` remplace last_notified_count) ;
 *  - pause globale des alertes par utilisateur (`users.alerts_paused_until`).
 * Idempotente : les données des colonnes historiques sont recopiées puis celles-ci supprimées.
 */
async function migrateAlertsV11(db) {
  await addColumn(db, 'alerts', 'target', "TEXT NOT NULL DEFAULT 'bikes'");
  await addColumn(db, 'alerts', 'comparison', "TEXT NOT NULL DEFAULT 'at_most'");
  const newThreshold = await addColumn(db, 'alerts', 'threshold', 'INTEGER NOT NULL DEFAULT 1');
  await addColumn(db, 'alerts', 'arrival_station_id', 'TEXT DEFAULT NULL');
  await addColumn(db, 'alerts', 'arrival_station_name', 'TEXT DEFAULT NULL');
  await addColumn(db, 'alerts', 'arrival_threshold', 'INTEGER DEFAULT NULL');
  await addColumn(db, 'alerts', 'valid_on', 'TEXT DEFAULT NULL');
  const newKey = await addColumn(db, 'alerts', 'last_notified_key', 'TEXT DEFAULT NULL');
  await addColumn(db, 'users', 'alerts_paused_until', 'TEXT DEFAULT NULL');

  const cols = await columnsOf(db, 'alerts');
  if (cols.has('min_count')) {
    if (newThreshold) await db.run('UPDATE alerts SET threshold = min_count');
    await dropColumn(db, 'alerts', 'min_count');
  }
  if (cols.has('last_notified_count')) {
    if (newKey) {
      await db.run(`UPDATE alerts SET last_notified_key = CAST(last_notified_count AS TEXT)
                    WHERE last_notified_count IS NOT NULL`);
    }
    await dropColumn(db, 'alerts', 'last_notified_count');
  }
}

async function runMigrations(db) {
  const isPostgres = !!process.env.DATABASE_URL;

  if (isPostgres) {
    await db.run(`CREATE TABLE IF NOT EXISTS stations (
      station_id  TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      address     TEXT NOT NULL DEFAULT '',
      lat         DOUBLE PRECISION NOT NULL,
      lon         DOUBLE PRECISION NOT NULL,
      capacity    INTEGER NOT NULL DEFAULT 0,
      fetched_at  BIGINT NOT NULL DEFAULT 0
    )`);
    await db.run(`CREATE TABLE IF NOT EXISTS config (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`);
    await db.run(`CREATE TABLE IF NOT EXISTS users (
      id            SERIAL PRIMARY KEY,
      username      TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    )`);
    await db.run(`CREATE TABLE IF NOT EXISTS favorites (
      id           SERIAL PRIMARY KEY,
      user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      station_id   TEXT NOT NULL,
      station_name TEXT NOT NULL,
      UNIQUE(user_id, station_id)
    )`);
    await db.run(`CREATE TABLE IF NOT EXISTS push_subscriptions (
      id           SERIAL PRIMARY KEY,
      user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subscription TEXT NOT NULL,
      created_at   TIMESTAMPTZ DEFAULT NOW()
    )`);
    await db.run(`CREATE TABLE IF NOT EXISTS alerts (
      id                 SERIAL PRIMARY KEY,
      user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      station_id         TEXT NOT NULL,
      station_name       TEXT NOT NULL,
      bike_type          TEXT NOT NULL CHECK(bike_type IN ('mechanical', 'ebike', 'any')),
      target             TEXT NOT NULL DEFAULT 'bikes',
      comparison         TEXT NOT NULL DEFAULT 'at_most',
      threshold          INTEGER NOT NULL DEFAULT 1,
      arrival_station_id   TEXT DEFAULT NULL,
      arrival_station_name TEXT DEFAULT NULL,
      arrival_threshold    INTEGER DEFAULT NULL,
      valid_on           TEXT DEFAULT NULL,
      time_start         TEXT NOT NULL,
      time_end           TEXT NOT NULL,
      days               TEXT NOT NULL DEFAULT '1,2,3,4,5,6,7',
      active              INTEGER NOT NULL DEFAULT 1,
      last_notified_date  TEXT DEFAULT NULL,
      last_notified_key   TEXT DEFAULT NULL,
      created_at          TIMESTAMPTZ DEFAULT NOW()
    )`);
    await db.run('ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS endpoint TEXT');
    await migratePushEndpoint(db);
    await migrateAlertsV11(db);
    await db.run(`CREATE TABLE IF NOT EXISTS rental_apps (
      platform      TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      discovery_uri TEXT,
      store_uri     TEXT,
      updated_at    BIGINT NOT NULL DEFAULT 0
    )`);
    console.log('[db] migrations PostgreSQL appliquées');
    return;
  }

  // ── SQLite (dev) : schéma d'origine + migrations incrémentales ──────────────
  await db.run(`CREATE TABLE IF NOT EXISTS stations (
    station_id  TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    address     TEXT NOT NULL DEFAULT '',
    lat         REAL NOT NULL,
    lon         REAL NOT NULL,
    capacity    INTEGER NOT NULL DEFAULT 0,
    fetched_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  )`);
  await db.run(`CREATE TABLE IF NOT EXISTS config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`);
  await db.run(`CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await db.run(`CREATE TABLE IF NOT EXISTS favorites (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id),
    station_id   TEXT NOT NULL,
    station_name TEXT NOT NULL,
    UNIQUE(user_id, station_id)
  )`);
  await db.run(`CREATE TABLE IF NOT EXISTS push_subscriptions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id),
    subscription TEXT NOT NULL,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await db.run(`CREATE TABLE IF NOT EXISTS alerts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id),
    station_id   TEXT NOT NULL,
    station_name TEXT NOT NULL,
    bike_type    TEXT NOT NULL CHECK(bike_type IN ('mechanical', 'ebike', 'any')),
    target       TEXT NOT NULL DEFAULT 'bikes',
    comparison   TEXT NOT NULL DEFAULT 'at_most',
    threshold    INTEGER NOT NULL DEFAULT 1,
    arrival_station_id   TEXT DEFAULT NULL,
    arrival_station_name TEXT DEFAULT NULL,
    arrival_threshold    INTEGER DEFAULT NULL,
    valid_on     TEXT DEFAULT NULL,
    time_start   TEXT NOT NULL,
    time_end     TEXT NOT NULL,
    active       INTEGER NOT NULL DEFAULT 1,
    days         TEXT NOT NULL DEFAULT '1,2,3,4,5,6,7',
    last_notified_date TEXT DEFAULT NULL,
    last_notified_key  TEXT DEFAULT NULL,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await db.run(`CREATE TABLE IF NOT EXISTS rental_apps (
    platform      TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    discovery_uri TEXT,
    store_uri     TEXT,
    updated_at    INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  )`);

  // Migrations incrémentales SQLite (préservent les bases de dev existantes).
  await addColumn(db, 'alerts', 'last_notified_date', 'TEXT DEFAULT NULL');
  await addColumn(db, 'alerts', 'days', "TEXT NOT NULL DEFAULT '1,2,3,4,5,6,7'");
  await dropColumn(db, 'alerts', 'notified');
  await addColumn(db, 'push_subscriptions', 'endpoint', 'TEXT');
  await migratePushEndpoint(db);
  await migrateAlertsV11(db);

  console.log('[db] migrations SQLite appliquées');
}

module.exports = { runMigrations, columnsOf };
