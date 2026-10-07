// Module Trains — couche métier : recherche, fusion théorique + temps réel, favoris.
// Données SNCF simulées (aucun réseau) ; `now` injecté.
const { sncf, resetSncf } = require('./helpers');
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { getProvider } = require('../trains');
const { buildGtfs, tripUpdatesFeed, alertsFeed, area, point, LINES, parisTime, tripId } = require('./trainsFixture');

const START = '2026-10-05';        // lundi
const D = '2026-10-07';            // mercredi
const NOW = parisTime(D, '16:30'); // 30 min avant le 16:53
const T1 = tripId('843924', LINES.K44, 'LILLE', 'AMIENS', '2026-11-03');
const LILLE = area('LILLE');
const AMIENS = area('AMIENS');

const provider = getProvider();
const svc = provider.service;

async function load(variant = 'v1') {
  await provider.schedule.loadFiles(buildGtfs({ start: START, days: 30, variant }));
}

/** Temps réel publié « maintenant » (horodatage du flux = NOW sauf mention). */
function realtime(updates = [], alerts = [], ts = NOW) {
  sncf.tripUpdates = tripUpdatesFeed(updates, ts);
  sncf.alerts = alertsFeed(alerts, ts);
}

const search = (params, opts = {}) => svc.searchJourneys({ date: D, ...params }, { now: NOW, ...opts });
const hhmm = (iso) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

beforeEach(async () => {
  resetSncf();
  await load();
});

describe('référentiel', () => {
  test('autocomplétion des gares (sans accents, gares desservies seulement)', () => {
    assert.deepEqual(svc.searchStations('lille').map((s) => s.name), ['Lille Flandres']);
    assert.deepEqual(svc.searchStations('AMI').map((s) => s.id), [AMIENS]);
    assert.deepEqual(svc.searchStations('valence').map((s) => s.name), ['Valence Ville']);
    assert.deepEqual(svc.searchStations('inconnue'), []);
  });

  test('« K44 » : les deux lignes homonymes, distinguées par leur nom long', () => {
    const lines = svc.searchLines('k44');
    assert.deepEqual(lines.map((l) => l.longName).sort(), ['Lille Flandres - Amiens', 'Lyon Perrache - Valence']);
    assert.ok(lines.every((l) => l.name === 'K44' && l.color === 'BF005F'));
  });
});

