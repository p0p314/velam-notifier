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
 *  - pause globale des alertes par utilisateur (`users.alerts_paused_until`) ;
 *  - favoris nommés et ordonnés (`favorites.label`, `favorites.sort_order`).
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
  // Favoris : nom personnalisé (« Maison ») et ordre choisi par l'utilisateur.
  await addColumn(db, 'favorites', 'label', 'TEXT DEFAULT NULL');
  await addColumn(db, 'favorites', 'sort_order', 'INTEGER DEFAULT NULL');

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

/**
 * v1.3 — alertes de groupe et résumés à heure fixe.
 * `group_stations` : JSON [{ station_id, station_name }] (lu avec l'alerte, jamais
 * filtré en SQL) ; `group_name` : nom libre (« Maison ») ; `kind` : `threshold`
 * (alerte de disponibilité) ou `summary` (résumé envoyé à `time_start`).
 */
async function migrateAlertGroups(db) {
  await addColumn(db, 'alerts', 'kind', "TEXT NOT NULL DEFAULT 'threshold'");
  await addColumn(db, 'alerts', 'group_name', 'TEXT DEFAULT NULL');
  await addColumn(db, 'alerts', 'group_stations', 'TEXT DEFAULT NULL');
}

/**
 * v1.4 — révocation des sessions : chaque jeton porte la `token_version` de son
 * compte ; l'incrémenter invalide d'un coup tous les jetons émis (déconnexion
 * des autres appareils, changement de mot de passe).
 */
async function migrateSessions(db) {
  await addColumn(db, 'users', 'token_version', 'INTEGER NOT NULL DEFAULT 0');
  // Appareil (session) auquel la subscription push est rattachée : déconnecter un
  // appareil coupe aussi ses notifications.
  await addColumn(db, 'push_subscriptions', 'session_id', 'TEXT DEFAULT NULL');
}

/**
 * v1.5 — résumés à plusieurs heures et tutoriel.
 * `alerts.send_times` : heures d'envoi d'un résumé, CSV trié (« 07:45,18:00 ») ; NULL =
 * résumé d'avant la v1.5, envoyé à `time_start` seul. `users.tutorial_done` : tutoriel
 * de présentation vu (ou arrêté) — montré une fois par compte, pas par appareil.
 */
async function migrateV15(db) {
  await addColumn(db, 'alerts', 'send_times', 'TEXT DEFAULT NULL');
  await addColumn(db, 'users', 'tutorial_done', 'INTEGER NOT NULL DEFAULT 0');
}

/**
 * v1.6 — module Trains. Uniquement les données des utilisateurs : le référentiel
 * GTFS (gares, lignes, horaires) n'est jamais copié en base (index mémoire + cache disque).
 *  - train_favorites : un trajet précis (gares + heure + numéro de train + ligne), identifié
 *    de façon stable car les trip_id GTFS changent d'une version du dataset à l'autre ;
 *  - train_alerts : `scope` = `trip` (un favori : retard ≥ seuil, suppression, perturbation)
 *    ou `line` (toute la ligne : perturbations, suppressions — avec créneau horaire) ;
 *  - train_notifications : journal d'idempotence, une ligne par événement notifié
 *    (unique par alerte + clé d'événement) ⇒ jamais deux notifications pour le même événement.
 */
