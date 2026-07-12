// Routes alertes de disponibilité (protégées par JWT) + validation des payloads.
const express = require('express');
const { getAlerts, createAlert, updateAlert, deleteAlert } = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();

const HHMM      = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAYS_ALL  = '1,2,3,4,5,6,7';
const DAYS_RE   = /^[1-7](,[1-7])*$/;
const BIKE_TYPES = ['mechanical', 'ebike', 'any'];

/**
 * Valide et normalise un payload d'alerte.
 *
 * ⚠️ `min_count` est un **plafond**, pas un plancher : l'alerte se déclenche quand
 * la disponibilité tombe « à au plus N vélos » (cf. push.js → `count <= min_count`).
 * Le nom historique est conservé pour ne pas casser l'API/DB ; la sémantique est
 * bien un maximum (le libellé UI dit « Notifier si au plus X vélos »).
 *
 * Mode `partial` (PATCH) : seuls les champs fournis sont validés ; un champ présent
 * mais invalide est une erreur. Mode complet (POST) : un champ optionnel absent
 * prend sa valeur par défaut au lieu de générer une erreur.
 */
function validateAlertPayload(body, { partial = false } = {}) {
  const fields = {};
  const errors = [];
  const has   = (k) => body[k] !== undefined && body[k] !== null;
  const wants = (k) => !partial || has(k); // ce champ doit-il être validé ?

  if (wants('station_id')) {
    if (has('station_id') && String(body.station_id).length <= 64) fields.station_id = String(body.station_id);
    else errors.push('station_id');
  }
  if (wants('station_name')) {
    if (has('station_name') && String(body.station_name).length <= 128) fields.station_name = String(body.station_name);
    else errors.push('station_name');
  }
  if (wants('bike_type')) {
    if (BIKE_TYPES.includes(body.bike_type)) fields.bike_type = body.bike_type;
    else errors.push('bike_type (mechanical|ebike|any)');
  }
  if (wants('min_count')) {
    const n = Number(body.min_count);
    if (Number.isInteger(n) && n >= 1 && n <= 50) fields.min_count = n;
    else if (!partial) fields.min_count = 1;        // défaut à la création
    else errors.push('min_count (entier 1-50)');
  }
  if (wants('time_start')) {
    if (HHMM.test(body.time_start ?? '')) fields.time_start = body.time_start;
    else errors.push('time_start (HH:MM)');
  }
  if (wants('time_end')) {
    if (HHMM.test(body.time_end ?? '')) fields.time_end = body.time_end;
    else errors.push('time_end (HH:MM)');
  }
  if (wants('days')) {
    if (typeof body.days === 'string' && DAYS_RE.test(body.days)) {
      fields.days = [...new Set(body.days.split(',').map(Number))].sort((a, b) => a - b).join(',');
    } else if (!partial) {
      fields.days = DAYS_ALL;
    } else {
      errors.push('days (ex: "1,2,3" — chiffres 1-7)');
    }
  }
  if (has('active')) fields.active = body.active ? 1 : 0;

  return { fields, errors };
}

router.get('/api/alerts', requireAuth, async (req, res) => {
  try {
    res.json({ ok: true, alerts: await getAlerts(req.user.id) });
  } catch (err) {
    console.error('[GET /api/alerts]', err.message);
    res.status(500).json({ ok: false, error: 'Erreur serveur' });
  }
});

router.post('/api/alerts', requireAuth, async (req, res) => {
  try {
    const { fields, errors } = validateAlertPayload(req.body ?? {});
    if (errors.length) {
      return res.status(400).json({ ok: false, error: `Champs invalides : ${errors.join(', ')}` });
    }
    const alert = await createAlert(req.user.id, fields);
    res.status(201).json({ ok: true, alert });
  } catch (err) {
    console.error('[POST /api/alerts]', err.message);
    res.status(500).json({ ok: false, error: 'Erreur serveur' });
  }
});

router.patch('/api/alerts/:id', requireAuth, async (req, res) => {
  try {
    const { fields, errors } = validateAlertPayload(req.body ?? {}, { partial: true });
    if (errors.length) {
      return res.status(400).json({ ok: false, error: `Champs invalides : ${errors.join(', ')}` });
    }
    const alert = await updateAlert(req.user.id, Number(req.params.id), fields);
    if (!alert) return res.status(404).json({ ok: false, error: 'Alerte introuvable' });
    res.json({ ok: true, alert });
  } catch (err) {
    console.error('[PATCH /api/alerts]', err.message);
    res.status(500).json({ ok: false, error: 'Erreur serveur' });
  }
});

router.delete('/api/alerts/:id', requireAuth, async (req, res) => {
  try {
    const ok = await deleteAlert(req.user.id, Number(req.params.id));
    if (!ok) return res.status(404).json({ ok: false, error: 'Alerte introuvable' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /api/alerts]', err.message);
    res.status(500).json({ ok: false, error: 'Erreur serveur' });
  }
});

module.exports = router;
