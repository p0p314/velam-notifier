// Routes du module Trains.
//  Publiques (données ouvertes) : statut, gares, lignes, recherche, détail d'un trajet.
//  Protégées (JWT) : trajets favoris et alertes (de trajet / de ligne).
//  Cron (CRON_SECRET) : revalidation quotidienne du dataset GTFS.
// Le frontend n'appelle jamais la SNCF : tout passe par ce backend (cache mutualisé).
const crypto = require('crypto');
const express = require('express');
const {
  getTrainFavorites, getTrainFavorite, countTrainFavorites, addTrainFavorite, setTrainFavoriteLabel, removeTrainFavorite,
  getTrainAlerts, getTrainAlert, createTrainAlert, updateTrainAlert, deleteTrainAlert,
} = require('../db');
const { requireAuth } = require('../auth');
const { requireCronSecret } = require('./rentalApps');
const { getProvider, listProviders, TrainsError } = require('../trains');

const router = express.Router();

const YMD = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAYS_RE = /^[1-7](,[1-7])*$/;
const ID_MAX = 200;
const LABEL_MAX = 40;
const FAVORITES_MAX = 50;
const ALERTS_MAX = 30;
const DELAY_MAX = 180;

/** Erreur → réponse : erreur métier (4xx/503) telle quelle, sinon 500 sans détail. */
function fail(res, err, label) {
  if (err instanceof TrainsError) return res.status(err.status).json({ ok: false, error: err.message });
  console.error(`[${label}]`, err.message);
  return res.status(500).json({ ok: false, error: 'Erreur serveur' });
}

const text = (v, max = ID_MAX) => (typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : null);

function providerOf(req) {
  const id = req.query.provider ?? req.body?.provider;
  if (id !== undefined && (typeof id !== 'string' || id.length > 32)) throw new TrainsError(400, 'provider invalide');
  return getProvider(id);
}

// ── Données publiques ───────────────────────────────────────────────────────

/** GET /api/trains/status — fournisseurs, version et période de validité des horaires. */
router.get('/api/trains/status', (req, res) => {
  res.json({
    ok: true,
    providers: listProviders().map((p) => ({ id: p.id, name: p.name, attribution: p.attribution, schedule: p.schedule.status() })),
  });
});

/** GET /api/trains/stations?q=lill — autocomplétion des gares (données du GTFS). */
router.get('/api/trains/stations', (req, res) => {
  try {
    const q = text(req.query.q, 60);
    if (!q || q.length < 2) return res.status(400).json({ ok: false, error: 'q : 2 caractères minimum' });
    res.json({ ok: true, stations: providerOf(req).service.searchStations(q) });
  } catch (err) { fail(res, err, 'GET /api/trains/stations'); }
});

/** GET /api/trains/lines?q=K44 — recherche de lignes. */
router.get('/api/trains/lines', (req, res) => {
  try {
    const q = text(req.query.q, 60);
    if (!q) return res.status(400).json({ ok: false, error: 'q requis' });
    res.json({ ok: true, lines: providerOf(req).service.searchLines(q) });
  } catch (err) { fail(res, err, 'GET /api/trains/lines'); }
});

/**
 * Paramètres de recherche validés : { from, to, line, date, after }.
 * Au moins une gare ou une ligne ; date par défaut = aujourd'hui (fuseau du réseau).
 */
function searchParams(query) {
  const errors = [];
  const opt = (name) => {
    const v = query[name];
    if (v === undefined || v === '') return null;
    const t = text(v);
    if (!t) errors.push(name);
    return t;
  };
  const params = { from: opt('from'), to: opt('to'), line: opt('line'), date: null, after: null };
  if (query.date !== undefined && query.date !== '') {
    if (YMD.test(query.date) && !Number.isNaN(Date.parse(`${query.date}T12:00:00Z`))) params.date = query.date;
    else errors.push('date (AAAA-MM-JJ)');
  }
  if (query.after !== undefined && query.after !== '') {
    if (HHMM.test(query.after)) params.after = query.after;
    else errors.push('after (HH:MM)');
  }
  if (errors.length) throw new TrainsError(400, `Paramètres invalides : ${errors.join(', ')}`);
  if (!params.from && !params.to && !params.line) throw new TrainsError(400, 'Indiquez une gare de départ, une gare d\'arrivée ou une ligne');
  return params;
}

