// Tests unitaires des fonctions pures (aucun accès réseau ; la base n'est pas utilisée).
require('./helpers');
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { validateAlertPayload } = require('../routes/alerts');
const { mergeWithStatus } = require('../routes/stations');
const {
  countForType, docksOf, evaluateAlert, buildMessage, buildPayload, buildSummaryPayload, isSummaryDue,
  findFallback, fallbacksFor, inWindow, nowInTz,
} = require('../push');
const { distanceKm, fmtDistance } = require('../geo');
const { addDays } = require('../time');
const { normalizeRentalApps } = require('../rentalApps');
const { toPg } = require('../database/postgres');

const validAlert = {
  station_id: '12', station_name: 'Gare', bike_type: 'ebike',
  threshold: 3, time_start: '08:00', time_end: '09:30', days: '1,2,3',
};
const TODAY = '2025-09-24';
const v = (body, opts) => validateAlertPayload(body, { today: TODAY, ...opts });

describe('validateAlertPayload — création', () => {
  test('payload complet valide + valeurs par défaut du modèle', () => {
    const { fields, errors } = v(validAlert);
    assert.deepEqual(errors, []);
    assert.deepEqual(fields, {
      ...validAlert, target: 'bikes', comparison: 'at_most', valid_on: null, active: 1,
      arrival_station_id: null, arrival_station_name: null, arrival_threshold: null,
      group_name: null, group_stations: null, kind: 'threshold',
    });
  });

  test('défauts : seuil 1, tous les jours, type any', () => {
    const { threshold, days, bike_type, ...rest } = validAlert;
    const { fields, errors } = v(rest);
    assert.deepEqual(errors, []);
    assert.equal(fields.threshold, 1);
    assert.equal(fields.days, '1,2,3,4,5,6,7');
    assert.equal(fields.bike_type, 'any');
  });

  test('ancien nom min_count accepté', () => {
    const { threshold, ...rest } = validAlert;
    assert.equal(v({ ...rest, min_count: 4 }).fields.threshold, 4);
  });

  test('jours dédoublonnés et triés', () => {
    assert.equal(v({ ...validAlert, days: '7,1,3,1' }).fields.days, '1,3,7');
  });

  test('champs obligatoires manquants', () => {
    const { errors } = v({});
    for (const f of ['station_id', 'station_name', 'time_start', 'time_end']) {
      assert.ok(errors.some((e) => e.startsWith(f)), `erreur attendue pour ${f}`);
    }
  });

  test('valeurs énumérées inconnues refusées', () => {
    assert.ok(v({ ...validAlert, bike_type: 'trottinette' }).errors.length);
    assert.ok(v({ ...validAlert, target: 'parking' }).errors.length);
    assert.ok(v({ ...validAlert, comparison: 'egal' }).errors.length);
  });

  test('heures invalides refusées', () => {
    for (const t of ['24:00', '8:00', '08:60', 'abc', '']) {
      assert.ok(v({ ...validAlert, time_start: t }).errors.includes('time_start (HH:MM)'), t);
    }
  });

  test('seuil : 0 permis en « au plus », interdit en « au moins »', () => {
    assert.equal(v({ ...validAlert, threshold: 0 }).fields.threshold, 0);
    assert.ok(v({ ...validAlert, threshold: 0, comparison: 'at_least' }).errors.length);
    assert.ok(v({ ...validAlert, threshold: 51 }).errors.length);
    assert.ok(v({ ...validAlert, threshold: 1.5 }).errors.length);
  });

  test('places libres : le type de vélo est ignoré', () => {
    assert.equal(v({ ...validAlert, target: 'docks' }).fields.bike_type, 'any');
  });

  test('chaînes trop longues refusées', () => {
    assert.ok(v({ ...validAlert, station_id: 'x'.repeat(65) }).errors.includes('station_id'));
    assert.ok(v({ ...validAlert, station_name: 'x'.repeat(129) }).errors.includes('station_name'));
  });

  test('active converti en 0/1', () => {
    assert.equal(v({ ...validAlert, active: false }).fields.active, 0);
    assert.equal(v({ ...validAlert, active: true }).fields.active, 1);
  });
});

