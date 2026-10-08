// Routes favoris (protégées par JWT). Renvoient toujours la liste à jour.
const express = require('express');
const { getFavorites, addFavorite, removeFavorite, setFavoriteLabel, reorderFavorites } = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();

// Plafonds par compte : la base et la boucle d'alerte restent bornées quel que soit le client.
const FAVORITES_MAX = 100;
const STATION_ID_MAX = 64;
const STATION_NAME_MAX = 128;

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
    const id = typeof station_id === 'number' ? String(station_id) : station_id;
    if (typeof id !== 'string' || !id.trim() || id.length > STATION_ID_MAX
      || typeof station_name !== 'string' || !station_name.trim() || station_name.length > STATION_NAME_MAX) {
      return res.status(400).json({ ok: false, error: `station_id (≤ ${STATION_ID_MAX}) et station_name (≤ ${STATION_NAME_MAX} caractères) requis` });
    }
    const current = await getFavorites(req.user.id);
    if (current.length >= FAVORITES_MAX && !current.some((f) => f.station_id === id)) {
      return res.status(400).json({ ok: false, error: `${FAVORITES_MAX} stations favorites au maximum` });
    }
    await addFavorite(req.user.id, id, station_name.trim());
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
