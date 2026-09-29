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
const KINDS      = ['threshold', 'summary'];
const MAX_COUNT  = 50;
const GROUP_MIN  = 2;
const GROUP_MAX  = 5;   // au-delà, le corps de la notification est tronqué
const GROUP_NAME_MAX = 40;
const SEND_TIMES_MAX = 6; // heures d'envoi d'un résumé
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
 *  - `valid_on` : alerte ponctuelle, valable ce jour-là seulement (YYYY-MM-DD) ;
 *  - groupe : `group_stations` ([{ station_id, station_name }], 2 à 5) + `group_name`
 *    facultatif ⇒ la règle s'applique à la meilleure station du groupe (« au plus N » :
 *    toutes sont basses ; « au moins N » : une suffit). La 1re station est recopiée dans
 *    `station_id` / `station_name`. Incompatible avec un trajet.
 *
 * `kind` : `threshold` (défaut, tout ce qui précède) ou `summary` — résumé envoyé chaque
 * jour choisi à chacune de ses heures (`send_times`, 1 à 6) : 1 à 5 stations
 * (`group_stations`), `bike_type`, `days`.
 * Les champs de seuil / trajet / créneau sont alors neutralisés (voir validateSummary).
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

  fields.kind = src.kind ?? 'threshold';
  if (!KINDS.includes(fields.kind)) {
    errors.push('kind (threshold|summary)');
    return { fields, errors };
  }
  if (fields.kind === 'summary') {
    // Heures d'envoi : `send_times`, sinon `time_start` seul (client d'avant la v1.5 —
    // y compris en PATCH, où l'heure fournie l'emporte sur les heures enregistrées).
    if (body.send_times === undefined && body.time_start !== undefined) src.send_times = [body.time_start];
    else if (src.send_times === undefined || src.send_times === null) src.send_times = present(src.time_start) ? [src.time_start] : undefined;
    return validateSummary(src, fields, errors);
  }

  const group = applyGroup(src, fields, errors, GROUP_MIN);

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
    if (group) errors.push('trajet : impossible pour un groupe de stations');
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

  applyDays(src, fields, errors);

  if (!present(src.valid_on)) fields.valid_on = null;
  else if (!YMD.test(src.valid_on)) errors.push('valid_on (AAAA-MM-JJ)');
  // Refus d'une date passée seulement si elle change (une alerte existante expire seule).
  else if (today && src.valid_on < today && src.valid_on !== current?.valid_on) errors.push('valid_on (date passée)');
  else fields.valid_on = src.valid_on;

  fields.send_times = null;
  fields.active = src.active === undefined ? 1 : (src.active ? 1 : 0);

  return { fields, errors };
}

/**
 * Résumé à heure fixe : stations (1 à 5), type de vélo, heures d'envoi (1 à 6), jours.
 * Seuil, trajet et alerte ponctuelle n'ont pas de sens : valeurs neutres forcées.
 * `time_start` = `time_end` = première heure (colonnes obligatoires, tri de la liste).
 */
function validateSummary(src, fields, errors) {
  if (!applyGroup(src, fields, errors, 1)) {
    if (!errors.length) errors.push(`group_stations (1 à ${GROUP_MAX} stations distinctes)`);
  }
  fields.station_id = src.station_id ?? null;
  fields.station_name = src.station_name ?? null;

  fields.target = 'bikes';
  fields.comparison = 'at_most';
  fields.threshold = 0;
  if (src.bike_type === undefined) fields.bike_type = 'any';
  else if (BIKE_TYPES.includes(src.bike_type)) fields.bike_type = src.bike_type;
  else errors.push('bike_type (mechanical|ebike|any)');

  fields.arrival_station_id = null;
  fields.arrival_station_name = null;
  fields.arrival_threshold = null;
  fields.valid_on = null;

  const times = validateSendTimes(src.send_times);
  if (times) {
    fields.send_times = times;
    fields.time_start = fields.time_end = times[0];
  } else errors.push(`send_times (1 à ${SEND_TIMES_MAX} heures HH:MM distinctes)`);
  applyDays(src, fields, errors);
  fields.active = src.active === undefined ? 1 : (src.active ? 1 : 0);

  return { fields, errors };
}

/**
 * Stations du groupe (`min` à GROUP_MAX) + nom facultatif ; la 1re station est recopiée
 * dans `src.station_*`. Renvoie le groupe, ou null (absent ou invalide).
 */
function applyGroup(src, fields, errors, min) {
  const group = validateGroup(src.group_stations, errors, min);
  if (!group) {
    fields.group_stations = null;
    fields.group_name = null;
    return null;
  }
  fields.group_stations = group;
  const name = typeof src.group_name === 'string' ? src.group_name.trim() : '';
  if (name.length > GROUP_NAME_MAX) errors.push(`group_name (${GROUP_NAME_MAX} caractères max)`);
  fields.group_name = name || null;
  src.station_id = group[0].station_id;
  src.station_name = group[0].station_name;
  return group;
}

/** Heures d'envoi d'un résumé : tableau trié de 1 à 6 « HH:MM » distinctes, ou null. */
function validateSendTimes(raw) {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > SEND_TIMES_MAX) return null;
  if (!raw.every((t) => typeof t === 'string' && HHMM.test(t))) return null;
  const times = [...new Set(raw)].sort();
  return times.length === raw.length ? times : null;
}

function applyDays(src, fields, errors) {
  if (src.days === undefined) fields.days = DAYS_ALL;
  else if (typeof src.days === 'string' && DAYS_RE.test(src.days)) {
    fields.days = [...new Set(src.days.split(',').map(Number))].sort((a, b) => a - b).join(',');
  } else errors.push('days (ex: "1,2,3" — chiffres 1-7)');
}

/**
 * Stations d'un groupe : null si absent (alerte simple), sinon tableau normalisé
 * [{ station_id, station_name }] de `min` à 5 stations distinctes (erreurs dans `errors`).
 */
function validateGroup(raw, errors, min) {
  if (raw === undefined || raw === null) return null;
  const label = `group_stations (${min} à ${GROUP_MAX} stations distinctes)`;
  if (!Array.isArray(raw) || raw.length < min || raw.length > GROUP_MAX) {
    errors.push(label);
    return null;
  }
  const group = [];
  for (const s of raw) {
    const id = present(s?.station_id) ? String(s.station_id) : '';
    const name = present(s?.station_name) ? String(s.station_name) : '';
    if (!id || id.length > 64 || !name || name.length > 128 || group.some((g) => g.station_id === id)) {
      errors.push(label);
      return null;
    }
    group.push({ station_id: id, station_name: name });
  }
  return group;
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