describe('validateAlertPayload — trajet', () => {
  const trip = { ...validAlert, arrival_station_id: '40', arrival_station_name: 'Zoo', arrival_threshold: 2 };

  test('trajet valide', () => {
    const { fields, errors } = v(trip);
    assert.deepEqual(errors, []);
    assert.equal(fields.arrival_station_id, '40');
    assert.equal(fields.arrival_threshold, 2);
  });
  test('seuil d\'arrivée par défaut : 1 place', () => {
    const { arrival_threshold, ...rest } = trip;
    assert.equal(v(rest).fields.arrival_threshold, 1);
  });
  test('arrivée = départ refusée', () => {
    assert.ok(v({ ...trip, arrival_station_id: '12' }).errors.length);
  });
  test('nom d\'arrivée obligatoire', () => {
    assert.ok(v({ ...trip, arrival_station_name: '' }).errors.includes('arrival_station_name'));
  });
  test('uniquement en mode vélos / au plus', () => {
    assert.ok(v({ ...trip, target: 'docks' }).errors.length);
    assert.ok(v({ ...trip, comparison: 'at_least' }).errors.length);
  });
});

describe('validateAlertPayload — groupe de stations', () => {
  const trio = [
    { station_id: '1', station_name: 'Gare' },
    { station_id: '2', station_name: 'Cathédrale' },
    { station_id: '3', station_name: 'Beffroi' },
  ];
  const { station_id, station_name, ...noStation } = validAlert;
  const group = { ...noStation, group_stations: trio, group_name: '  Maison ' };

  test('groupe valide : 1re station recopiée, nom nettoyé', () => {
    const { fields, errors } = v(group);
    assert.deepEqual(errors, []);
    assert.deepEqual(fields.group_stations, trio);
    assert.equal(fields.group_name, 'Maison');
    assert.equal(fields.station_id, '1');
    assert.equal(fields.station_name, 'Gare');
  });
  test('nom facultatif (vide → null)', () => {
    assert.equal(v({ ...group, group_name: '' }).fields.group_name, null);
    assert.equal(v({ ...group, group_name: undefined }).fields.group_name, null);
  });
  test('nom trop long refusé', () => {
    assert.ok(v({ ...group, group_name: 'x'.repeat(41) }).errors.length);
  });
  test('de 2 à 5 stations distinctes', () => {
    assert.ok(v({ ...group, group_stations: trio.slice(0, 1) }).errors.length);
    const six = Array.from({ length: 6 }, (_, i) => ({ station_id: String(i), station_name: `S${i}` }));
    assert.ok(v({ ...group, group_stations: six }).errors.length);
    assert.ok(v({ ...group, group_stations: [trio[0], trio[0]] }).errors.length);
    assert.ok(v({ ...group, group_stations: [trio[0], { station_id: '2' }] }).errors.length);
    assert.ok(v({ ...group, group_stations: 'Gare' }).errors.length);
  });
  test('places libres et « au moins N » acceptés', () => {
    assert.deepEqual(v({ ...group, target: 'docks', comparison: 'at_least' }).errors, []);
  });
  test('incompatible avec un trajet', () => {
    const errors = v({ ...group, arrival_station_id: '40', arrival_station_name: 'Zoo' }).errors;
    assert.ok(errors.includes('trajet : impossible pour un groupe de stations'));
  });
  test('sans groupe, le nom est ignoré', () => {
    assert.equal(v({ ...validAlert, group_name: 'Maison' }).fields.group_name, null);
  });
  test('PATCH : le groupe existant est conservé, group_stations: null repasse en simple', () => {
    const current = { ...v(group).fields, id: 1 };
    assert.deepEqual(v({ threshold: 0 }, { current }).fields.group_stations, trio);
    const single = v({ group_stations: null, station_id: '9', station_name: 'Zoo' }, { current }).fields;
    assert.equal(single.group_stations, null);
    assert.equal(single.group_name, null);
    assert.equal(single.station_id, '9');
  });
});

