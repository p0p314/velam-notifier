// Tests unitaires des fonctions pures (aucun accès réseau ; la base n'est pas utilisée).
require('./helpers');
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { validateAlertPayload } = require('../routes/alerts');
const { mergeWithStatus } = require('../routes/stations');
const { countForType, inWindow, nowInTz, buildPayload } = require('../push');
const { normalizeRentalApps } = require('../rentalApps');
const { toPg } = require('../database/postgres');

const validAlert = {
  station_id: '12', station_name: 'Gare', bike_type: 'ebike',
  min_count: 3, time_start: '08:00', time_end: '09:30', days: '1,2,3',
};

describe('validateAlertPayload — création', () => {
  test('payload complet valide', () => {
    const { fields, errors } = validateAlertPayload(validAlert);
    assert.deepEqual(errors, []);
    assert.deepEqual(fields, validAlert);
  });

  test('valeurs par défaut : min_count=1, tous les jours', () => {
    const { min_count, days, ...rest } = validAlert;
    const { fields, errors } = validateAlertPayload(rest);
    assert.deepEqual(errors, []);
    assert.equal(fields.min_count, 1);
    assert.equal(fields.days, '1,2,3,4,5,6,7');
  });

  test('jours dédoublonnés et triés', () => {
    const { fields } = validateAlertPayload({ ...validAlert, days: '7,1,3,1' });
    assert.equal(fields.days, '1,3,7');
  });

  test('champs obligatoires manquants', () => {
    const { errors } = validateAlertPayload({});
    for (const f of ['station_id', 'station_name', 'bike_type', 'time_start', 'time_end']) {
      assert.ok(errors.some((e) => e.startsWith(f)), `erreur attendue pour ${f}`);
    }
  });

  test('bike_type inconnu refusé', () => {
    assert.ok(validateAlertPayload({ ...validAlert, bike_type: 'trottinette' }).errors.length);
  });

  test('heures invalides refusées', () => {
    for (const t of ['24:00', '8:00', '08:60', 'abc', '']) {
      assert.ok(validateAlertPayload({ ...validAlert, time_start: t }).errors.includes('time_start (HH:MM)'), t);
    }
  });

  test('min_count hors bornes → défaut 1 à la création', () => {
    assert.equal(validateAlertPayload({ ...validAlert, min_count: 0 }).fields.min_count, 1);
    assert.equal(validateAlertPayload({ ...validAlert, min_count: 51 }).fields.min_count, 1);
  });

  test('chaînes trop longues refusées', () => {
    assert.ok(validateAlertPayload({ ...validAlert, station_id: 'x'.repeat(65) }).errors.includes('station_id'));
    assert.ok(validateAlertPayload({ ...validAlert, station_name: 'x'.repeat(129) }).errors.includes('station_name'));
  });

  test('active converti en 0/1', () => {
    assert.equal(validateAlertPayload({ ...validAlert, active: false }).fields.active, 0);
    assert.equal(validateAlertPayload({ ...validAlert, active: true }).fields.active, 1);
  });
});

describe('validateAlertPayload — mise à jour partielle', () => {
  test('seuls les champs fournis sont retenus', () => {
    const { fields, errors } = validateAlertPayload({ active: false }, { partial: true });
    assert.deepEqual(errors, []);
    assert.deepEqual(fields, { active: 0 });
  });

  test('champ fourni mais invalide = erreur (pas de défaut)', () => {
    assert.ok(validateAlertPayload({ min_count: 99 }, { partial: true }).errors.length);
    assert.ok(validateAlertPayload({ days: '8' }, { partial: true }).errors.length);
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

describe('buildPayload', () => {
  const alerte = { station_id: '12', station_name: 'Gare', bike_type: 'ebike' };
  test('URL https vers /open (exigence iOS)', () => {
    const p = buildPayload(alerte, 2, {});
    assert.match(p.url, /^https:\/\/.+\/open\?url=/);
    assert.equal(p.stationId, '12');
  });
  test('libellé pluriel', () => {
    assert.match(buildPayload(alerte, 2, {}).body, /^2 vélo\(s\) électrique\(s\) disponibles/);
    assert.match(buildPayload(alerte, 1, {}).body, /^1 vélo\(s\) électrique\(s\) disponible ·/);
  });
  test('0 vélo → message d\'avertissement', () => {
    const p = buildPayload({ ...alerte, bike_type: 'mechanical' }, 0, {});
    assert.match(p.title, /^⚠️/);
    assert.equal(p.body, 'Plus aucun vélo(s) mécanique(s) disponible');
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
