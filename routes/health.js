// Sondes de santé : /health (anti-veille Render, public) + /api/health (diagnostic).
const express = require('express');
const { countStations } = require('../db');

const router = express.Router();

// Anti-sleep : sonde légère sans accès base, appelée par un ping externe.
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

router.get('/api/health', async (req, res) => {
  res.json({
    ok:              true,
    stations_in_db:  await countStations(),
    uptime_seconds:  Math.round(process.uptime()),
    node_version:    process.version,
  });
});

module.exports = router;
