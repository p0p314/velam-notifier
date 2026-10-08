// Module Trains — API HTTP : données publiques, favoris et alertes (JWT), cron.
const { startServer, client, registerUser, resetDb, sncf, resetSncf } = require('./helpers');
const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { getProvider } = require('../trains');
const { buildGtfs, zipFiles, tripUpdatesFeed, alertsFeed, area, LINES, tripId, parisDate, addDays } = require('./trainsFixture');

const TODAY = parisDate();
const TOMORROW = addDays(TODAY, 1);
const START = addDays(TODAY, -3);
const LILLE = area('LILLE');
const AMIENS = area('AMIENS');
const K45 = tripId('848908', LINES.K45, 'LILLE', 'AMIENS', addDays(START, 39));

let srv;
let api;
before(async () => {
  srv = await startServer();
  api = client(srv.url);
});
after(() => srv.close());

const provider = getProvider();
const load = () => provider.schedule.loadFiles(buildGtfs({ start: START, days: 40 }));

beforeEach(async () => {
  await resetDb();
  resetSncf();
  await load();
});

const q = (params) => new URLSearchParams(params).toString();
const searchK45 = async (extra = {}) => {
  const res = await api.get(`/api/trains/search?${q({ from: LILLE, to: AMIENS, date: TOMORROW, ...extra })}`);
  assert.equal(res.status, 200, res.text);
  return res.body;
};

describe('données publiques', () => {
  test('statut : fournisseur SNCF, version et période des horaires', async () => {
    const res = await api.get('/api/trains/status');
    assert.equal(res.status, 200);
    const sncfStatus = res.body.providers.find((p) => p.id === 'sncf');
    assert.equal(sncfStatus.schedule.loaded, true);
    assert.equal(sncfStatus.schedule.valid_from, START);
    assert.match(sncfStatus.attribution, /ODbL/);
  });

  test('gares : autocomplétion, 2 caractères minimum', async () => {
    const res = await api.get('/api/trains/stations?q=lill');
    assert.deepEqual(res.body.stations.map((s) => s.id), [LILLE]);
    assert.equal((await api.get('/api/trains/stations?q=l')).status, 400);
  });

  test('lignes : « K44 » renvoie les deux lignes homonymes', async () => {
    const res = await api.get('/api/trains/lines?q=K44');
    assert.equal(res.body.lines.length, 2);
  });

  test('recherche : paramètres validés côté serveur', async () => {
    assert.equal((await api.get('/api/trains/search')).status, 400);
    assert.equal((await api.get(`/api/trains/search?${q({ from: LILLE, date: '2026-13-40' })}`)).status, 400);
    assert.equal((await api.get(`/api/trains/search?${q({ from: LILLE, after: '25:00' })}`)).status, 400);
    assert.equal((await api.get(`/api/trains/search?${q({ from: 'x'.repeat(300) })}`)).status, 400);
    const unknown = await api.get(`/api/trains/search?${q({ from: 'StopArea:OCE00000000', to: AMIENS })}`);
    assert.equal(unknown.status, 404);
    assert.equal(unknown.body.error, 'Gare inconnue');
    assert.equal((await api.get(`/api/trains/search?${q({ line: 'Z99' })}`)).status, 404);
  });

  test('recherche Lille → Amiens avec temps réel : retard, heure de mise à jour', async () => {
    sncf.tripUpdates = tripUpdatesFeed([{ tripId: K45, startDate: TOMORROW, stops: [{ seq: 0, dep: 420 }] }]);
    sncf.alerts = alertsFeed([]);
    const body = await searchK45();
    assert.equal(body.date, TOMORROW);
    assert.equal(body.realtime.available, true);
    assert.ok(body.realtime.updated_at);
    const k45 = body.journeys.find((j) => j.trainNumber === '848908');
    assert.equal(k45.departureDelay, 7);
    assert.equal(k45.status, 'delayed');
  });

  test('temps réel indisponible : horaires théoriques (200), aucun train supprimé', async () => {
    sncf.failRealtime = true;
    const body = await searchK45();
    assert.equal(body.realtime.available, false);
    assert.ok(body.journeys.length > 0);
    assert.ok(body.journeys.every((j) => j.status === 'scheduled'));
  });

  test('date par défaut = aujourd\'hui ; détail d\'un trajet', async () => {
    const res = await api.get(`/api/trains/search?${q({ line: LINES.K44_LYON })}`);
    assert.equal(res.body.date, TODAY);
    const id = res.body.journeys[0].id;
    const detail = await api.get(`/api/trains/journey?${q({ id })}`);
    assert.equal(detail.status, 200);
    assert.deepEqual(detail.body.journey.stops.map((s) => s.station.name), ['Lyon Perrache', 'Valence Ville']);
    assert.equal((await api.get('/api/trains/journey')).status, 400);
  });

  test('horaires absents : 503 puis chargement en arrière-plan (téléchargement du zip)', async () => {
    provider.schedule.reset();
    sncf.gtfs = zipFiles(buildGtfs({ start: START, days: 40 }));
    const res = await api.get(`/api/trains/search?${q({ from: LILLE, to: AMIENS })}`);
    assert.equal(res.status, 503);
    assert.equal(res.body.ok, false);
    // Le chargement déclenché se termine : la recherche répond ensuite.
    await provider.schedule.load();
    assert.equal(sncf.calls.gtfs, 1);
    assert.equal((await api.get(`/api/trains/search?${q({ from: LILLE, to: AMIENS })}`)).status, 200);
  });
});