async function migrateTrains(db) {
  // v1.7 — types d'alertes notifiés, par compte (Paramètres › Notifications) :
  // couper les alertes vélos ou trains sans toucher aux appareils ni aux alertes.
  await addColumn(db, 'users', 'notify_bikes', 'INTEGER NOT NULL DEFAULT 1');
  await addColumn(db, 'users', 'notify_trains', 'INTEGER NOT NULL DEFAULT 1');
  // v1.9 — fonctionnalités utilisées par le compte (Paramètres › Préférences) : vélos et / ou
  // trains, au moins l'une des deux. Une fonctionnalité désactivée disparaît de l'interface
  // et ses alertes ne sont plus envoyées (elles sont conservées).
  await addColumn(db, 'users', 'use_bikes', 'INTEGER NOT NULL DEFAULT 1');
  await addColumn(db, 'users', 'use_trains', 'INTEGER NOT NULL DEFAULT 1');
  // v1.11 — plusieurs villes de vélos (cities.js) : ville choisie par le compte, ville de
  // chaque station du référentiel (les données d'avant sont celles d'Amiens).
  await addColumn(db, 'users', 'bike_city', "TEXT NOT NULL DEFAULT 'amiens'");
  await addColumn(db, 'stations', 'city', "TEXT NOT NULL DEFAULT 'amiens'");
  const pg = db.dialect === 'postgres';
  const id = pg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
  const created = pg ? 'TIMESTAMPTZ DEFAULT NOW()' : 'DATETIME DEFAULT CURRENT_TIMESTAMP';
  const big = pg ? 'BIGINT' : 'INTEGER';
  await db.run(`CREATE TABLE IF NOT EXISTS train_favorites (
    id               ${id},
    user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider         TEXT NOT NULL DEFAULT 'sncf',
    train_number     TEXT NOT NULL DEFAULT '',
    line_id          TEXT DEFAULT NULL,
    line_name        TEXT NOT NULL DEFAULT '',
    line_long_name   TEXT NOT NULL DEFAULT '',
    origin_id        TEXT NOT NULL,
    origin_name      TEXT NOT NULL,
    destination_id   TEXT NOT NULL,
    destination_name TEXT NOT NULL,
    departure_time   TEXT NOT NULL,
    arrival_time     TEXT DEFAULT NULL,
    trip_id          TEXT DEFAULT NULL,
    label            TEXT DEFAULT NULL,
    created_at       ${created},
    UNIQUE(user_id, provider, origin_id, destination_id, departure_time, train_number)
  )`);
  await db.run('CREATE INDEX IF NOT EXISTS train_favorites_user_idx ON train_favorites (user_id)');
  await db.run(`CREATE TABLE IF NOT EXISTS train_alerts (
    id               ${id},
    user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scope            TEXT NOT NULL CHECK(scope IN ('trip', 'line')),
    favorite_id      INTEGER DEFAULT NULL REFERENCES train_favorites(id) ON DELETE CASCADE,
    provider         TEXT NOT NULL DEFAULT 'sncf',
    line_id          TEXT DEFAULT NULL,
    line_name        TEXT NOT NULL DEFAULT '',
    line_long_name   TEXT NOT NULL DEFAULT '',
    delay_threshold  INTEGER DEFAULT NULL,
    on_cancel        INTEGER NOT NULL DEFAULT 1,
    on_disruption    INTEGER NOT NULL DEFAULT 0,
    days             TEXT NOT NULL DEFAULT '1,2,3,4,5,6,7',
    time_start       TEXT DEFAULT NULL,
    time_end         TEXT DEFAULT NULL,
    active           INTEGER NOT NULL DEFAULT 1,
    created_at       ${created},
    UNIQUE(favorite_id),
    UNIQUE(user_id, line_id)
  )`);
  await db.run('CREATE INDEX IF NOT EXISTS train_alerts_user_idx ON train_alerts (user_id)');
  // v1.13 — voie de départ notifiée (annonce puis changements, flux SIRI) : activée par défaut.
  await addColumn(db, 'train_alerts', 'on_platform', 'INTEGER NOT NULL DEFAULT 1');
  await db.run(`CREATE TABLE IF NOT EXISTS train_notifications (
    id         ${id},
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    alert_id   INTEGER NOT NULL REFERENCES train_alerts(id) ON DELETE CASCADE,
    event_key  TEXT NOT NULL,
    type       TEXT NOT NULL,
    sent_at    ${big} NOT NULL,
    UNIQUE(alert_id, event_key)
  )`);
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
      token_version INTEGER NOT NULL DEFAULT 0,
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
      kind               TEXT NOT NULL DEFAULT 'threshold',
      group_name         TEXT DEFAULT NULL,
      group_stations     TEXT DEFAULT NULL,
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
    await migrateAlertGroups(db);
    // v1.4 — une ligne par appareil connecté (liste « Appareils connectés »).
    // Horodatages en millisecondes epoch.
    await db.run(`CREATE TABLE IF NOT EXISTS sessions (
      id           TEXT PRIMARY KEY,
      user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_agent   TEXT DEFAULT NULL,
      created_at   BIGINT NOT NULL,
      last_seen_at BIGINT NOT NULL
    )`);
    await db.run('CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id)');
    await migrateSessions(db);
    await migrateV15(db);
    await db.run(`CREATE TABLE IF NOT EXISTS rental_apps (
      platform      TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      discovery_uri TEXT,
      store_uri     TEXT,
      updated_at    BIGINT NOT NULL DEFAULT 0
    )`);
    await migrateTrains(db);
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
    token_version INTEGER NOT NULL DEFAULT 0,
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
    kind         TEXT NOT NULL DEFAULT 'threshold',
    group_name   TEXT DEFAULT NULL,
    group_stations TEXT DEFAULT NULL,
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
  await migrateAlertGroups(db);
  await db.run(`CREATE TABLE IF NOT EXISTS sessions (
    id           TEXT PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users(id),
    user_agent   TEXT DEFAULT NULL,
    created_at   INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
  )`);
  await db.run('CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id)');
  await migrateSessions(db);
  await migrateV15(db);
  await migrateTrains(db);

  console.log('[db] migrations SQLite appliquées');
}

module.exports = { runMigrations, columnsOf };