/**
 * GET /api/trains/search?from=&to=&line=&date=&after=&refresh=1
 * Trains du jour demandé, fusion théorique + temps réel. `refresh=1` force la
 * relecture du temps réel (au plus toutes les 30 s, cache mutualisé sinon).
 */
router.get('/api/trains/search', async (req, res) => {
  try {
    const provider = providerOf(req);
    const params = searchParams(req.query);
    const index = provider.service.requireIndex();
    const date = params.date ?? provider.service.today(index);
    const result = await provider.service.searchJourneys({ ...params, date }, { force: req.query.refresh === '1' });
    res.json({
      ok: true,
      provider: provider.id,
      date,
      count: result.journeys.length,
      truncated: result.truncated,
      lines: result.lines,
      directions: result.directions,
      coverage: result.coverage,
      out_of_coverage: result.outOfCoverage,
      realtime: result.realtime,
      journeys: result.journeys,
    });
  } catch (err) { fail(res, err, 'GET /api/trains/search'); }
});

/** GET /api/trains/journey?id=… — détail d'un trajet (arrêts, retards, événements). */
router.get('/api/trains/journey', async (req, res) => {
  try {
    const id = text(req.query.id, 600);
    if (!id) return res.status(400).json({ ok: false, error: 'id requis' });
    const provider = providerOf(req);
    const { journey, realtime, position } = await provider.service.getJourney(id, { force: req.query.refresh === '1' });
    res.json({ ok: true, provider: provider.id, journey, realtime, position });
  } catch (err) { fail(res, err, 'GET /api/trains/journey'); }
});

/**
 * GET /api/trains/route?id=… — itinéraire géographique du trajet (tracé + gares).
 * Statique pour une version des horaires : mis en cache par le navigateur (1 h) et
 * revalidé par ETag (version du dataset + trajet).
 */
router.get('/api/trains/route', (req, res) => {
  try {
    const id = text(req.query.id, 600);
    if (!id) return res.status(400).json({ ok: false, error: 'id requis' });
    const provider = providerOf(req);
    const route = provider.service.getJourneyRoute(id);
    const tag = crypto.createHash('sha1')
      .update(`${provider.id}|${provider.schedule.status().loaded_at}|${id}`).digest('base64url').slice(0, 20);
    res.set('Cache-Control', 'public, max-age=3600');
    res.set('ETag', `"${tag}"`);
    if (req.fresh) return res.status(304).end();
    res.json({ ok: true, provider: provider.id, route });
  } catch (err) { fail(res, err, 'GET /api/trains/route'); }
});

// ── Favoris (trajets précis) ────────────────────────────────────────────────

/**
 * GET /api/trains/favorites — favoris + état des prochaines circulations + alerte
 * associée. Horaires pas encore chargés : favoris seuls (`schedule_available: false`).
 */
router.get('/api/trains/favorites', requireAuth, async (req, res) => {
  try {
    const [favorites, alerts] = await Promise.all([getTrainFavorites(req.user.id), getTrainAlerts(req.user.id)]);
    const alertOf = new Map(alerts.filter((a) => a.favorite_id).map((a) => [Number(a.favorite_id), a]));
    let available = true;
    let realtime = null;
    const out = [];
    for (const f of favorites) {
      const item = { ...f, alert: alertOf.get(Number(f.id)) ?? null, next: null };
      try {
        const { occurrences, realtime: rt } = await getProvider(f.provider).service.nextOccurrences(f, { force: req.query.refresh === '1' });
        item.next = occurrences;
        if (rt.applicable) realtime = rt;
      } catch (err) {
        if (!(err instanceof TrainsError) || err.status !== 503) throw err;
        available = false;
      }
      out.push(item);
    }
    res.json({
      ok: true,
      schedule_available: available,
      realtime,
      favorites: out,
      line_alerts: alerts.filter((a) => a.scope === 'line'),
    });
  } catch (err) { fail(res, err, 'GET /api/trains/favorites'); }
});

