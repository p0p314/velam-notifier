// Catalogue des villes de vélos : cohérence backend / frontend, identifiants de stations.
require('./helpers');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { CITIES, globalStationId, stationCity, isCity, gbfsBase } = require('../cities');

test('le catalogue du frontend est identique à celui du backend', async () => {
  const src = fs.readFileSync(path.join(__dirname, '../frontend/src/lib/cities.js'), 'utf8');
  // Extrait le tableau CITIES du module ESM et l'évalue (données littérales uniquement).
  const body = src.slice(src.indexOf('export const CITIES = [') + 'export const CITIES = '.length, src.indexOf('];') + 1);
  const front = Function(`"use strict"; return (${body});`)();
  assert.deepEqual(front, CITIES);
});

test('identifiants globaux : Amiens inchangé, autres villes préfixées', () => {
  assert.equal(globalStationId('amiens', '12'), '12');
  assert.equal(globalStationId('lyon', '12'), 'lyon:12');
  assert.equal(stationCity('12'), 'amiens');
  assert.equal(stationCity('lyon:12'), 'lyon');
  assert.equal(stationCity('inconnue:12'), 'amiens');
  assert.equal(stationCity(null), 'amiens');
  assert.ok(isCity('nantes') && !isCity('paris') && !isCity(undefined));
  assert.equal(gbfsBase('lyon'), 'https://api.cyclocity.fr/contracts/lyon/gbfs/v2');
  assert.equal(new Set(CITIES.map((c) => c.id)).size, CITIES.length);
});
