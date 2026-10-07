// Module Trains — voies (quais) via le flux SIRI Lite Estimated Timetable : lecture
// tolérante du XML, rattachement numéro de train + gare (UIC) + jour, lecture à la demande.
const { sncf, resetSncf, startServer, client } = require('./helpers');
const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { getProvider, trainsHealth } = require('../trains');
const { parseEstimatedTimetable, createParser, uicOf } = require('../trains/siri');
const { ST, buildGtfs, siriEtFeed, tripUpdatesFeed, alertsFeed, area, parisTime, LINES, tripId } = require('./trainsFixture');

const START = '2026-10-05';
const D = '2026-10-07';
const at = (hhmm) => parisTime(D, hhmm);
const LILLE = area('LILLE');
const AMIENS = area('AMIENS');
const T1 = tripId('843924', LINES.K44, 'LILLE', 'AMIENS', '2026-11-03');
const ID = `${T1}|${D}|${LILLE}|${AMIENS}`;
const provider = getProvider();
const svc = provider.service;

/** Le 16:53 Lille Flandres → Amiens (843924) : voie 4 au départ, 2 à Arras, 1 à l'arrivée. */
const k44 = (over = {}) => ({
  number: '843924', frameDate: D,
  calls: [
    { uic: ST.LILLE.uic, aimedDep: at('16:53'), dep: '4' },
    { uic: ST.DOUAI.uic, aimedArr: at('17:12'), aimedDep: at('17:14') },
    { uic: ST.ARRAS.uic, aimedArr: at('17:27'), aimedDep: at('17:29'), arr: '2', dep: '2' },
    { uic: ST.ALBERT.uic, aimedArr: at('17:55'), aimedDep: at('17:56') },
    { uic: ST.AMIENS.uic, aimedArr: at('18:10'), arr: '1' },
  ],
  ...over,
});

describe('lecture du flux SIRI Lite ET', () => {
  test('index numéro | UIC | jour → voies ; trajets comptés, voies absentes ignorées', () => {
    const { index, stats } = parseEstimatedTimetable(siriEtFeed([k44(), { number: '848908', frameDate: D, calls: [{ uic: ST.LILLE.uic, aimedDep: at('17:53') }] }]));
    assert.equal(stats.journeys, 2);
    assert.equal(stats.calls, 6);
    assert.equal(stats.depPlatforms, 2);
    assert.equal(stats.arrPlatforms, 2);
    assert.deepEqual(index.get(`843924|${ST.LILLE.uic}|${D}`), { dep: '4', arr: null });
    assert.deepEqual(index.get(`843924|${ST.ARRAS.uic}|${D}`), { dep: '2', arr: '2' });
    assert.deepEqual(index.get(`843924|${ST.AMIENS.uic}|${D}`), { dep: null, arr: '1' });
    assert.equal(index.has(`843924|${ST.DOUAI.uic}|${D}`), false);
    assert.equal(index.has(`848908|${ST.LILLE.uic}|${D}`), false);
  });

  test('préfixe d\'espace de noms, passages déjà effectués (RecordedCall), zéros de tête', () => {
    const feed = siriEtFeed([k44({ number: '0843924', calls: [{ uic: ST.LILLE.uic, aimedDep: at('16:53'), dep: '4', recorded: true }] })], { prefix: 'siri:' });
    const { index } = parseEstimatedTimetable(feed);
    assert.deepEqual(index.get(`843924|${ST.LILLE.uic}|${D}`), { dep: '4', arr: null });
  });

  test('sans TrainNumberRef : numéro lu dans la référence du trajet', () => {
    const { index } = parseEstimatedTimetable(siriEtFeed([k44({ numberTag: false, datedRef: 'SNCF:VehicleJourney::843924_F:LOC' })]));
    assert.deepEqual(index.get(`843924|${ST.LILLE.uic}|${D}`), { dep: '4', arr: null });
  });

  test('lecture incrémentale : document découpé n\'importe où', () => {
    const xml = siriEtFeed([k44(), k44({ number: '843998', calls: [{ uic: ST.LILLE.uic, aimedDep: at('23:50'), dep: '7' }] })]);
    const p = createParser({ inventory: true });
    for (let i = 0; i < xml.length; i += 37) p.push(xml.slice(i, i + 37));
    const { index, stats } = p.done();
    assert.equal(stats.journeys, 2);
    assert.equal(index.get(`843998|${ST.LILLE.uic}|${D}`).dep, '7');
    assert.ok(stats.tags.get('DeparturePlatformName') >= 3);
  });

  test('code UIC d\'une référence d\'arrêt', () => {
    assert.equal(uicOf('FR:ScheduledStopPoint::87313874:'), '87313874');
    assert.equal(uicOf('StopPoint:OCETrain TER-87286005'), '87286005');
    assert.equal(uicOf('inconnu'), null);
  });
});

