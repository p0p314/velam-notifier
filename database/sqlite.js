// Adaptateur SQLite (développement). Seul fichier autorisé à appeler
// better-sqlite3 directement. Expose une interface async unifiée.
const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');
const { runMigrations } = require('./migrations');

function createSQLiteDb() {
  const DATA_DIR = path.join(process.cwd(), 'data');
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const sdb = new Database(path.join(DATA_DIR, 'velam.db'));
  sdb.pragma('journal_mode = WAL');
  sdb.pragma('foreign_keys = ON');

  const api = {
    dialect: 'sqlite',
    async query(sql, params = []) {
      return { rows: sdb.prepare(sql).all(...params) };
    },
    async run(sql, params = []) {
      const r = sdb.prepare(sql).run(...params);
      return { id: r.lastInsertRowid, changes: r.changes };
    },
    async get(sql, params = []) {
      return sdb.prepare(sql).get(...params) ?? null;
    },
    async initialize() {
      await runMigrations(api);
      console.log('[db] SQLite prête → data/velam.db');
    },
  };
  return api;
}

module.exports = { createSQLiteDb };
