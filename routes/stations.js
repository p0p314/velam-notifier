// Routes stations : référentiel en cache + disponibilité live fusionnée à la volée.
const express = require('express');
const { countStations, getStations, getStationCities, saveStations, replaceStations } = require('../db');
const { DEFAULT_CITY, isCity } = require('../cities');
const { fetchStationInfo, getStationStatus, isFresh } = require('../gbfs');
const { requireAuth } = require('../auth');

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

/** Ville demandée (`?city=lyon`), Amiens par défaut ; null si inconnue. */
function cityOf(req) {
  const c = req.query.city;
  if (c === undefined || c === '') return DEFAULT_CITY;
  return isCity(c) ? c : null;
}

/**
 * GET /api/stations?city=…
 * Infos stations d'UNE ville depuis la base (fetch auto si vide pour cette ville).
 * Disponibilité vélos toujours récupérée en direct depuis l'API GBFS (cache court par ville).
 * Jamais toutes les villes à la fois.
 */
router.get('/api/stations', async (req, res) => {
  const city = cityOf(req);
  if (!city) return res.status(400).json({ ok: false, error: 'Ville inconnue' });
  try {
    // Auto-populate au premier appel pour cette ville
    if (await countStations(city) === 0) {
      console.log(`[GET /api/stations] ${city} : référentiel vide — fetch initial...`);
      const info = await fetchStationInfo(city);
      await saveStations(info, city);
    }

    const [stations, status] = await Promise.all([
      getStations(city),
      getStationStatus(city),
    ]);

    const merged = mergeWithStatus(stations, status.stations);
    const now = Date.now();

    res.json({
      ok:              true,
      city,
      count:           merged.length,
      // Fraîcheur des disponibilités : date des données Vélam (last_updated du flux),
      // leur âge (calculé ici, insensible à l'horloge du client) et un verdict
      // `stale` (flux en échec ou données ≥ 5 min) qui déclenche le bandeau.
      data_updated_at: new Date(status.updatedAt).toISOString(),
      data_age_s:      Math.max(0, Math.round((now - status.updatedAt) / 1000)),
      upstream_ok:     status.upstreamOk,
      stale:           !isFresh(status, now),
      stations:        merged,
    });
  } catch (err) {
    console.error('[GET /api/stations]', err.message);
    res.status(502).json({ ok: false, error: 'Service temporairement indisponible' });
  }
});

/**
 * Recharge le référentiel depuis GBFS : ajoute/met à jour les stations et retire
 * celles qui ont disparu du flux. Utilisé par le cron quotidien et la route de refresh.
 * Sans ville : toutes les villes déjà présentes en base (au moins Amiens), une à une.
 */
async function refreshStationCatalog(city = null) {
  if (city) {
    const info = await fetchStationInfo(city);
    return replaceStations(info, city);
  }
  const cities = [...new Set([DEFAULT_CITY, ...(await getStationCities())])];
  let count = 0;
  let removed = 0;
  for (const c of cities) {
    try {
      const r = await refreshStationCatalog(c);
      count += r.count;
      removed += r.removed;
    } catch (err) {
      if (c === DEFAULT_CITY) throw err;
      console.error(`[stations] référentiel ${c} non rafraîchi :`, err.message);
    }
  }
  return { count, removed, cities };
}

/**
 * POST /api/stations/refresh
 * Force le rechargement des infos stations depuis l'API GBFS.
 * Protégée : sinon n'importe qui peut déclencher des fetchs GBFS + écritures DB en boucle.
 */
router.post('/api/stations/refresh', requireAuth, async (req, res) => {
  try {
    const city = cityOf(req);
    if (!city) return res.status(400).json({ ok: false, error: 'Ville inconnue' });
    const { count, removed } = await refreshStationCatalog(city);
    res.json({
      ok:      true,
      message: `${count} stations rechargées depuis l'API`,
      count,
      removed,
    });
  } catch (err) {
    console.error('[POST /api/stations/refresh]', err.message);
    res.status(502).json({ ok: false, error: 'Service temporairement indisponible' });
  }
});

module.exports = router;
module.exports.refreshStationCatalog = refreshStationCatalog;
module.exports.mergeWithStatus = mergeWithStatus;