describe('favoris', () => {
  let token;
  beforeEach(async () => { ({ token } = await registerUser(api)); });

  const journeyId = async () => (await searchK45()).journeys.find((j) => j.trainNumber === '848908').id;

  test('authentification requise', async () => {
    assert.equal((await api.get('/api/trains/favorites')).status, 401);
    assert.equal((await api.post('/api/trains/favorites', { body: { journey_id: 'x' } })).status, 401);
  });

  test('ajout (données relues côté serveur), état des prochaines circulations, retrait', async () => {
    const add = await api.post('/api/trains/favorites', { token, body: { journey_id: await journeyId() } });
    assert.equal(add.status, 201, add.text);
    assert.equal(add.body.favorite.train_number, '848908');
    assert.equal(add.body.favorite.departure_time, '17:53');
    assert.equal(add.body.favorite.origin_name, 'Lille Flandres');

    // Ajout répété : pas de doublon.
    await api.post('/api/trains/favorites', { token, body: { journey_id: await journeyId() } });
    const list = await api.get('/api/trains/favorites', { token });
    assert.equal(list.body.favorites.length, 1);
    const fav = list.body.favorites[0];
    assert.equal(list.body.schedule_available, true);
    assert.ok(fav.next.length >= 1);
    assert.equal(fav.next[0].trainNumber, '848908');
    assert.equal(fav.alert, null);

    const label = await api.patch(`/api/trains/favorites/${fav.id}`, { token, body: { label: 'Retour du boulot' } });
    assert.equal(label.body.favorite.label, 'Retour du boulot');

    assert.equal((await api.delete(`/api/trains/favorites/${fav.id}`, { token })).status, 200);
    assert.equal((await api.get('/api/trains/favorites', { token })).body.favorites.length, 0);
    assert.equal((await api.delete(`/api/trains/favorites/${fav.id}`, { token })).status, 404);
  });

  test('trajet inconnu : 404 ; favori d\'un autre compte : inaccessible', async () => {
    assert.equal((await api.post('/api/trains/favorites', { token, body: { journey_id: `x|${TODAY}|${LILLE}|${AMIENS}` } })).status, 404);
    const { favorite } = (await api.post('/api/trains/favorites', { token, body: { journey_id: await journeyId() } })).body;
    const other = await registerUser(api);
    assert.equal((await api.delete(`/api/trains/favorites/${favorite.id}`, { token: other.token })).status, 404);
    assert.equal((await api.get('/api/trains/favorites', { token: other.token })).body.favorites.length, 0);
  });

  test('horaires en cours de chargement : les favoris restent listés', async () => {
    await api.post('/api/trains/favorites', { token, body: { journey_id: await journeyId() } });
    provider.schedule.reset();
    const list = await api.get('/api/trains/favorites', { token });
    assert.equal(list.status, 200);
    assert.equal(list.body.schedule_available, false);
    assert.equal(list.body.favorites[0].next, null);
  });
});

