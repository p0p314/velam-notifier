// Point d'entrée : démarrage séquentiel (base → auth → push → polling → écoute).
// L'app Express elle-même est construite dans app.js.
const { app, ALLOWED_ORIGINS } = require('./app');
const { initialize } = require('./db');
const { initAuth } = require('./auth');
const { initPush, startPolling } = require('./push');

const PORT = process.env.PORT ?? 3001;

// ── Boot ──────────────────────────────────────────────────────────────────────

(async () => {
  await initialize();   // crée/migre les tables (SQLite dev / PostgreSQL prod)
  await initAuth();     // résout le secret JWT
  await initPush();     // configure les clés VAPID
  startPolling();

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\nVéloPulse server → port ${PORT} (0.0.0.0)`);
    console.log(`  DB : ${process.env.DATABASE_URL ? 'PostgreSQL' : 'SQLite (dev)'}`);
    console.log(`  CORS autorisé pour : ${ALLOWED_ORIGINS.join(', ')}`);
    console.log(`  GET  /health                — anti-sleep`);
    console.log(`  GET  /api/stations          — infos + statut live`);
    console.log(`  CRUD /api/favorites /api/alerts /api/push/* — protégées (JWT)\n`);
  });
})().catch((err) => {
  console.error('[boot] échec du démarrage :', err);
  process.exit(1);
});