describe('validateAlertPayload — résumé à heure fixe', () => {
  const gare = { station_id: '1', station_name: 'Gare' };
  const summary = { kind: 'summary', group_stations: [gare], bike_type: 'ebike', time_start: '08:00', days: '1,2,3,4,5' };

  test('résumé valide : une seule station suffit, champs de seuil neutralisés', () => {
    const { fields, errors } = v({ ...summary, threshold: 9, comparison: 'at_least', target: 'docks', time_end: '12:00',
      arrival_station_id: '2', arrival_station_name: 'Zoo', valid_on: TODAY });
    assert.deepEqual(errors, []);
    assert.deepEqual(fields, {
      kind: 'summary', group_stations: [gare], group_name: null, station_id: '1', station_name: 'Gare',
      target: 'bikes', comparison: 'at_most', threshold: 0, bike_type: 'ebike',
      arrival_station_id: null, arrival_station_name: null, arrival_threshold: null, valid_on: null,
      time_start: '08:00', time_end: '08:00', days: '1,2,3,4,5', active: 1,
    });
  });
  test('stations obligatoires (1 à 5)', () => {
    assert.ok(v({ ...summary, group_stations: undefined, station_id: '1', station_name: 'Gare' }).errors.length);
    assert.ok(v({ ...summary, group_stations: [] }).errors.length);
  });
  test('heure et type de vélo validés', () => {
    assert.ok(v({ ...summary, time_start: '8h' }).errors.includes('time_start (HH:MM)'));
    assert.ok(v({ ...summary, bike_type: 'tandem' }).errors.length);
  });
  test('type inconnu refusé', () => {
    assert.deepEqual(v({ ...validAlert, kind: 'hebdo' }).errors, ['kind (threshold|summary)']);
  });
  test('PATCH : un résumé repasse en alerte (règles de l\'alerte revalidées)', () => {
    const current = { ...v(summary).fields, id: 1 };
    assert.equal(v({ active: false }, { current }).fields.kind, 'summary');
    // Retour en alerte avec 1 seule station dans le groupe : refusé (il en faut 2).
    assert.ok(v({ kind: 'threshold' }, { current }).errors.length);
    const back = v({ kind: 'threshold', group_stations: null, time_end: '09:00' }, { current });
    assert.deepEqual(back.errors, []);
    assert.equal(back.fields.station_id, '1');
  });
});

describe('résumé : échéance et contenu', () => {
  const alert = { kind: 'summary', time_start: '08:00', days: '1,2,3', last_notified_date: null };
  const at = (hhmm, isoDay = 3, date = '2025-09-24') => ({ hhmm, isoDay, date });

  test('envoyé de l\'heure choisie à +15 min, une fois par jour, les bons jours', () => {
    assert.equal(isSummaryDue(alert, at('07:59')), false);
    assert.equal(isSummaryDue(alert, at('08:00')), true);
    assert.equal(isSummaryDue(alert, at('08:15')), true);
    assert.equal(isSummaryDue(alert, at('08:16')), false);
    assert.equal(isSummaryDue(alert, at('08:00', 4)), false);
    assert.equal(isSummaryDue({ ...alert, last_notified_date: '2025-09-24' }, at('08:05')), false);
    assert.equal(isSummaryDue({ ...alert, last_notified_date: '2025-09-23' }, at('08:05')), true);
  });

  const statusMap = {
    '1': { num_bikes_available: 3, vehicle_types_available: [{ vehicle_type_id: 'mechanical', count: 2 }, { vehicle_type_id: 'electrical', count: 1 }] },
    '2': { num_bikes_available: 4, is_renting: false },
  };
  const summary = {
    kind: 'summary', station_id: '1', bike_type: 'any', group_name: 'Maison',
    group_stations: [{ station_id: '1', station_name: 'Gare' }, { station_id: '2', station_name: 'Zoo' }, { station_id: '3', station_name: 'Cirque' }],
  };

  test('les deux types : détail méca / élec, stations fermées signalées', () => {
    const p = buildSummaryPayload(summary, statusMap);
    assert.equal(p.title, '📊 Maison — vélos');
    assert.equal(p.body, 'Gare : 2 méca · 1 élec\nZoo : indisponible\nCirque : indisponible');
    assert.match(p.url, /^https:\/\/.+\/open\?url=/);
  });
  test('un seul type, sans nom de groupe', () => {
    const p = buildSummaryPayload({ ...summary, group_name: null, bike_type: 'ebike', group_stations: summary.group_stations.slice(0, 1) }, statusMap);
    assert.equal(p.title, '📊 Vos stations — vélos électriques');
    assert.equal(p.body, 'Gare : 1');
  });
});

