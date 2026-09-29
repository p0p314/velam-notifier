// Nom lisible d'un appareil (liste « Appareils connectés »).
require('./helpers');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { describeDevice } = require('../device');

test('systèmes et navigateurs courants', () => {
  const cases = [
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1', 'iPhone · Safari'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/120.0 Mobile/15E148 Safari/604.1', 'iPhone · Chrome'],
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36', 'Android · Chrome'],
    ['Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 SamsungBrowser/23.0 Chrome/115.0 Mobile Safari/537.36', 'Android · Samsung Internet'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36 Edg/120.0', 'Windows · Edge'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 14.1; rv:121.0) Gecko/20100101 Firefox/121.0', 'Mac · Firefox'],
    ['Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36', 'Linux · Chrome'],
  ];
  for (const [ua, label] of cases) assert.equal(describeDevice(ua), label, ua);
});

test('inconnu ou absent', () => {
  assert.equal(describeDevice(null), 'Appareil inconnu');
  assert.equal(describeDevice('curl/8.0'), 'Appareil inconnu');
});