describe('recherche', () => {
  test('Lille → Amiens : tous les trains du jour, triés par départ (K44, K45, car, nuit)', async () => {
    const r = await search({ from: LILLE, to: AMIENS });
    assert.deepEqual(r.journeys.map((j) => [j.lineName, j.trainNumber, hhmm(j.scheduledDeparture), hhmm(j.scheduledArrival), j.mode]), [
      ['K44', '843924', '16:53', '18:10', 'train'],
      ['K45', '848908', '17:53', '19:10', 'train'],
      ['K44', '843990', '21:00', '22:30', 'car'],
      ['K44', '843998', '23:50', '00:55', 'train'],
    ]);
    const j = r.journeys[0];
    assert.equal(j.departureStation.name, 'Lille Flandres');
    assert.equal(j.arrivalStation.name, 'Amiens');
    assert.equal(j.brand, 'TER');
    assert.equal(j.lineId, LINES.K44);
    assert.equal(r.coverage.from, START);
  });

  test('Amiens → Lille (sens inverse) : uniquement les trains dans ce sens', async () => {
    const r = await search({ from: AMIENS, to: LILLE });
    assert.deepEqual(r.journeys.map((j) => j.trainNumber), ['843925']);
  });

  test('Lille → Amiens + K44 : filtre par ligne (nom court)', async () => {
    const r = await search({ from: LILLE, to: AMIENS, line: 'K44' });
    assert.deepEqual(r.journeys.map((j) => j.trainNumber), ['843924', '843990', '843998']);
  });

  test('ligne K44 seule : les trajets de la journée, des deux lignes homonymes', async () => {
    const r = await search({ line: 'k44' });
    assert.deepEqual(r.journeys.map((j) => j.trainNumber).sort(), ['843924', '843925', '843990', '843998', '886000']);
    assert.equal(r.lines.length, 2);
    // Ligne choisie par identifiant : la seule K44 des Hauts-de-France.
    const precise = await search({ line: LINES.K44 });
    assert.deepEqual(precise.journeys.map((j) => j.trainNumber).sort(), ['843924', '843925', '843990', '843998']);
    const lyon = precise.journeys.find((j) => j.trainNumber === '843925');
    assert.equal(lyon.departureStation.name, 'Amiens');
    assert.equal(lyon.terminus, 'Lille Flandres');
  });

  test('heure de départ minimale', async () => {
    const r = await search({ from: LILLE, to: AMIENS, after: '18:00' });
    assert.deepEqual(r.journeys.map((j) => j.trainNumber), ['843990', '843998']);
  });

  test('samedi : le train de semaine ne circule pas', async () => {
    const r = await search({ from: LILLE, to: AMIENS, date: '2026-10-10' }, { now: parisTime('2026-10-10', '08:00') });
    assert.ok(!r.journeys.some((j) => j.trainNumber === '843924'));
  });

  test('passage après minuit : rattaché au jour calendaire du départ', async () => {
    // Le train de nuit du 7 passe à Arras à 00:21 le 8.
    const r = await search({ from: area('ARRAS'), to: AMIENS, date: '2026-10-08' }, { now: parisTime('2026-10-08', '00:00') });
    const night = r.journeys.find((j) => j.trainNumber === '843998');
    assert.equal(night.serviceDate, D);
    assert.equal(hhmm(night.scheduledDeparture), '00:21');
  });

  test('gare inconnue, ligne inconnue, gares identiques, aucun critère', async () => {
    await assert.rejects(search({ from: 'StopArea:OCE00000000', to: AMIENS }), (e) => e.status === 404 && /Gare inconnue/.test(e.message));
    await assert.rejects(search({ line: 'Z99' }), (e) => e.status === 404 && /Ligne inconnue/.test(e.message));
    await assert.rejects(search({ from: LILLE, to: LILLE }), (e) => e.status === 400);
    await assert.rejects(search({}), (e) => e.status === 400);
  });

  test('trajet inexistant (Lyon → Amiens) : liste vide', async () => {
    const r = await search({ from: area('LYON'), to: AMIENS });
    assert.deepEqual(r.journeys, []);
  });

  test('date hors période de validité (passée ou future lointaine) : vide et signalé, sans appel temps réel', async () => {
    const past = await search({ from: LILLE, to: AMIENS, date: '2026-09-01' });
    assert.equal(past.journeys.length, 0);
    assert.equal(past.outOfCoverage, true);
    const future = await search({ from: LILLE, to: AMIENS, date: '2027-06-01' });
    assert.equal(future.outOfCoverage, true);
    assert.equal(sncf.calls.tripUpdates, 0);
  });

  test('date future dans la période : horaires théoriques, le temps réel n\'est pas interrogé', async () => {
    const r = await search({ from: LILLE, to: AMIENS, date: '2026-10-14' });
    assert.equal(r.journeys.length, 4);
    assert.equal(r.realtime.applicable, false);
    assert.ok(r.journeys.every((j) => j.status === 'scheduled'));
    assert.equal(sncf.calls.tripUpdates, 0);
  });

  test('horaires pas encore chargés : 503 explicite', async () => {
    provider.schedule.reset();
    await assert.rejects(search({ from: LILLE, to: AMIENS }), (e) => e.status === 503);
  });
});