/**
 * POST /api/trains/favorites — { journey_id }. Les informations enregistrées (gares,
 * heure, numéro, ligne) sont relues côté serveur dans les horaires, jamais reprises du client.
 */
router.post('/api/trains/favorites', requireAuth, async (req, res) => {
  try {
    const journeyId = text(req.body?.journey_id, 600);
    if (!journeyId) return res.status(400).json({ ok: false, error: 'journey_id requis' });
    const fav = providerOf(req).service.favoriteFromJourney(journeyId);
    if (await countTrainFavorites(req.user.id) >= FAVORITES_MAX) {
      const existing = (await getTrainFavorites(req.user.id)).some((f) => f.origin_id === fav.origin_id
        && f.destination_id === fav.destination_id && f.departure_time === fav.departure_time && f.train_number === fav.train_number);
      if (!existing) return res.status(400).json({ ok: false, error: `${FAVORITES_MAX} trajets favoris au maximum` });
    }
    const favorite = await addTrainFavorite(req.user.id, fav);
    res.status(201).json({ ok: true, favorite });
  } catch (err) { fail(res, err, 'POST /api/trains/favorites'); }
});

const idParam = (req) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new TrainsError(400, 'Identifiant invalide');
  return id;
};

/** PATCH /api/trains/favorites/:id — { label } (vide = nom par défaut). */
router.patch('/api/trains/favorites/:id', requireAuth, async (req, res) => {
  try {
    const id = idParam(req);
    const raw = req.body?.label;
    if (raw !== null && raw !== undefined && typeof raw !== 'string') return res.status(400).json({ ok: false, error: 'label : texte attendu' });
    const label = (raw ?? '').trim();
    if (label.length > LABEL_MAX) return res.status(400).json({ ok: false, error: `label : ${LABEL_MAX} caractères maximum` });
    if (!(await setTrainFavoriteLabel(req.user.id, id, label || null))) return res.status(404).json({ ok: false, error: 'Favori introuvable' });
    res.json({ ok: true, favorite: await getTrainFavorite(req.user.id, id) });
  } catch (err) { fail(res, err, 'PATCH /api/trains/favorites'); }
});

/** DELETE /api/trains/favorites/:id — retire le favori et son alerte. */
router.delete('/api/trains/favorites/:id', requireAuth, async (req, res) => {
  try {
    if (!(await removeTrainFavorite(req.user.id, idParam(req)))) return res.status(404).json({ ok: false, error: 'Favori introuvable' });
    res.json({ ok: true });
  } catch (err) { fail(res, err, 'DELETE /api/trains/favorites'); }
});

// ── Alertes ─────────────────────────────────────────────────────────────────

/**
 * Valide une alerte train (création, ou PATCH fusionné sur `current`).
 *  - `scope` : `trip` (favori : retard ≥ `delay_threshold` min, suppression, perturbation,
 *    voie de départ `on_platform` — annonce puis changements)
 *    ou `line` (ligne : suppressions, perturbations ; créneau `time_start`–`time_end` facultatif) ;
 *  - au moins un déclencheur ; `days` : jours ISO (1 = lundi).
 * Renvoie { fields, errors }.
 */
