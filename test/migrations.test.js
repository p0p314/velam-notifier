// Migrations : idempotence + reprise d'une ancienne table push_subscriptions sans endpoint.
const { dbc, boot } = require('./helpers');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runMigrations } = require('../database/migrations');

const isPg = !!process.env.DATABASE_URL;

// Restaure le schéma normal (avec clé étrangère) pour les exécutions suivantes.
async function restoreSchema() {
  await dbc.run('DROP TABLE IF EXISTS push_subscriptions');
  await runMigrations(dbc);
}

test('les migrations sont rejouables sans erreur', async () => {
  await boot();
  await runMigrations(dbc);
  await runMigrations(dbc);
});

test('push_subscriptions : rétro-remplissage de endpoint + dédoublonnage', async (t) => {
  await boot();
  t.after(restoreSchema);
  // Recrée la table dans son ancien format (avant la colonne endpoint).
  await dbc.run('DROP TABLE IF EXISTS push_subscriptions');
  await dbc.run(`CREATE TABLE push_subscriptions (
    id ${isPg ? 'SERIAL' : 'INTEGER'} PRIMARY KEY${isPg ? '' : ' AUTOINCREMENT'},
    user_id INTEGER NOT NULL,
    subscription TEXT NOT NULL
  )`);
  const sub = (ep) => JSON.stringify({ endpoint: `https://push.example.com/${ep}`, keys: {} });
  await dbc.run('INSERT INTO push_subscriptions (user_id, subscription) VALUES (?, ?)', [1, sub('a')]);
  await dbc.run('INSERT INTO push_subscriptions (user_id, subscription) VALUES (?, ?)', [2, sub('a')]); // même appareil
  await dbc.run('INSERT INTO push_subscriptions (user_id, subscription) VALUES (?, ?)', [1, sub('b')]);
  await dbc.run('INSERT INTO push_subscriptions (user_id, subscription) VALUES (?, ?)', [1, 'json-corrompu']);

  await runMigrations(dbc);

  const { rows } = await dbc.query('SELECT user_id, endpoint FROM push_subscriptions ORDER BY endpoint');
  assert.deepEqual(rows.map((r) => [Number(r.user_id), r.endpoint]), [
    [2, 'https://push.example.com/a'], // le plus récent gagne
    [1, 'https://push.example.com/b'],
  ]);

  // L'index unique est bien posé
  await assert.rejects(dbc.run('INSERT INTO push_subscriptions (user_id, endpoint, subscription) VALUES (?, ?, ?)',
    [1, 'https://push.example.com/b', '{}']));
});

test('alertes v1.1 : min_count → threshold, last_notified_count → last_notified_key', async (t) => {
  await boot();
  t.after(async () => {
    await dbc.run('DROP TABLE IF EXISTS alerts');
    await runMigrations(dbc);
  });
  // Table alerts au format v1.0 (avant la généralisation).
  await dbc.run('DROP TABLE IF EXISTS alerts');
  await dbc.run(`CREATE TABLE alerts (
    id ${isPg ? 'SERIAL' : 'INTEGER'} PRIMARY KEY${isPg ? '' : ' AUTOINCREMENT'},
    user_id INTEGER NOT NULL,
    station_id TEXT NOT NULL, station_name TEXT NOT NULL,
    bike_type TEXT NOT NULL, min_count INTEGER NOT NULL DEFAULT 1,
    time_start TEXT NOT NULL, time_end TEXT NOT NULL,
    days TEXT NOT NULL DEFAULT '1,2,3,4,5,6,7', active INTEGER NOT NULL DEFAULT 1,
    last_notified_date TEXT DEFAULT NULL, last_notified_count INTEGER DEFAULT NULL
  )`);
  await dbc.run(`INSERT INTO alerts (user_id, station_id, station_name, bike_type, min_count, time_start, time_end, last_notified_date, last_notified_count)
                 VALUES (1, '12', 'Gare', 'ebike', 4, '08:00', '09:00', '2025-09-24', 2)`);

  await runMigrations(dbc);
  await runMigrations(dbc); // idempotente

  const row = await dbc.get('SELECT * FROM alerts');
  assert.equal(row.threshold, 4);
  assert.equal(row.last_notified_key, '2');
  assert.equal(row.target, 'bikes');
  assert.equal(row.comparison, 'at_most');
  assert.equal(row.valid_on, null);
  assert.equal('min_count' in row, false);
  assert.equal('last_notified_count' in row, false);
});