describe('validateAlertPayload — ponctuelle', () => {
  test('date du jour ou future acceptée', () => {
    assert.equal(v({ ...validAlert, valid_on: TODAY }).fields.valid_on, TODAY);
    assert.equal(v({ ...validAlert, valid_on: '2025-09-30' }).fields.valid_on, '2025-09-30');
  });
  test('date passée ou mal formée refusée', () => {
    assert.ok(v({ ...validAlert, valid_on: '2025-09-23' }).errors.length);
    assert.ok(v({ ...validAlert, valid_on: '24/09/2025' }).errors.length);
  });
  test('valid_on vide → alerte récurrente', () => {
    assert.equal(v({ ...validAlert, valid_on: '' }).fields.valid_on, null);
  });
});

describe('validateAlertPayload — mise à jour (fusion avec l\'existant)', () => {
  const current = { id: 1, user_id: 1, ...validAlert, target: 'bikes', comparison: 'at_most', active: 1, days: '1,2,3' };

  test('seuls les champs fournis changent', () => {
    const { fields, errors } = v({ active: false }, { current });
    assert.deepEqual(errors, []);
    assert.equal(fields.active, 0);
    assert.equal(fields.threshold, 3);
    assert.equal(fields.station_id, '12');
  });

  test('champ fourni mais invalide = erreur', () => {
    assert.ok(v({ threshold: 99 }, { current }).errors.length);
    assert.ok(v({ days: '8' }, { current }).errors.length);
  });

  test('règles croisées revalidées après fusion', () => {
    // passer en « au moins » avec un seuil 0 existant → refus
    assert.ok(v({ comparison: 'at_least' }, { current: { ...current, threshold: 0 } }).errors.length);
  });

  test('une ponctuelle expirée reste modifiable (désactivation)', () => {
    const old = { ...current, valid_on: '2025-09-20' };
    assert.deepEqual(v({ active: false }, { current: old }).errors, []);
  });
});

describe('countForType (seam ebike ↔ electrical)', () => {
  const status = {
    num_bikes_available: 7,
    vehicle_types_available: [
      { vehicle_type_id: 'mechanical', count: 4 },
      { vehicle_type_id: 'electrical', count: 3 },
    ],
  };
  test('any → total', () => assert.equal(countForType(status, 'any'), 7));
  test('ebike → electrical', () => assert.equal(countForType(status, 'ebike'), 3));
  test('mechanical', () => assert.equal(countForType(status, 'mechanical'), 4));
  test('station absente → 0', () => assert.equal(countForType(undefined, 'any'), 0));
  test('type absent → 0', () => assert.equal(countForType({ vehicle_types_available: [] }, 'ebike'), 0));
});

describe('inWindow', () => {
  test('créneau simple, bornes incluses', () => {
    assert.ok(inWindow('08:00', '08:00', '09:00'));
    assert.ok(inWindow('09:00', '08:00', '09:00'));
    assert.ok(!inWindow('09:01', '08:00', '09:00'));
  });
  test('créneau passant minuit', () => {
    assert.ok(inWindow('23:30', '22:00', '02:00'));
    assert.ok(inWindow('01:00', '22:00', '02:00'));
    assert.ok(!inWindow('12:00', '22:00', '02:00'));
  });
});

describe('nowInTz (Europe/Paris)', () => {
  test('heure d\'été : UTC+2', () => {
    // Mercredi 24/09/2025 06:30 UTC → 08:30 à Paris
    assert.deepEqual(nowInTz(new Date('2025-09-24T06:30:00Z')), { hhmm: '08:30', isoDay: 3, date: '2025-09-24' });
  });
  test('heure d\'hiver : UTC+1', () => {
    assert.equal(nowInTz(new Date('2025-01-15T07:00:00Z')).hhmm, '08:00');
  });
  test('changement de jour : dimanche 23:30 UTC → lundi à Paris', () => {
    assert.deepEqual(nowInTz(new Date('2025-09-28T23:30:00Z')), { hhmm: '01:30', isoDay: 1, date: '2025-09-29' });
  });
  test('minuit rendu 00 et non 24', () => {
    assert.equal(nowInTz(new Date('2025-09-24T22:00:00Z')).hhmm, '00:00');
  });
});

describe('docksOf / countForType — stations fermées', () => {
  test('station qui ne loue pas → 0 vélo', () => {
    assert.equal(countForType({ is_renting: false, num_bikes_available: 8 }, 'any'), 0);
  });
  test('places libres, et 0 si la station ne reprend pas les vélos', () => {
    assert.equal(docksOf({ num_docks_available: 4 }), 4);
    assert.equal(docksOf({ is_returning: false, num_docks_available: 4 }), 0);
    assert.equal(docksOf(undefined), 0);
  });
});

