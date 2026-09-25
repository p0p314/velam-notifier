// Sondes de santé : /health (anti-veille Render, public) + /api/health (diagnostic).
const express = require('express');
const { countStations } = require('../db');
const { version } = require('../package.json');
const { getAlertLoopHealth } = require('../push');
const { getStatusHealth } = require('../gbfs');

const router = express.Router();

// Anti-sleep : sonde légère sans accès base, appelée par un ping externe.
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * Diagnostic : version, base, boucle d'alerte et flux Vélam. `status` passe à
 * « degraded » si la boucle ne tourne plus correctement ou si les disponibilités
 * ne sont pas fraîches — à surveiller par un moniteur externe.
 */
router.get('/api/health', async (req, res) => {
  try {
    const alertLoop = getAlertLoopHealth();
    const gbfs = getStatusHealth();
    const degraded = !alertLoop.healthy || (gbfs !== null && !gbfs.fresh);
    res.json({
      ok:              true,
      status:          degraded ? 'degraded' : 'ok',
      version,
      stations_in_db:  await countStations(),
      uptime_seconds:  Math.round(process.uptime()),
      node_version:    process.version,
      alert_loop:      alertLoop,
      gbfs,
    });
  } catch (err) {
    console.error('[GET /api/health]', err.message);
    res.status(500).json({ ok: false, status: 'down', error: 'Base de données inaccessible' });
  }
});

module.exports = router;