describe('fusion théorique + temps réel', () => {
  const first = async () => (await search({ from: LILLE, to: AMIENS })).journeys[0];

  test('sans donnée temps réel (flux indisponible) : horaires théoriques, jamais « supprimé »', async () => {
    sncf.failRealtime = true;
    const r = await search({ from: LILLE, to: AMIENS });
    assert.equal(r.realtime.available, false);
    for (const j of r.journeys) {
      assert.equal(j.status, 'scheduled');
      assert.equal(j.cancellation, null);
      assert.equal(j.estimatedDeparture, null);
      assert.equal(j.departureDelay, null);
    }
  });

  test('train sans mise à jour alors que le flux fonctionne : théorique', async () => {
    realtime([]);
    const j = await first();
    assert.equal(j.realtime, false);
    assert.equal(j.status, 'scheduled');
  });

  test('retard au départ propagé jusqu\'à l\'arrivée (16:53 → 17:02, +9 min)', async () => {
    realtime([{ tripId: T1, startDate: D, stops: [{ seq: 0, dep: 540 }] }]);
    const r = await search({ from: LILLE, to: AMIENS });
    const j = r.journeys[0];
    assert.equal(r.realtime.available, true);
    assert.equal(r.realtime.age_s, 0);
    assert.equal(j.realtime, true);
    assert.equal(hhmm(j.estimatedDeparture), '17:02');
    assert.equal(j.departureDelay, 9);
    assert.equal(hhmm(j.estimatedArrival), '18:19');
    assert.equal(j.arrivalDelay, 9);
    assert.equal(j.status, 'delayed');
    assert.equal(j.phase, 'upcoming');
  });

  test('retard qui se résorbe en route : la dernière mise à jour fait foi pour la suite', async () => {
    realtime([{ tripId: T1, startDate: D, stops: [{ seq: 0, dep: 540 }, { seq: 2, arr: 300, dep: 120 }] }]);
    const j = await first();
    assert.equal(j.departureDelay, 9);
    assert.equal(j.arrivalDelay, 2);
  });

  test('retard qui disparaît : à l\'heure, heure estimée = heure prévue', async () => {
    realtime([{ tripId: T1, startDate: D, stops: [{ seq: 0, dep: 0 }] }]);
    const j = await first();
    assert.equal(j.status, 'on_time');
    assert.equal(j.departureDelay, 0);
    assert.equal(j.estimatedDeparture, j.scheduledDeparture);
  });

  test('heure absolue (time) plutôt que retard (delay)', async () => {
    realtime([{ tripId: T1, startDate: D, stops: [{ seq: 0, depTime: parisTime(D, '17:05') }] }]);
    const j = await first();
    assert.equal(j.departureDelay, 12);
  });

  test('identifiant interne SNCF (OCESN…F) + start_date', async () => {
    realtime([{ tripId: 'OCESN843924F', startDate: D, delay: 300 }]);
    const j = await first();
    assert.equal(j.departureDelay, 5);
  });

  test('sans start_date : jour de service déduit de l\'horodatage du flux', async () => {
    realtime([{ tripId: T1, stops: [{ seq: 0, dep: 180 }] }]);
    assert.equal((await first()).departureDelay, 3);
  });

  test('mise à jour pour un autre jour : sans effet sur celui-ci', async () => {
    realtime([{ tripId: T1, startDate: '2026-10-08', stops: [{ seq: 0, dep: 600 }] }]);
    assert.equal((await first()).realtime, false);
  });

  test('train supprimé', async () => {
    realtime([{ tripId: 'OCESN843924F', startDate: D, relationship: 'CANCELED' }]);
    const j = await first();
    assert.equal(j.status, 'cancelled');
    assert.deepEqual(j.cancellation, { partial: false, reason: 'Train supprimé' });
    assert.equal(j.estimatedDeparture, null);
    assert.equal(j.phase, null);
  });

  test('arrêt de départ supprimé : suppression partielle pour ce trajet', async () => {
    realtime([{ tripId: T1, startDate: D, stops: [{ seq: 0, skipped: true }, { seq: 1, dep: 0 }] }]);
    const j = await first();
    assert.equal(j.status, 'cancelled');
    assert.equal(j.cancellation.partial, true);
    assert.match(j.cancellation.reason, /Lille Flandres/);
    // Douai → Amiens reste assuré.
    const fromDouai = (await search({ from: area('DOUAI'), to: AMIENS })).journeys[0];
    assert.equal(fromDouai.status, 'on_time');
  });

  test('train ajouté (ADDED) absent du théorique : ignoré sans erreur', async () => {
    realtime([{ tripId: 'OCESNDTS107F', startDate: D, relationship: 'ADDED', delay: 0 }]);
    const r = await search({ from: LILLE, to: AMIENS });
    assert.equal(r.journeys.length, 4);
  });

  test('temps réel trop ancien (> 10 min) : ignoré, horaires théoriques', async () => {
    realtime([{ tripId: T1, startDate: D, stops: [{ seq: 0, dep: 540 }] }], [], NOW - 20 * 60_000);
    const r = await search({ from: LILLE, to: AMIENS });
    assert.equal(r.realtime.available, false);
    assert.equal(r.journeys[0].status, 'scheduled');
  });

  test('train déjà parti puis arrivé (phase)', async () => {
    realtime([{ tripId: T1, startDate: D, stops: [{ seq: 0, dep: 0 }] }], [], parisTime(D, '17:30'));
    const enRoute = (await svc.searchJourneys({ from: LILLE, to: AMIENS, date: D }, { now: parisTime(D, '17:30') })).journeys[0];
    assert.equal(enRoute.phase, 'en_route');
    realtime([], [], parisTime(D, '18:30'));
    const arrived = (await svc.searchJourneys({ from: LILLE, to: AMIENS, date: D }, { now: parisTime(D, '18:30') })).journeys[0];
    assert.equal(arrived.phase, 'arrived');
  });

  test('perturbations : ligne, train (alias), période ; gare hors trajet ignorée', async () => {
    realtime([], [
      { id: 'L', header: 'Travaux sur la ligne', routeId: LINES.K44, effect: 'REDUCED_SERVICE' },
      { id: 'T', header: 'Train retardé', tripId: 'OCESN843924F', effect: 'SIGNIFICANT_DELAYS' },
      { id: 'OLD', header: 'Hier', routeId: LINES.K44, start: parisTime('2026-10-06', '08:00'), end: parisTime('2026-10-06', '20:00') },
      { id: 'LYON', header: 'Ailleurs', stopId: point('LYON') },
    ]);
    const j = await first();
    assert.deepEqual(j.alerts.map((a) => [a.id, a.scope]), [['T', 'trip'], ['L', 'line']]);
    assert.equal(j.disrupted, true);
    assert.equal(j.alerts[1].header, 'Travaux sur la ligne');
    // Le K45 n'est concerné par aucune.
    const k45 = (await search({ from: LILLE, to: AMIENS })).journeys[1];
    assert.deepEqual(k45.alerts, []);
  });

  test('détail : tous les arrêts avec estimations, arrêts du trajet marqués', async () => {
    realtime([{ tripId: T1, startDate: D, stops: [{ seq: 0, dep: 540 }] }]);
    const id = (await first()).id;
    const { journey } = await svc.getJourney(id, { now: NOW });
    assert.equal(journey.stops.length, 5);
    assert.equal(journey.stops[2].station.name, 'Arras');
    assert.equal(journey.stops[2].delay, 9);
    assert.ok(journey.stops.every((s) => s.inJourney));
    // Trajet partiel Douai → Arras : arrêts hors trajet marqués.
    const partial = (await search({ from: area('DOUAI'), to: area('ARRAS') })).journeys[0];
    const detail = (await svc.getJourney(partial.id, { now: NOW })).journey;
    assert.deepEqual(detail.stops.map((s) => s.inJourney), [false, true, true, false, false]);
  });

  test('identifiant de trajet inconnu ou invalide', async () => {
    await assert.rejects(svc.getJourney(`inconnu|${D}|${LILLE}|${AMIENS}`), (e) => e.status === 404);
    await assert.rejects(svc.getJourney('nimporte-quoi'), (e) => e.status === 400);
    await assert.rejects(svc.getJourney(`${T1}|2026-10-10|${LILLE}|${AMIENS}`), (e) => e.status === 404 && /ne circule pas/.test(e.message));
  });
});

