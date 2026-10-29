'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('host restores the last display and starts capture for a mobile offer', () => {
  const host = fs.readFileSync(path.join(root, 'public', 'host.js'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');

  assert.match(main, /displayId: String\(source\.display_id/);
  assert.match(main, /findPreferredDisplaySource\(serialized, settings\.lastDisplaySource\)/);
  assert.match(host, /sources\.find\(\(source\) => source\.preferred\)/);
  assert.match(host, /async function createPeer[\s\S]*?await ensureCaptureStarted\(\)/);
  assert.match(host, /then\(\(\) => \{ if \(!polling\) void pollHostEvents\(\); \}\)/);
});
