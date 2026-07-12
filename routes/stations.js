// Routes stations : référentiel en cache + disponibilité live fusionnée à la volée.
const express = require('express');
const { countStations, getStations, saveStations } = require('../db');
const { fetchStationInfo, getStationStatus } = require('../gbfs');

const router = express.Router();

function extractCount(vehicleTypes, typeId) {
  return vehicleTypes?.find((v) => v.vehicle_type_id === typeId)?.count ?? 0;
}

/** Fusionne l'info statique (base) avec le statut live GBFS (jamais mis en base). */
function mergeWithStatus(stations, statusList) {
  const statusMap = Object.fromEntries(statusList.map((s) => [s.station_id, s]));

  return stations.map((s) => {
    const live = statusMap[s.station_id] ?? {};
    const vta  = live.vehicle_types_available ?? [];
    return {
      station_id:      s.station_id,
      name:            s.name,
      address:         s.address,
      lat:             s.lat,
      lon:             s.lon,
      capacity:        s.capacity,
      // Vélos — toujours depuis l'API live
      mechanical:      extractCount(vta, 'mechanical'),
      electrical:      extractCount(vta, 'electrical'),
      total_bikes:     live.num_bikes_available    ?? 0,
      docks_available: live.num_docks_available    ?? 0,
      bikes_disabled:  live.num_bikes_disabled     ?? 0,
      is_renting:      live.is_renting             ?? false,
      is_returning:    live.is_returning            ?? false,
      last_reported:   live.last_reported           ?? null,
    };
  });
}

/**
 * GET /api/stations
 * Infos stations depuis la base (fetch auto si vide).
 * Disponibilité vélos toujours récupérée en direct depuis l'API GBFS (cache court).
 */
router.get('/api/stations', async (req, res) => {
  try {
    // Auto-populate au premier appel
    if (await countStations() === 0) {
      console.log('[GET /api/stations] base vide — fetch initial...');
      const info = await fetchStationInfo();
      await saveStations(info);
    }

    const [stations, statusList] = await Promise.all([
      getStations(),
      getStationStatus(),
    ]);

    const merged = mergeWithStatus(stations, statusList);

    res.json({
      ok:             true,
      count:          merged.length,
      stations_cache: true,
      status_live:    true,
      fetched_at:     new Date().toISOString(),
      stations:       merged,
    });
  } catch (err) {
    console.error('[GET /api/stations]', err.message);
    res.status(502).json({ ok: false, error: 'Service temporairement indisponible' });
  }
});

/**
 * POST /api/stations/refresh
 * Force le rechargement des infos stations depuis l'API GBFS.
 */
router.post('/api/stations/refresh', async (req, res) => {
  try {
    const info = await fetchStationInfo();
    await saveStations(info);
    res.json({
      ok:      true,
      message: `${info.length} stations rechargées depuis l'API`,
      count:   info.length,
    });
  } catch (err) {
    console.error('[POST /api/stations/refresh]', err.message);
    res.status(502).json({ ok: false, error: 'Service temporairement indisponible' });
  }
});

module.exports = router;
