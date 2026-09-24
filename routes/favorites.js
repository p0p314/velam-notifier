// Routes favoris (protégées par JWT). Renvoient toujours la liste à jour.
const express = require('express');
const { getFavorites, addFavorite, removeFavorite, setFavoriteLabel, reorderFavorites } = require('../db');
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

const LABEL_MAX = 40;

/**
 * PUT /api/favorites/order — { station_ids: [...] } dans l'ordre voulu.
 * Déclarée avant `/:station_id`.
 */
router.put('/api/favorites/order', requireAuth, async (req, res) => {
  try {
    const ids = req.body?.station_ids;
    if (!Array.isArray(ids) || ids.length > 500 || !ids.every((id) => typeof id === 'string' && id.length <= 64)) {
      return res.status(400).json({ ok: false, error: 'station_ids : tableau d\'identifiants requis' });
    }
    await reorderFavorites(req.user.id, ids);
    res.json({ ok: true, favorites: await getFavorites(req.user.id) });
  } catch (err) {
    console.error('[PUT /api/favorites/order]', err.message);
    res.status(500).json({ ok: false, error: 'Erreur serveur' });
  }
});

/** PATCH /api/favorites/:station_id — { label } (vide ou null = nom de la station). */
router.patch('/api/favorites/:station_id', requireAuth, async (req, res) => {
  try {
    const raw = req.body?.label;
    if (raw !== null && raw !== undefined && typeof raw !== 'string') {
      return res.status(400).json({ ok: false, error: 'label : texte attendu' });
    }
    const label = (raw ?? '').trim();
    if (label.length > LABEL_MAX) {
      return res.status(400).json({ ok: false, error: `label : ${LABEL_MAX} caractères maximum` });
    }
    const found = await setFavoriteLabel(req.user.id, req.params.station_id, label || null);
    if (!found) return res.status(404).json({ ok: false, error: 'Favori introuvable' });
    res.json({ ok: true, favorites: await getFavorites(req.user.id) });
  } catch (err) {
    console.error('[PATCH /api/favorites]', err.message);
    res.status(500).json({ ok: false, error: 'Erreur serveur' });
  }
});

module.exports = router;
