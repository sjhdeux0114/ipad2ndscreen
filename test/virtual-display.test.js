'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseVirtualDisplayResult } = require('../src/virtual-display-result');

const root = path.join(__dirname, '..');

test('host exposes every requested Windows scale', () => {
  const html = fs.readFileSync(path.join(root, 'public', 'host.html'), 'utf8');
  const scaleBlock = html.match(/<select id="display-scale">([\s\S]*?)<\/select>/)?.[1] || '';
  const values = [...scaleBlock.matchAll(/value="(\d+)"/g)].map((match) => Number(match[1]));
  assert.deepEqual(values, [100, 125, 150, 175, 200, 250, 300]);
});

test('release package includes the elevated helper and signed driver payload', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.match(packageJson.scripts.dist, /--publish never/);
  assert.ok(packageJson.build.files.includes('native/DisplayManager/publish/DisplayManager.exe'));
  for (const file of ['mttvdd.cat', 'MttVDD.dll', 'MttVDD.inf']) {
    assert.ok(fs.existsSync(path.join(root, 'vendor', 'virtual-display-driver', 'driver', file)), file);
  }
});

test('elevated helper results are accepted in camelCase and legacy PascalCase', () => {
  assert.deepEqual(parseVirtualDisplayResult('{"token":"new","success":true,"message":"ok","error":null}'), {
    token: 'new', success: true, message: 'ok', error: null
  });
  assert.deepEqual(parseVirtualDisplayResult('{"Token":"old","Success":false,"Message":"failed","Error":"reason"}'), {
    token: 'old', success: false, message: 'failed', error: 'reason'
  });
});
