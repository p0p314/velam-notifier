// Cohérence de la version publiée (package.json racine / frontend / CHANGELOG / API).
const { startServer, client } = require('./helpers');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const { version } = require('../package.json');

test('version SemVer', () => {
  assert.match(version, /^\d+\.\d+\.\d+$/);
});

test('backend et frontend ont la même version', () => {
  assert.equal(require('../frontend/package.json').version, version);
});

test('le CHANGELOG contient la section de la version courante', () => {
  const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  assert.match(changelog, new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\] - \\d{4}-\\d{2}-\\d{2}$`, 'm'));
});

test('/api/health expose la version', async () => {
  const srv = await startServer();
  try {
    const res = await client(srv.url).get('/api/health');
    assert.equal(res.body.version, version);
  } finally {
    await srv.close();
  }
});