function validateTrainAlert(body, { current = null } = {}) {
  const src = { ...(current ?? {}), ...body };
  const fields = {};
  const errors = [];
  fields.scope = src.scope;
  if (!['trip', 'line'].includes(fields.scope)) { errors.push('scope (trip|line)'); return { fields, errors }; }

  const t = src.delay_threshold;
  if (t === null || t === undefined || t === '') fields.delay_threshold = null;
  else if (Number.isInteger(Number(t)) && Number(t) >= 1 && Number(t) <= DELAY_MAX) fields.delay_threshold = Number(t);
  else errors.push(`delay_threshold (1 à ${DELAY_MAX} min)`);
  for (const k of ['on_cancel', 'on_disruption', 'on_platform']) {
    const v = src[k];
    if (v === undefined) fields[k] = k === 'on_cancel' || (k === 'on_platform' && fields.scope === 'trip');
    else if (typeof v === 'boolean' || v === 0 || v === 1) fields[k] = !!v;
    else errors.push(k);
  }
  if (src.active !== undefined) {
    if (typeof src.active === 'boolean' || src.active === 0 || src.active === 1) fields.active = !!src.active;
    else errors.push('active');
  }
  fields.days = src.days ?? '1,2,3,4,5,6,7';
  if (Array.isArray(fields.days)) fields.days = fields.days.join(',');
  if (typeof fields.days !== 'string' || !DAYS_RE.test(fields.days)) errors.push('days');
  else fields.days = [...new Set(fields.days.split(',').map(Number))].sort().join(',');

  if (fields.scope === 'line') {
    if (fields.delay_threshold !== null) errors.push('delay_threshold : non disponible pour une ligne');
    fields.on_platform = false; // la voie n'a de sens que pour un train précis
    const s = src.time_start ?? null;
    const e = src.time_end ?? null;
    if ((s === null) !== (e === null)) errors.push('time_start et time_end ensemble');
    else if (s !== null && (!HHMM.test(s) || !HHMM.test(e))) errors.push('time_start / time_end (HH:MM)');
    fields.time_start = s;
    fields.time_end = e;
  } else {
    fields.time_start = null;
    fields.time_end = null;
  }
  if (fields.delay_threshold === null && !fields.on_cancel && !fields.on_disruption && !fields.on_platform) {
    errors.push('au moins un déclencheur (retard, suppression, perturbation ou voie)');
  }
  return { fields, errors };
}

/**
 * POST /api/trains/alerts
 *  trajet : { scope:'trip', favorite_id | journey_id, delay_threshold?, on_cancel?, on_disruption?, on_platform?, days? }
 *           (journey_id ⇒ le trajet est ajouté aux favoris s'il n'y est pas) ;
 *  ligne  : { scope:'line', line, on_cancel?, on_disruption?, time_start?, time_end?, days? }.
 */
router.post('/api/trains/alerts', requireAuth, async (req, res) => {
  try {
    const body = req.body ?? {};
    const { fields, errors } = validateTrainAlert(body);
    if (errors.length) return res.status(400).json({ ok: false, error: `Champs invalides : ${errors.join(', ')}` });
    const existing = await getTrainAlerts(req.user.id);
    if (existing.length >= ALERTS_MAX) return res.status(400).json({ ok: false, error: `${ALERTS_MAX} alertes trains au maximum` });
    const provider = providerOf(req);

    if (fields.scope === 'trip') {
      let favorite = null;
      if (body.favorite_id !== undefined) {
        favorite = await getTrainFavorite(req.user.id, Number(body.favorite_id));
        if (!favorite) return res.status(404).json({ ok: false, error: 'Favori introuvable' });
      } else {
        const journeyId = text(body.journey_id, 600);
        if (!journeyId) return res.status(400).json({ ok: false, error: 'favorite_id ou journey_id requis' });
        favorite = await addTrainFavorite(req.user.id, provider.service.favoriteFromJourney(journeyId));
      }
      if (existing.some((a) => Number(a.favorite_id) === Number(favorite.id))) {
        return res.status(409).json({ ok: false, error: 'Une alerte existe déjà pour ce trajet' });
      }
      const alert = await createTrainAlert(req.user.id, { ...fields, provider: favorite.provider, favorite_id: favorite.id });
      return res.status(201).json({ ok: true, alert, favorite });
    }

    const lineParam = text(body.line);
    if (!lineParam) return res.status(400).json({ ok: false, error: 'line requis' });
    const index = provider.service.requireIndex();
    const lines = [...provider.service.resolveLines(index, lineParam)];
    if (lines.length !== 1) return res.status(400).json({ ok: false, error: 'Plusieurs lignes portent ce nom : choisissez-en une' });
    const line = index.lines[lines[0]];
    if (existing.some((a) => a.scope === 'line' && a.line_id === line.id)) {
      return res.status(409).json({ ok: false, error: 'Vous suivez déjà cette ligne' });
    }
    const alert = await createTrainAlert(req.user.id, {
      ...fields, provider: provider.id, line_id: line.id, line_name: line.shortName, line_long_name: line.longName,
    });
    res.status(201).json({ ok: true, alert });
  } catch (err) { fail(res, err, 'POST /api/trains/alerts'); }
});