describe('evaluateAlert', () => {
  const statusMap = {
    '1': { num_bikes_available: 3, num_docks_available: 1, vehicle_types_available: [{ vehicle_type_id: 'electrical', count: 1 }] },
    '2': { num_bikes_available: 0, num_docks_available: 9 },
  };
  const base = { station_id: '1', bike_type: 'any', target: 'bikes', comparison: 'at_most', threshold: 2 };

  test('vélos au plus N', () => {
    assert.deepEqual(evaluateAlert(base, statusMap), { triggered: false, key: '3', count: 3, departureHit: false });
    assert.equal(evaluateAlert({ ...base, bike_type: 'ebike' }, statusMap).triggered, true);
  });
  test('vélos au moins N', () => {
    assert.equal(evaluateAlert({ ...base, comparison: 'at_least', threshold: 3 }, statusMap).triggered, true);
    assert.equal(evaluateAlert({ ...base, comparison: 'at_least', threshold: 4 }, statusMap).triggered, false);
  });
  test('places libres', () => {
    const ev = evaluateAlert({ ...base, target: 'docks', threshold: 1 }, statusMap);
    assert.equal(ev.triggered, true);
    assert.equal(ev.count, 1);
  });
  test('trajet : déclenché par le départ OU l\'arrivée, clé combinée', () => {
    const trip = { ...base, threshold: 0, arrival_station_id: '2', arrival_threshold: 1 };
    const ok = evaluateAlert(trip, statusMap);
    assert.equal(ok.triggered, false);
    assert.equal(ok.key, '3|9');
    const full = evaluateAlert(trip, { ...statusMap, '2': { num_docks_available: 1 } });
    assert.equal(full.triggered, true);
    assert.equal(full.arrivalHit, true);
    assert.equal(full.departureHit, false);
  });
});

describe('evaluateAlert — groupe de stations', () => {
  const statusMap = {
    '1': { num_bikes_available: 0, num_docks_available: 9 },
    '2': { num_bikes_available: 1, num_docks_available: 0 },
    '3': { num_bikes_available: 4, num_docks_available: 2, is_renting: false },
  };
  const group = {
    station_id: '1', bike_type: 'any', target: 'bikes', comparison: 'at_most', threshold: 1,
    group_stations: [{ station_id: '1' }, { station_id: '2' }, { station_id: '3' }],
  };

  test('« au plus N » : déclenche seulement si toutes les stations sont basses', () => {
    const ev = evaluateAlert(group, statusMap); // 3 fermée à la location → 0
    assert.deepEqual(ev, { triggered: true, key: '0|1|0', count: 1, counts: [0, 1, 0], departureHit: true });
    assert.equal(evaluateAlert(group, { ...statusMap, '3': { num_bikes_available: 4 } }).triggered, false);
  });
  test('« au moins N » : une station suffit', () => {
    const atLeast = { ...group, comparison: 'at_least', threshold: 5 };
    assert.equal(evaluateAlert({ ...atLeast, target: 'docks' }, statusMap).triggered, true);
    assert.equal(evaluateAlert(atLeast, statusMap).triggered, false);
  });
  test('station absente du flux = 0', () => {
    assert.deepEqual(evaluateAlert(group, {}).counts, [0, 0, 0]);
  });
});