describe('alertes', () => {
  let token;
  beforeEach(async () => { ({ token } = await registerUser(api)); });
  const addFavorite = async () => {
    const id = (await searchK45()).journeys.find((j) => j.trainNumber === '848908').id;
    return (await api.post('/api/trains/favorites', { token, body: { journey_id: id } })).body.favorite;
  };

  test('alerte de trajet : création, doublon refusé, modification, suppression', async () => {
    const fav = await addFavorite();
    const create = await api.post('/api/trains/alerts', { token, body: { scope: 'trip', favorite_id: fav.id, delay_threshold: 10, on_cancel: true, on_disruption: true, days: '1,2,3,4,5' } });
    assert.equal(create.status, 201, create.text);
    assert.equal(create.body.alert.delay_threshold, 10);
    assert.equal(create.body.alert.on_cancel, true);
    assert.equal(create.body.alert.days, '1,2,3,4,5');

    assert.equal((await api.post('/api/trains/alerts', { token, body: { scope: 'trip', favorite_id: fav.id, on_cancel: true } })).status, 409);

    const id = create.body.alert.id;
    const patch = await api.patch(`/api/trains/alerts/${id}`, { token, body: { delay_threshold: 15, scope: 'line' } });
    assert.equal(patch.status, 200);
    assert.equal(patch.body.alert.delay_threshold, 15);
    assert.equal(patch.body.alert.scope, 'trip'); // portée non modifiable

    const list = await api.get('/api/trains/favorites', { token });
    assert.equal(list.body.favorites[0].alert.id, id);
    // La liste des alertes indique le trajet surveillé.
    const alertsList = await api.get('/api/trains/alerts', { token });
    assert.deepEqual(
      { ...alertsList.body.alerts[0].favorite, id: undefined },
      { id: undefined, label: null, line_name: 'K45', departure_time: '17:53', origin_name: 'Lille Flandres', destination_name: 'Amiens' },
    );

    assert.equal((await api.delete(`/api/trains/alerts/${id}`, { token })).status, 200);
    assert.equal((await api.get('/api/trains/alerts', { token })).body.alerts.length, 0);
  });

  test('créée depuis un trajet (journey_id) : le trajet est ajouté aux favoris', async () => {
    const id = (await searchK45()).journeys.find((j) => j.trainNumber === '848908').id;
    const res = await api.post('/api/trains/alerts', { token, body: { scope: 'trip', journey_id: id, on_cancel: true } });
    assert.equal(res.status, 201);
    assert.equal(res.body.favorite.train_number, '848908');
    assert.equal((await api.get('/api/trains/favorites', { token })).body.favorites.length, 1);
  });

  test('validation', async () => {
    const fav = await addFavorite();
    const post = (body) => api.post('/api/trains/alerts', { token, body });
    assert.equal((await post({ scope: 'bus' })).status, 400);
    assert.equal((await post({ scope: 'trip', favorite_id: fav.id, delay_threshold: 0 })).status, 400);
    assert.equal((await post({ scope: 'trip', favorite_id: fav.id, delay_threshold: 500 })).status, 400);
    assert.equal((await post({ scope: 'trip', favorite_id: fav.id, on_cancel: false, on_disruption: false, on_platform: false })).status, 400);
    assert.equal((await post({ scope: 'trip', favorite_id: fav.id, on_platform: 'oui' })).status, 400);
    assert.equal((await post({ scope: 'trip', favorite_id: fav.id, on_cancel: true, days: '8' })).status, 400);
    assert.equal((await post({ scope: 'trip', favorite_id: 999999, on_cancel: true })).status, 404);
    assert.equal((await post({ scope: 'line', line: LINES.K44, delay_threshold: 10 })).status, 400);
    assert.equal((await post({ scope: 'line', line: LINES.K44, on_disruption: true, time_start: '07:00' })).status, 400);
  });

  test('voie de départ : activée par défaut pour un trajet, seule suffit ; jamais pour une ligne', async () => {
    const fav = await addFavorite();
    const only = await api.post('/api/trains/alerts', { token, body: { scope: 'trip', favorite_id: fav.id, on_cancel: false, on_disruption: false } });
    assert.equal(only.status, 201, only.text);
    assert.equal(only.body.alert.on_platform, true);
    const off = await api.patch(`/api/trains/alerts/${only.body.alert.id}`, { token, body: { on_platform: false, on_cancel: true } });
    assert.equal(off.status, 200, off.text);
    assert.equal(off.body.alert.on_platform, false);
    const line = await api.post('/api/trains/alerts', { token, body: { scope: 'line', line: LINES.K44, on_disruption: true, on_platform: true } });
    assert.equal(line.status, 201, line.text);
    assert.equal(line.body.alert.on_platform, false);
  });

  test('alerte de ligne : nom ambigu refusé, ligne précise acceptée, une seule par ligne', async () => {
    const ambiguous = await api.post('/api/trains/alerts', { token, body: { scope: 'line', line: 'K44', on_disruption: true } });
    assert.equal(ambiguous.status, 400);
    const ok = await api.post('/api/trains/alerts', { token, body: { scope: 'line', line: LINES.K44, on_disruption: true, on_cancel: false, time_start: '06:00', time_end: '20:00' } });
    assert.equal(ok.status, 201, ok.text);
    assert.equal(ok.body.alert.line_name, 'K44');
    assert.equal(ok.body.alert.line_long_name, 'Lille Flandres - Amiens');
    assert.equal(ok.body.alert.time_start, '06:00');
    assert.equal((await api.post('/api/trains/alerts', { token, body: { scope: 'line', line: LINES.K44, on_cancel: true } })).status, 409);
    const list = await api.get('/api/trains/favorites', { token });
    assert.equal(list.body.line_alerts.length, 1);
  });

  test('retirer un favori supprime son alerte ; alertes d\'un autre compte inaccessibles', async () => {
    const fav = await addFavorite();
    const { alert } = (await api.post('/api/trains/alerts', { token, body: { scope: 'trip', favorite_id: fav.id, on_cancel: true } })).body;
    const other = await registerUser(api);
    assert.equal((await api.patch(`/api/trains/alerts/${alert.id}`, { token: other.token, body: { active: false } })).status, 404);
    assert.equal((await api.delete(`/api/trains/alerts/${alert.id}`, { token: other.token })).status, 404);
    await api.delete(`/api/trains/favorites/${fav.id}`, { token });
    assert.equal((await api.get('/api/trains/alerts', { token })).body.alerts.length, 0);
  });

  test('RGPD : export puis suppression du compte (favoris et alertes trains inclus)', async () => {
    const fav = await addFavorite();
    await api.post('/api/trains/alerts', { token, body: { scope: 'trip', favorite_id: fav.id, on_cancel: true } });
    const exp = await api.get('/api/auth/export', { token });
    assert.equal(exp.body.export.trains.favorites.length, 1);
    assert.equal(exp.body.export.trains.alerts.length, 1);
    const del = await api.delete('/api/auth/me', { token, body: { password: 'motdepasse1' } });
    assert.equal(del.status, 200, del.text);
    const { dbc } = require('./helpers');
    assert.equal(Number((await dbc.get('SELECT COUNT(*) AS n FROM train_favorites')).n), 0);
    assert.equal(Number((await dbc.get('SELECT COUNT(*) AS n FROM train_alerts')).n), 0);
  });
});

