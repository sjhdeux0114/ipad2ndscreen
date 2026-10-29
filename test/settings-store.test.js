'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createSettingsStore, normalizeSettings } = require('../src/settings-store');

test('settings validate six digit master codes and latency profiles', () => {
  assert.deepEqual(normalizeSettings({ autoStart: 1, masterCode: '123456', latencyProfile: 'balanced' }), {
    autoStart: true,
    masterCode: '123456',
    latencyProfile: 'balanced',
    lastDisplaySource: null
  });
  assert.throws(() => normalizeSettings({ masterCode: '1234' }), /6자리/);
  assert.equal(normalizeSettings({ latencyProfile: 'unknown' }).latencyProfile, 'ultra-low');
});

test('settings persist across restarts', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ipad-display-settings-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = createSettingsStore(directory);
  await store.save({
    autoStart: true,
    masterCode: '654321',
    latencyProfile: 'ultra-low',
    lastDisplaySource: { id: 'screen:2:0', name: 'Screen 3', displayId: '123' }
  });
  assert.deepEqual(await store.load(), {
    autoStart: true,
    masterCode: '654321',
    latencyProfile: 'ultra-low',
    lastDisplaySource: { id: 'screen:2:0', name: 'Screen 3', displayId: '123' }
  });
});
