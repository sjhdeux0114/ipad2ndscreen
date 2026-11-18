'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('sender bitrate uses elapsed report time and handles idle or replaced streams', () => {
  const context = { window: {} };
  require('node:vm').runInNewContext(fs.readFileSync(path.join(root, 'public/common.js'), 'utf8'), context);
  const format = context.window.iPadDisplay.formatSenderBitrate;
  const first = { id: 'video', timestamp: 100, bytesSent: 800 };
  const next = { id: 'video', timestamp: 2100, bytesSent: 2_500_800 };
  assert.equal(format(first, next, 17_000_000), '영상 송신 10.00 Mbps / 상한 17 Mbps');
  assert.match(format(first, { ...next, bytesSent: 800 }, 5_000_000), /0\.00 Mbps/);
  for (const previous of [undefined, next, { ...first, id: 'old' }, { ...first, bytesSent: 3_000_000 }]) {
    assert.match(format(previous, next, 17_000_000), /측정 대기/);
  }
});

test('ultra-low-latency mode tunes both sender and Safari receiver', () => {
  const host = fs.readFileSync(path.join(root, 'public', 'host.js'), 'utf8');
  const receiver = fs.readFileSync(path.join(root, 'public', 'receiver.js'), 'utf8');
  const common = fs.readFileSync(path.join(root, 'public', 'common.js'), 'utf8');
  assert.match(host, /maxBitrate/);
  assert.match(host, /maxFramerate = tuning.frameRate/);
  assert.match(host, /maintain-framerate/);
  assert.match(receiver, /jitterBufferTarget = 0/);
  assert.match(receiver, /targetLatency: 'lowest'/);
  assert.match(common, /video\/h264/);
});

test('main process keeps the app in the tray and supports login startup', () => {
  const main = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
  const trayIcon = main.match(/const TRAY_ICON_PNG = '([^']+)'/)?.[1];
  assert.match(main, /new Tray/);
  assert.match(main, /nativeImage\.createFromBuffer\(Buffer\.from\(TRAY_ICON_PNG, 'base64'\)\)/);
  assert.doesNotMatch(main, /data:image\/svg\+xml/);
  assert.equal(Buffer.from(trayIcon || '', 'base64').subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.match(main, /event\.preventDefault\(\);\s*mainWindow\.hide\(\)/);
  assert.match(main, /setLoginItemSettings/);
});
