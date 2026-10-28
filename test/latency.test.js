'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('ultra-low-latency mode tunes both sender and Safari receiver', () => {
  const host = fs.readFileSync(path.join(root, 'public', 'host.js'), 'utf8');
  const receiver = fs.readFileSync(path.join(root, 'public', 'receiver.js'), 'utf8');
  const common = fs.readFileSync(path.join(root, 'public', 'common.js'), 'utf8');
  assert.match(host, /maxBitrate/);
  assert.match(host, /maxFramerate = 60/);
  assert.match(host, /maintain-framerate/);
  assert.match(receiver, /jitterBufferTarget = 0/);
  assert.match(receiver, /targetLatency: 'lowest'/);
  assert.match(common, /video\/h264/);
});

test('main process keeps the app in the tray and supports login startup', () => {
  const main = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
  assert.match(main, /new Tray/);
  assert.match(main, /event\.preventDefault\(\);\s*mainWindow\.hide\(\)/);
  assert.match(main, /setLoginItemSettings/);
});