describe('buildMessage / buildPayload', () => {
  const bikes = { station_id: '12', station_name: 'Gare', bike_type: 'ebike', target: 'bikes', comparison: 'at_most', threshold: 2 };
  const msg = (alert, ev) => buildMessage(alert, { count: 0, ...ev });

  test('URL https vers /open (exigence iOS)', () => {
    const p = buildPayload(bikes, { count: 2 });
    assert.match(p.url, /^https:\/\/.+\/open\?url=/);
    assert.equal(p.stationId, '12');
  });
  test('vélos : accords singulier / pluriel', () => {
    assert.equal(msg(bikes, { count: 2 }).body, '2 vélos électriques disponibles · Réservez vite');
    assert.equal(msg(bikes, { count: 1 }).body, '1 vélo électrique disponible · Réservez vite');
    assert.equal(msg({ ...bikes, bike_type: 'any' }, { count: 3 }).body, '3 vélos disponibles · Réservez vite');
  });
  test('vélos : 0 → avertissement', () => {
    const m = msg({ ...bikes, bike_type: 'mechanical' }, { count: 0 });
    assert.match(m.title, /^⚠️/);
    assert.equal(m.body, 'Plus aucun vélo mécanique disponible');
  });
  test('places', () => {
    const docks = { ...bikes, target: 'docks' };
    assert.equal(msg(docks, { count: 0 }).body, 'Plus aucune place libre pour déposer un vélo');
    assert.equal(msg(docks, { count: 2 }).body, 'Plus que 2 places libres · Pensez à une autre station');
  });
  test('au moins N', () => {
    const m = msg({ ...bikes, comparison: 'at_least' }, { count: 4 });
    assert.match(m.title, /^✅/);
    assert.equal(m.body, "4 vélos électriques disponibles · C'est le moment");
    assert.equal(msg({ ...bikes, target: 'docks', comparison: 'at_least' }, { count: 1 }).body, "1 place libre · C'est le moment");
  });
  test('trajet', () => {
    const trip = { ...bikes, bike_type: 'any', arrival_station_id: '40', arrival_station_name: 'Zoo' };
    const m = msg(trip, { count: 3, arrivalDocks: 0, departureHit: false, arrivalHit: true });
    assert.equal(m.title, '⚠️ Trajet Gare → Zoo');
    assert.equal(m.body, 'Départ Gare : 3 vélos · Arrivée Zoo : 0 place');
  });
  describe('groupe de stations', () => {
    const group = {
      ...bikes, bike_type: 'any', group_name: 'Maison',
      group_stations: [{ station_id: '1', station_name: 'Gare' }, { station_id: '2', station_name: 'Beffroi' }],
    };
    test('peu de vélos : détail par station', () => {
      const m = msg(group, { count: 1, counts: [0, 1] });
      assert.equal(m.title, 'Maison : peu de vélos');
      assert.equal(m.body, 'Gare : 0 · Beffroi : 1');
    });
    test('plus rien nulle part → avertissement', () => {
      assert.equal(msg({ ...group, bike_type: 'ebike' }, { count: 0, counts: [0, 0] }).title, '⚠️ Maison : plus aucun vélo électrique');
      assert.equal(msg({ ...group, target: 'docks' }, { count: 0, counts: [0, 0] }).title, '⚠️ Maison : plus aucune place libre');
    });
    test('au moins N / sans nom de groupe', () => {
      const m = msg({ ...group, group_name: null, comparison: 'at_least' }, { count: 5, counts: [5, 0] });
      assert.equal(m.title, '✅ Vos stations : vélos disponibles');
      assert.equal(msg({ ...group, target: 'docks', comparison: 'at_least' }, { count: 3, counts: [3, 3] }).title,
        '✅ Maison : places libres disponibles');
    });
  });
});

describe('addDays', () => {
  test('passage de mois et d\'année', () => {
    assert.equal(addDays('2025-01-31', 1), '2025-02-01');
    assert.equal(addDays('2025-12-31', 1), '2026-01-01');
    assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  });
});

describe('mergeWithStatus', () => {
  const stations = [{ station_id: '1', name: 'A', address: 'rue', lat: 1, lon: 2, capacity: 10 }];
  test('fusionne le statut live par type', () => {
    const [s] = mergeWithStatus(stations, [{
      station_id: '1', num_bikes_available: 5, num_docks_available: 5, num_bikes_disabled: 1,
      is_renting: true, is_returning: true, last_reported: 123,
      vehicle_types_available: [{ vehicle_type_id: 'mechanical', count: 2 }, { vehicle_type_id: 'electrical', count: 3 }],
    }]);
    assert.equal(s.mechanical, 2);
    assert.equal(s.electrical, 3);
    assert.equal(s.total_bikes, 5);
    assert.equal(s.is_renting, true);
  });
  test('station sans statut live → zéros', () => {
    const [s] = mergeWithStatus(stations, []);
    assert.equal(s.total_bikes, 0);
    assert.equal(s.is_renting, false);
    assert.equal(s.last_reported, null);
  });
});

describe('normalizeRentalApps', () => {
  test('ignore les plateformes sans lien', () => {
    const apps = normalizeRentalApps({
      name: 'Vélam',
      rental_apps: {
        ios: { discovery_uri: 'velam://', store_uri: 'https://apps.apple.com/x' },
        android: {},
      },
    });
    assert.deepEqual(apps, [{ platform: 'ios', name: 'Vélam', discovery_uri: 'velam://', store_uri: 'https://apps.apple.com/x' }]);
  });
  test('entrée vide', () => assert.deepEqual(normalizeRentalApps(undefined), []));
});

