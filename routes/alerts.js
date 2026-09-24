// Routes alertes de disponibilité (protégées par JWT) + validation des payloads.
const express = require('express');
const { getAlerts, getAlert, createAlert, updateAlert, deleteAlert, getAlertsPause, setAlertsPause } = require('../db');
const { nowInTz, addDays } = require('../time');
const { requireAuth } = require('../auth');

const router = express.Router();

const HHMM       = /^([01]\d|2[0-3]):[0-5]\d$/;
const YMD        = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const DAYS_ALL   = '1,2,3,4,5,6,7';
const DAYS_RE    = /^[1-7](,[1-7])*$/;
const BIKE_TYPES = ['mechanical', 'ebike', 'any'];
const TARGETS    = ['bikes', 'docks'];
const COMPARISONS = ['at_most', 'at_least'];
const MAX_COUNT  = 50;
const PAUSE_MAX_DAYS = 365;
const YMD_OK = (v) => typeof v === 'string' && YMD.test(v);

const isInt = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
const present = (v) => v !== undefined && v !== null && v !== '';

/**
 * Valide et normalise une alerte complète.
 *
 * Modèle :
 *  - `target` : ce qu'on surveille à la station — `bikes` (vélos, filtrés par
 *    `bike_type`) ou `docks` (places libres pour déposer) ;
 *  - `comparison` + `threshold` : `at_most` N (se vider / se remplir : « il ne reste
 *    que N ») ou `at_least` N (« il y en a de nouveau N ») ;
 *  - trajet : `arrival_station_*` + `arrival_threshold` ⇒ surveille aussi les places
 *    à la station d'arrivée (uniquement en mode vélos / at_most : alerte « problème ») ;
 *  - `valid_on` : alerte ponctuelle, valable ce jour-là seulement (YYYY-MM-DD).
 *
 * `current` (PATCH) : l'alerte existante ; le payload est fusionné dessus puis tout
 * est revalidé (les règles croisées restent cohérentes). `today` : date du jour dans
 * le fuseau des alertes, pour refuser une alerte ponctuelle dans le passé.
 * `min_count` (ancien nom de `threshold`) reste accepté en entrée.
 */
function validateAlertPayload(body, { current = null, today = null } = {}) {
  const src = { ...(current ?? {}), ...body };
  if (body.threshold === undefined && body.min_count !== undefined) src.threshold = body.min_count;
  const fields = {};
  const errors = [];

  if (present(src.station_id) && String(src.station_id).length <= 64) fields.station_id = String(src.station_id);
  else errors.push('station_id');
  if (present(src.station_name) && String(src.station_name).length <= 128) fields.station_name = String(src.station_name);
  else errors.push('station_name');

  fields.target = src.target ?? 'bikes';
  if (!TARGETS.includes(fields.target)) errors.push('target (bikes|docks)');
  fields.comparison = src.comparison ?? 'at_most';
  if (!COMPARISONS.includes(fields.comparison)) errors.push('comparison (at_most|at_least)');

  // Le type de vélo n'a de sens que pour les vélos ; les places ignorent ce champ.
  if (fields.target === 'docks') fields.bike_type = 'any';
  else if (BIKE_TYPES.includes(src.bike_type)) fields.bike_type = src.bike_type;
  else if (src.bike_type === undefined) fields.bike_type = 'any';
  else errors.push('bike_type (mechanical|ebike|any)');

  // « au plus 0 » = plus rien du tout ; « au moins 0 » serait toujours vrai.
  const minThreshold = fields.comparison === 'at_least' ? 1 : 0;
  const threshold = src.threshold === undefined ? 1 : Number(src.threshold);
  if (isInt(threshold, minThreshold, MAX_COUNT)) fields.threshold = threshold;
  else errors.push(`threshold (entier ${minThreshold}-${MAX_COUNT})`);

  // Trajet : station d'arrivée facultative, mais complète si présente.
  if (present(src.arrival_station_id)) {
    fields.arrival_station_id = String(src.arrival_station_id);
    fields.arrival_station_name = present(src.arrival_station_name) ? String(src.arrival_station_name) : '';
    if (fields.arrival_station_id.length > 64) errors.push('arrival_station_id');
    if (!fields.arrival_station_name || fields.arrival_station_name.length > 128) errors.push('arrival_station_name');
    if (fields.arrival_station_id === fields.station_id) errors.push('arrival_station_id (différente du départ)');
    if (fields.target !== 'bikes' || fields.comparison !== 'at_most') {
      errors.push('trajet : uniquement pour une alerte « vélos, au plus N »');
    }
    const arr = src.arrival_threshold === undefined || src.arrival_threshold === null ? 1 : Number(src.arrival_threshold);
    if (isInt(arr, 0, MAX_COUNT)) fields.arrival_threshold = arr;
    else errors.push(`arrival_threshold (entier 0-${MAX_COUNT})`);
  } else {
    fields.arrival_station_id = null;
    fields.arrival_station_name = null;
    fields.arrival_threshold = null;
  }

  if (HHMM.test(src.time_start ?? '')) fields.time_start = src.time_start;
  else errors.push('time_start (HH:MM)');
  if (HHMM.test(src.time_end ?? '')) fields.time_end = src.time_end;
  else errors.push('time_end (HH:MM)');

  if (src.days === undefined) fields.days = DAYS_ALL;
  else if (typeof src.days === 'string' && DAYS_RE.test(src.days)) {
    fields.days = [...new Set(src.days.split(',').map(Number))].sort((a, b) => a - b).join(',');
  } else errors.push('days (ex: "1,2,3" — chiffres 1-7)');

  if (!present(src.valid_on)) fields.valid_on = null;
  else if (!YMD.test(src.valid_on)) errors.push('valid_on (AAAA-MM-JJ)');
  // Refus d'une date passée seulement si elle change (une alerte existante expire seule).
  else if (today && src.valid_on < today && src.valid_on !== current?.valid_on) errors.push('valid_on (date passée)');
  else fields.valid_on = src.valid_on;

  fields.active = src.active === undefined ? 1 : (src.active ? 1 : 0);

  return { fields, errors };
}

