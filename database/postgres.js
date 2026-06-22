// Adaptateur PostgreSQL (production). Convertit les placeholders `?` (style
// SQLite) en `$1, $2 …` et ajoute RETURNING id sur les INSERT qui en ont besoin.
const { Pool } = require('pg');
const { runMigrations } = require('./migrations');

function toPg(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

function createPostgresDb() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }, // requis pour Supabase / Render
  });

  const api = {
    dialect: 'postgres',
    async query(sql, params = []) {
      const result = await pool.query(toPg(sql), params);
      return { rows: result.rows };
    },
    async run(sql, params = []) {
      let finalSql = toPg(sql);
      // Tables sans colonne `id` (PK = station_id / key) → pas de RETURNING id.
      const isInsert = /^\s*insert\s+into/i.test(finalSql);
      const noIdTable = /insert\s+into\s+(config|stations|rental_apps)\b/i.test(finalSql);
      if (isInsert && !/returning/i.test(finalSql) && !noIdTable) {
        finalSql += ' RETURNING id';
      }
      const result = await pool.query(finalSql, params);
      return { id: result.rows[0]?.id, changes: result.rowCount };
    },
    async get(sql, params = []) {
      const { rows } = await api.query(sql, params);
      return rows[0] ?? null;
    },
    async initialize() {
      await runMigrations(api);
      console.log('[db] PostgreSQL prête');
    },
  };
  return api;
}

module.exports = { createPostgresDb };
