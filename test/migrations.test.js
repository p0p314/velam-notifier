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