// Identifiant d'alerte : entier positif, sinon 404 (évite un NaN envoyé à Postgres → 500).
function parseId(raw) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

const today = () => nowInTz().date;

router.get('/api/alerts', requireAuth, async (req, res) => {
  try {
    const t = today();
    const [alerts, pausedUntil] = await Promise.all([getAlerts(req.user.id, t), getAlertsPause(req.user.id)]);
    // Une pause échue n'est plus pertinente pour l'UI.
    res.json({ ok: true, alerts, paused_until: pausedUntil && pausedUntil >= t ? pausedUntil : null });
  } catch (err) {
    console.error('[GET /api/alerts]', err.message);
    res.status(500).json({ ok: false, error: 'Erreur serveur' });
  }
});

router.post('/api/alerts', requireAuth, async (req, res) => {
  try {
    const { fields, errors } = validateAlertPayload(req.body ?? {}, { today: today() });
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

/**
 * PUT /api/alerts/pause — suspend toutes les alertes jusqu'au `until` inclus
 * (YYYY-MM-DD, au plus 1 an), ou les reprend avec `until: null`.
 * Déclarée avant `/:id` pour ne pas être capturée comme un identifiant.
 */
router.put('/api/alerts/pause', requireAuth, async (req, res) => {
  try {
    const until = req.body?.until ?? null;
    const t = today();
    if (until !== null && (!YMD_OK(until) || until < t || until > addDays(t, PAUSE_MAX_DAYS))) {
      return res.status(400).json({ ok: false, error: `until : date AAAA-MM-JJ entre aujourd'hui et +${PAUSE_MAX_DAYS} jours, ou null` });
    }
    await setAlertsPause(req.user.id, until);
    res.json({ ok: true, paused_until: until });
  } catch (err) {
    console.error('[PUT /api/alerts/pause]', err.message);
    res.status(500).json({ ok: false, error: 'Erreur serveur' });
  }
});

router.patch('/api/alerts/:id', requireAuth, async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const current = id && await getAlert(req.user.id, id);
    if (!current) return res.status(404).json({ ok: false, error: 'Alerte introuvable' });

    const { fields, errors } = validateAlertPayload(req.body ?? {}, { current, today: today() });
    if (errors.length) {
      return res.status(400).json({ ok: false, error: `Champs invalides : ${errors.join(', ')}` });
    }
    res.json({ ok: true, alert: await updateAlert(req.user.id, id, fields) });
  } catch (err) {
    console.error('[PATCH /api/alerts]', err.message);
    res.status(500).json({ ok: false, error: 'Erreur serveur' });
  }
});

router.delete('/api/alerts/:id', requireAuth, async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const ok = id && await deleteAlert(req.user.id, id);
    if (!ok) return res.status(404).json({ ok: false, error: 'Alerte introuvable' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /api/alerts]', err.message);
    res.status(500).json({ ok: false, error: 'Erreur serveur' });
  }
});

module.exports = router;
module.exports.validateAlertPayload = validateAlertPayload;
