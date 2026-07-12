// Routes favoris (protégées par JWT). Renvoient toujours la liste à jour.
const express = require('express');
const { getFavorites, addFavorite, removeFavorite } = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();

router.get('/api/favorites', requireAuth, async (req, res) => {
  try {
    res.json({ ok: true, favorites: await getFavorites(req.user.id) });
  } catch (err) {
    console.error('[GET /api/favorites]', err.message);
    res.status(500).json({ ok: false, error: 'Erreur serveur' });
  }
});

router.post('/api/favorites', requireAuth, async (req, res) => {
  try {
    const { station_id, station_name } = req.body ?? {};
    if (!station_id || !station_name) {
      return res.status(400).json({ ok: false, error: 'station_id et station_name requis' });
    }
    await addFavorite(req.user.id, String(station_id), String(station_name));
    res.status(201).json({ ok: true, favorites: await getFavorites(req.user.id) });
  } catch (err) {
    console.error('[POST /api/favorites]', err.message);
    res.status(500).json({ ok: false, error: 'Erreur serveur' });
  }
});

router.delete('/api/favorites/:station_id', requireAuth, async (req, res) => {
  try {
    await removeFavorite(req.user.id, req.params.station_id);
    res.json({ ok: true, favorites: await getFavorites(req.user.id) });
  } catch (err) {
    console.error('[DELETE /api/favorites]', err.message);
    res.status(500).json({ ok: false, error: 'Erreur serveur' });
  }
});

module.exports = router;
