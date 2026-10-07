// Module Trains — lecture du GTFS : CSV, ZIP, temps GTFS, construction de l'index.
require('./helpers');
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { parseCsvText } = require('../trains/gtfs/csv');
const { openZip } = require('../trains/gtfs/zip');
const { buildIndex, filesReader, runsOn, normalize } = require('../trains/gtfs/staticIndex');
const { parseGtfsTime, gtfsToEpoch, localParts, isoDay } = require('../trains/gtfs/time');
const { conventions } = require('../trains/providers/sncf');
const { buildGtfs, zipFiles, LINES, area } = require('./trainsFixture');

const START = '2026-10-05'; // lundi

describe('CSV', () => {
  test('guillemets, virgules et sauts de ligne échappés, BOM, CRLF, colonnes absentes', async () => {
    const text = '﻿a,b,c\r\n1,"x, y",3\r\n2,"il a dit ""oui""",4\r\n3,"deux\nlignes",5\r\n\r\n';
    const rows = await parseCsvText(text, ['a', 'b', 'z']);
    assert.deepEqual(rows, [
      { a: '1', b: 'x, y', z: '' },
      { a: '2', b: 'il a dit "oui"', z: '' },
      { a: '3', b: 'deux\nlignes', z: '' },
    ]);
  });
});

describe('ZIP', () => {
  test('lit des entrées compressées (deflate) et stockées, y compris dans un sous-dossier', async () => {
    const zip = openZip(zipFiles({ 'gtfs/stops.txt': 'stop_id\nA\n', 'agency.txt': 'x\n1\n' }, { store: ['agency.txt'] }));
    assert.ok(zip.has('stops.txt'));
    assert.ok(zip.has('agency.txt'));
    const rows = await parseCsvText(await streamToString(zip.stream('stops.txt')), ['stop_id']);
    assert.deepEqual(rows, [{ stop_id: 'A' }]);
    assert.equal(await streamToString(zip.stream('agency.txt')), 'x\n1\n');
  });

  test('archive invalide → erreur explicite', () => {
    assert.throws(() => openZip(Buffer.from('pas un zip du tout, vraiment pas')), /ZIP invalide/);
  });
});

async function streamToString(stream) {
  const chunks = [];
  for await (const c of stream) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks).toString('utf8');
}

describe('temps GTFS', () => {
  test('heures au-delà de 24:00', () => {
    assert.equal(parseGtfsTime('24:55:00'), 24 * 3600 + 55 * 60);
    assert.ok(Number.isNaN(parseGtfsTime('7h30')));
  });

  test('« midi moins 12 h » : correct les jours de changement d\'heure', () => {
    // 25/10/2026 : passage à l'heure d'hiver (journée de 25 h). 12:00 GTFS = midi local.
    const noon = gtfsToEpoch('2026-10-25', 12 * 3600, 'Europe/Paris');
    assert.equal(localParts(noon, 'Europe/Paris').hhmm, '12:00');
    // Un jour normal : 16:53 GTFS = 16:53 locale (UTC+2 en octobre).
    assert.equal(new Date(gtfsToEpoch('2026-10-07', 16 * 3600 + 53 * 60, 'Europe/Paris')).toISOString(), '2026-10-07T14:53:00.000Z');
    assert.equal(isoDay('2026-10-07'), 3);
  });
});

describe('index GTFS', () => {
  test('gares, lignes, trajets triés, numéros de train, alias temps réel', async () => {
    const index = await buildIndex(filesReader(buildGtfs({ start: START, days: 14 })), conventions);
    assert.equal(index.tz, 'Europe/Paris');
    assert.deepEqual(index.feed, { version: `${START}-v1`, publisher: 'SNCF', start: START, end: '2026-10-18' });

    // Les quais sont rattachés à leur gare (StopArea), seules les gares desservies comptent.
    const lille = index.stations[index.stationById.get(area('LILLE'))];
    assert.equal(lille.name, 'Lille Flandres');
    assert.equal(lille.code, '87286005');
    assert.ok(lille.served > 0);

    // Deux lignes « K44 » distinctes.
    assert.equal(index.lines.filter((l) => l.shortName === 'K44').length, 2);
    assert.equal(index.lines[index.lineById.get(LINES.K44)].longName, 'Lille Flandres - Amiens');

    // stop_times mélangé en entrée → trié par trajet et ordre de passage.
    const t = index.trips.index.get([...index.trips.index.keys()].find((id) => id.startsWith('OCESN843924F')));
    const names = [];
    for (let k = index.trips.start[t]; k < index.trips.start[t + 1]; k++) names.push(index.stations[index.stopTimes.station[k]].name);
    assert.deepEqual(names, ['Lille Flandres', 'Douai', 'Arras', 'Albert', 'Amiens']);

    // Numéro = trip_headsign sans zéros de tête ; alias RT = préfixe interne SNCF.
    const lyon = [...index.trips.index.entries()].find(([id]) => id.startsWith('OCESN886000F'))[1];
    assert.equal(index.trips.number[lyon], '886000');
    assert.deepEqual(index.aliasTrips.get('OCESN843924F'), [t]);

    // Car TER : mode routier lu dans le trip_id (« _R: »).
    const car = [...index.trips.index.entries()].find(([id]) => id.startsWith('OCESN843990R'))[1];
    assert.equal(index.trips.road[car], 1);
    assert.equal(index.trips.road[t], 0);

    // Calendrier : WEEK = jours ouvrés uniquement.
    assert.equal(runsOn(index, t, 20261007), true);  // mercredi
    assert.equal(runsOn(index, t, 20261010), false); // samedi
    assert.equal(runsOn(index, t, 20261020), false); // hors période
  });

  test('calendar.txt (GTFS générique) + exceptions de calendar_dates.txt', async () => {
    const files = buildGtfs({ start: START, days: 14 });
    files['calendar.txt'] = 'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n'
      + 'WEEK,1,1,1,1,1,0,0,20261005,20261018\n';
    files['calendar_dates.txt'] = 'service_id,date,exception_type\nWEEK,20261007,2\nWEEK,20261010,1\nALL,20261005,1\n';
    const index = await buildIndex(filesReader(files), conventions);
    const t = [...index.trips.index.entries()].find(([id]) => id.startsWith('OCESN843924F'))[1];
    assert.equal(runsOn(index, t, 20261006), true);
    assert.equal(runsOn(index, t, 20261007), false); // retiré
    assert.equal(runsOn(index, t, 20261010), true);  // ajouté un samedi
  });

  test('dataset incomplet → erreur explicite', async () => {
    const files = buildGtfs({ start: START });
    delete files['stop_times.txt'];
    await assert.rejects(buildIndex(filesReader(files), conventions), /stop_times\.txt manquant/);
  });

  test('normalisation des noms pour la recherche', () => {
    assert.equal(normalize('Dreuil-lès-Amiens'), 'dreuil les amiens');
  });
});