describe('toPg (placeholders Postgres)', () => {
  test('numérote les ?', () => {
    assert.equal(toPg('SELECT * FROM t WHERE a = ? AND b = ?'), 'SELECT * FROM t WHERE a = $1 AND b = $2');
  });
});

describe('stations de repli', () => {
  // Gare (0 m), Proche (~330 m), Loin (~1,4 km)
  const stations = [
    { station_id: '1', name: 'Gare',   lat: 49.8900, lon: 2.3000 },
    { station_id: '2', name: 'Proche', lat: 49.8930, lon: 2.3000 },
    { station_id: '3', name: 'Moyen',  lat: 49.8950, lon: 2.3000 },
    { station_id: '4', name: 'Loin',   lat: 49.9030, lon: 2.3000 },
  ];
  const st = (bikes, docks) => ({ num_bikes_available: bikes, num_docks_available: docks });
  const bikes = (s) => countForType(s, 'any');

  test('la plus proche qui ne pose pas le même problème', () => {
    const map = { 1: st(0, 9), 2: st(1, 9), 3: st(5, 9), 4: st(9, 9) };
    const f = findFallback('1', stations, map, bikes, 1); // Proche n'a qu'1 vélo (≤ seuil)
    assert.equal(f.name, 'Moyen');
    assert.equal(f.count, 5);
    assert.ok(f.km > 0.5 && f.km < 0.6);
  });

  test('au-delà de 1 km → aucune', () => {
    const map = { 1: st(0, 9), 2: st(0, 9), 3: st(0, 9), 4: st(9, 9) };
    assert.equal(findFallback('1', stations, map, bikes, 1), null);
  });

  test('station inconnue du référentiel → aucune', () => {
    assert.equal(findFallback('99', stations, {}, bikes, 1), null);
  });

  test('alerte trajet : repli pour chaque bout en problème', () => {
    const alert = { station_id: '1', bike_type: 'any', target: 'bikes', comparison: 'at_most', threshold: 0,
      arrival_station_id: '3', arrival_threshold: 0 };
    const map = { 1: st(0, 9), 2: st(4, 6), 3: st(9, 0), 4: st(9, 9) };
    const f = fallbacksFor(alert, { departureHit: true, arrivalHit: true }, stations, map);
    assert.equal(f.departure.name, 'Proche');
    assert.equal(f.arrival.name, 'Proche'); // plus proche de Moyen avec des places
  });

  test('« au moins N » → pas de repli', () => {
    const alert = { station_id: '1', bike_type: 'any', target: 'bikes', comparison: 'at_least', threshold: 3 };
    assert.deepEqual(fallbacksFor(alert, { departureHit: true }, stations, { 2: st(9, 9) }), {});
    // Groupe : les stations alternatives sont déjà dans le groupe.
    const grouped = { ...alert, comparison: 'at_most', arrival_station_id: null, group_stations: [{ station_id: '1' }, { station_id: '3' }] };
    assert.deepEqual(fallbacksFor(grouped, { departureHit: true }, stations, { 2: st(9, 9) }), {});
  });

  test('le repli est ajouté au corps de la notification', () => {
    const alert = { station_id: '1', station_name: 'Gare', bike_type: 'any', target: 'bikes', comparison: 'at_most', threshold: 1 };
    const p = buildPayload(alert, { count: 0 }, { departure: { name: 'Proche', km: 0.334, count: 4 } });
    assert.equal(p.body, 'Plus aucun vélo disponible\nRepli : Proche (330 m) : 4 vélos');
    const docks = buildPayload({ ...alert, target: 'docks' }, { count: 0 }, { departure: { name: 'Proche', km: 1, count: 1 } });
    assert.match(docks.body, /Repli : Proche \(1,0 km\) : 1 place libre$/);
  });
});

describe('geo', () => {
  test('distanceKm / fmtDistance', () => {
    assert.equal(distanceKm({ lat: 1, lon: 1 }, { lat: null, lon: 1 }), Infinity);
    assert.equal(fmtDistance(0.004), '10 m');
    assert.equal(fmtDistance(0.347), '350 m');
    assert.equal(fmtDistance(1.26), '1,3 km');
  });
});
