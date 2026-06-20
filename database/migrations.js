// Schéma unifié. SQLite en dev (syntaxe d'origine conservée + migrations
// incrémentales), PostgreSQL en prod (SERIAL / TIMESTAMPTZ).
// Le choix du dialecte suit la présence de DATABASE_URL.

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
      min_count          INTEGER NOT NULL DEFAULT 1,
      time_start         TEXT NOT NULL,
      time_end           TEXT NOT NULL,
      days               TEXT NOT NULL DEFAULT '1,2,3,4,5,6,7',
      active             INTEGER NOT NULL DEFAULT 1,
      last_notified_date TEXT DEFAULT NULL,
      created_at         TIMESTAMPTZ DEFAULT NOW()
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
    min_count    INTEGER NOT NULL DEFAULT 1,
    time_start   TEXT NOT NULL,
    time_end     TEXT NOT NULL,
    active       INTEGER NOT NULL DEFAULT 1,
    days         TEXT NOT NULL DEFAULT '1,2,3,4,5,6,7',
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Migrations incrémentales SQLite (préservent les bases de dev existantes).
  const { rows: cols } = await db.query('PRAGMA table_info(alerts)');
  const hasColumn = (name) => cols.some((c) => c.name === name);

  if (!hasColumn('last_notified_date')) {
    await db.run('ALTER TABLE alerts ADD COLUMN last_notified_date TEXT DEFAULT NULL');
    console.log('[db] colonne alerts.last_notified_date ajoutée');
  }
  if (!hasColumn('days')) {
    await db.run("ALTER TABLE alerts ADD COLUMN days TEXT NOT NULL DEFAULT '1,2,3,4,5,6,7'");
    console.log('[db] colonne alerts.days ajoutée');
  }
  if (hasColumn('notified')) {
    const { rows } = await db.query('SELECT sqlite_version() AS v');
    const [maj, min] = String(rows[0].v).split('.').map(Number);
    if (maj > 3 || (maj === 3 && min >= 35)) {
      try {
        await db.run('ALTER TABLE alerts DROP COLUMN notified');
        console.log('[db] colonne alerts.notified supprimée');
      } catch (err) {
        console.warn('[db] suppression de alerts.notified ignorée :', err.message);
      }
    } else {
      console.warn('[db] DROP COLUMN non supporté (SQLite < 3.35) — alerts.notified conservée');
    }
  }

  console.log('[db] migrations SQLite appliquées');
}

module.exports = { runMigrations };
