// Routes alertes de disponibilité (protégées par JWT) + validation des payloads.
const express = require('express');
const { getAlerts, createAlert, updateAlert, deleteAlert } = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function validateAlertPayload(body, { partial = false } = {}) {
  const fields = {};
  const errors = [];

  const has = (k) => body[k] !== undefined && body[k] !== null;

  if (!partial || has('station_id'))   { has('station_id')   && String(body.station_id).length   <= 64  ? (fields.station_id   = String(body.station_id))   : errors.push('station_id'); }
  if (!partial || has('station_name')) { has('station_name') && String(body.station_name).length <= 128 ? (fields.station_name = String(body.station_name)) : errors.push('station_name'); }
  if (!partial || has('bike_type')) {
    if (['mechanical', 'ebike', 'any'].includes(body.bike_type)) fields.bike_type = body.bike_type;
    else errors.push('bike_type (mechanical|ebike|any)');
  }
  if (!partial || has('min_count')) {
    const n = Number(body.min_count);
    if (Number.isInteger(n) && n >= 1 && n <= 50) fields.min_count = n;
    else if (!partial) fields.min_count = 1;
    else errors.push('min_count (entier 1-50)');
  }
  if (!partial || has('time_start')) { HHMM.test(body.time_start ?? '') ? (fields.time_start = body.time_start) : errors.push('time_start (HH:MM)'); }
  if (!partial || has('time_end'))   { HHMM.test(body.time_end ?? '')   ? (fields.time_end   = body.time_end)   : errors.push('time_end (HH:MM)'); }
  if (!partial || has('days')) {
    if (typeof body.days === 'string' && /^[1-7](,[1-7])*$/.test(body.days)) {
      fields.days = [...new Set(body.days.split(',').map(Number))].sort((a, b) => a - b).join(',');
    } else if (!partial) {
      fields.days = '1,2,3,4,5,6,7';
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