describe('favoris : retrouver le trajet d\'une version du GTFS à l\'autre', () => {
  async function favorite() {
    const j = (await search({ from: LILLE, to: AMIENS })).journeys[0];
    return svc.favoriteFromJourney(j.id);
  }

  test('le favori conserve gares, ligne, numéro et heure théorique (pas seulement « K44 »)', async () => {
    const fav = await favorite();
    assert.deepEqual(
      { ...fav, trip_id: undefined },
      {
        provider: 'sncf', train_number: '843924', line_id: LINES.K44, line_name: 'K44', line_long_name: 'Lille Flandres - Amiens',
        origin_id: LILLE, origin_name: 'Lille Flandres', destination_id: AMIENS, destination_name: 'Amiens',
        departure_time: '16:53', arrival_time: '18:10', trip_id: undefined,
      },
    );
  });

  test('prochaines occurrences : jours ouvrés uniquement, à partir d\'aujourd\'hui', async () => {
    const fav = await favorite();
    const { occurrences } = await svc.nextOccurrences(fav, { now: parisTime('2026-10-09', '19:00') }); // vendredi soir
    assert.deepEqual(occurrences.map((o) => o.serviceDate), ['2026-10-12', '2026-10-13', '2026-10-14']);
    assert.ok(occurrences.every((o) => o.match === 'exact' && !o.scheduleChanged));
  });

  test('nouvelle version du GTFS (trip_id changés, horaire décalé à 16:55) : retrouvé par numéro', async () => {
    const fav = await favorite();
    await load('v2');
    const index = provider.schedule.getIndex();
    assert.ok(!index.trips.index.has(fav.trip_id)); // l'ancien identifiant n'existe plus
    const { occurrences } = await svc.nextOccurrences(fav, { now: NOW });
    assert.equal(occurrences[0].match, 'exact');
    assert.equal(occurrences[0].scheduleChanged, true);
    assert.equal(hhmm(occurrences[0].scheduledDeparture), '16:55');
  });

  test('train renuméroté : retrouvé par gares + ligne + heure (approché)', async () => {
    const fav = await favorite();
    await load('renumbered');
    const { occurrences } = await svc.nextOccurrences(fav, { now: NOW });
    assert.equal(occurrences[0].trainNumber, '843950');
    assert.equal(occurrences[0].match, 'approx');
  });

  test('gare disparue du référentiel : aucune occurrence, pas d\'erreur', async () => {
    const fav = { ...(await favorite()), origin_id: 'StopArea:OCE00000000' };
    const { occurrences } = await svc.nextOccurrences(fav, { now: NOW });
    assert.deepEqual(occurrences, []);
  });
});