/** GET /api/trains/alerts — alertes trains ; une alerte de trajet porte le résumé de son favori. */
router.get('/api/trains/alerts', requireAuth, async (req, res) => {
  try {
    const [alerts, favorites] = await Promise.all([getTrainAlerts(req.user.id), getTrainFavorites(req.user.id)]);
    const byId = new Map(favorites.map((f) => [Number(f.id), f]));
    res.json({
      ok: true,
      alerts: alerts.map((a) => {
        const f = a.favorite_id ? byId.get(Number(a.favorite_id)) : null;
        return f ? {
          ...a,
          favorite: {
            id: f.id, label: f.label, line_name: f.line_name, departure_time: f.departure_time,
            origin_name: f.origin_name, destination_name: f.destination_name,
          },
        } : a;
      }),
    });
  } catch (err) { fail(res, err, 'GET /api/trains/alerts'); }
});

/** PATCH /api/trains/alerts/:id — fusion puis revalidation (portée et favori non modifiables). */
router.patch('/api/trains/alerts/:id', requireAuth, async (req, res) => {
  try {
    const id = idParam(req);
    const current = await getTrainAlert(req.user.id, id);
    if (!current) return res.status(404).json({ ok: false, error: 'Alerte introuvable' });
    const { scope, favorite_id, line, ...changes } = req.body ?? {};
    const { fields, errors } = validateTrainAlert(changes, { current });
    if (errors.length) return res.status(400).json({ ok: false, error: `Champs invalides : ${errors.join(', ')}` });
    res.json({ ok: true, alert: await updateTrainAlert(req.user.id, id, fields) });
  } catch (err) { fail(res, err, 'PATCH /api/trains/alerts'); }
});

router.delete('/api/trains/alerts/:id', requireAuth, async (req, res) => {
  try {
    if (!(await deleteTrainAlert(req.user.id, idParam(req)))) return res.status(404).json({ ok: false, error: 'Alerte introuvable' });
    res.json({ ok: true });
  } catch (err) { fail(res, err, 'DELETE /api/trains/alerts'); }
});

// ── Cron ────────────────────────────────────────────────────────────────────

/**
 * POST /cron/sync-trains — revalide le dataset GTFS de chaque fournisseur (requête
 * conditionnelle : rien n'est téléchargé s'il n'a pas changé). GitHub Actions, 1×/jour.
 */
router.post('/cron/sync-trains', requireCronSecret, async (req, res) => {
  const results = [];
  for (const p of listProviders()) {
    try {
      results.push({ provider: p.id, ok: true, ...(await p.schedule.refresh()) });
    } catch (err) {
      results.push({ provider: p.id, ok: false, error: err.message });
    }
  }
  const allOk = results.every((r) => r.ok);
  res.status(allOk ? 200 : 502).json({ ok: allOk, results });
});

module.exports = router;
module.exports.validateTrainAlert = validateTrainAlert;
module.exports.searchParams = searchParams;
