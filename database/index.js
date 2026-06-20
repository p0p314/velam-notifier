// Sélection de l'adaptateur : PostgreSQL si DATABASE_URL est défini (prod),
// SQLite sinon (dev). Le reste du code n'utilise que l'interface unifiée.
const { createSQLiteDb }   = require('./sqlite');
const { createPostgresDb } = require('./postgres');

const dbc = process.env.DATABASE_URL ? createPostgresDb() : createSQLiteDb();

module.exports = { dbc };