describe('voies dans les trajets', () => {
  const NOW = at('16:30');
  beforeEach(async () => {
    resetSncf();
    await provider.schedule.loadFiles(buildGtfs({ start: START, days: 30 }));
    sncf.tripUpdates = tripUpdatesFeed([], NOW);
    sncf.alerts = alertsFeed([], NOW);
  });

  test('détail d\'un train proche : voie de départ, d\'arrivée et de chaque arrêt', async () => {
    sncf.siri = siriEtFeed([k44()]);
    const { journey: j } = await svc.getJourney(ID, { now: NOW });
    assert.equal(j.departurePlatform, '4');
    assert.equal(j.arrivalPlatform, '1');
    assert.deepEqual(j.stops.map((s) => s.platform), ['4', null, '2', null, '1']);
    assert.equal(sncf.calls.siri, 1);
  });

  test('recherche : voies des trains proches seulement, flux lu une fois (cache)', async () => {
    sncf.siri = siriEtFeed([k44()]);
    const r = await svc.searchJourneys({ from: LILLE, to: AMIENS, date: D }, { now: NOW });
    const byNum = Object.fromEntries(r.journeys.map((j) => [j.trainNumber, j.departurePlatform]));
    assert.deepEqual(byNum, { 843924: '4', 848908: null, 843990: null, 843998: null });
    await svc.searchJourneys({ from: LILLE, to: AMIENS, date: D }, { now: NOW });
    assert.equal(sncf.calls.siri, 1);
  });

  test('train lointain (demain, ou ce soir consulté le matin) : flux non téléchargé', async () => {
    sncf.siri = siriEtFeed([k44()]);
    const { journey: j } = await svc.getJourney(ID, { now: at('09:00') });
    assert.equal(j.departurePlatform, null);
    assert.equal(sncf.calls.siri, 0);
  });

  test('flux en panne : pas de voie, pas d\'erreur ; santé renseignée', async () => {
    const { journey: j } = await svc.getJourney(ID, { now: NOW });
    assert.equal(j.departurePlatform, null);
    assert.deepEqual(j.stops.map((s) => s.platform), [null, null, null, null, null]);
    const h = trainsHealth().find((x) => x.provider === 'sncf').platforms;
    assert.equal(h.upstream_ok, false);
  });

  test('autre jour (même numéro) : la voie d\'hier n\'est pas reprise', async () => {
    sncf.siri = siriEtFeed([k44({ calls: [{ uic: ST.LILLE.uic, aimedDep: parisTime('2026-10-06', '16:53'), dep: '9' }] })]);
    const { journey: j } = await svc.getJourney(ID, { now: NOW });
    assert.equal(j.departurePlatform, null);
  });

  test('Mes trajets : voie de la prochaine circulation', async () => {
    sncf.siri = siriEtFeed([k44()]);
    const fav = svc.favoriteFromJourney(ID);
    const { occurrences } = await svc.nextOccurrences(fav, { now: NOW });
    assert.equal(occurrences[0].departurePlatform, '4');
  });
});

describe('API', () => {
  let srv;
  let api;
  before(async () => { srv = await startServer(); api = client(srv.url); });
  after(() => srv.close());

  test('GET /api/trains/journey : champs de voie toujours présents (null si inconnue)', async () => {
    resetSncf();
    await provider.schedule.loadFiles(buildGtfs({ start: START, days: 30 }));
    const res = await api.get(`/api/trains/journey?id=${encodeURIComponent(ID)}`);
    assert.equal(res.status, 200, res.text);
    assert.ok('departurePlatform' in res.body.journey);
    assert.ok(res.body.journey.stops.every((s) => 'platform' in s));
  });
});