describe('cron', () => {
  test('POST /cron/sync-trains : secret exigé ; requête conditionnelle (304 = rien à retélécharger)', async () => {
    assert.equal((await api.post('/cron/sync-trains')).status, 503); // CRON_SECRET absent
    process.env.CRON_SECRET = 'secret-cron';
    try {
      assert.equal((await api.post('/cron/sync-trains', { headers: { Authorization: 'Bearer faux' } })).status, 401);
      const auth = { headers: { Authorization: 'Bearer secret-cron' } };

      // Première synchronisation : nouvelle version téléchargée.
      sncf.gtfs = zipFiles(buildGtfs({ start: START, days: 40, variant: 'v2' }));
      provider.schedule.reset();
      await provider.schedule.load();
      assert.equal(provider.schedule.status().version, `${START}-v2`);

      // Puis rien n'a changé : 304, pas de nouveau téléchargement.
      const res = await api.post('/cron/sync-trains', auth);
      assert.equal(res.status, 200, res.text);
      assert.deepEqual(res.body.results[0], { provider: 'sncf', ok: true, updated: false, version: `${START}-v2` });
      assert.equal(sncf.calls.conditional, 1);

      // Nouvelle publication : téléchargée et installée.
      sncf.lastModified = 'Thu, 08 Oct 2026 08:00:00 GMT';
      sncf.gtfs = zipFiles(buildGtfs({ start: START, days: 40, variant: 'renumbered' }));
      const res2 = await api.post('/cron/sync-trains', auth);
      assert.equal(res2.body.results[0].updated, true);
      assert.equal(res2.body.results[0].version, `${START}-renumbered`);

      // Producteur injoignable : 502, l'ancienne version reste servie.
      sncf.lastModified = 'Fri, 09 Oct 2026 08:00:00 GMT';
      sncf.gtfs = null;
      const res3 = await api.post('/cron/sync-trains', auth);
      assert.equal(res3.status, 502);
      assert.equal(provider.schedule.status().version, `${START}-renumbered`);
    } finally {
      delete process.env.CRON_SECRET;
    }
  });

  test('/api/health expose l\'état du module Trains', async () => {
    const res = await api.get('/api/health');
    assert.equal(res.body.trains.providers[0].provider, 'sncf');
    assert.equal(res.body.trains.providers[0].schedule.loaded, true);
    assert.ok('alert_loop' in res.body.trains);
  });
});
