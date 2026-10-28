'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createTrustedDeviceStore } = require('../src/trusted-device-store');

test('trusted device tokens persist as hashes across app restarts', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ipad-display-trusted-devices-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));

  const firstStore = createTrustedDeviceStore(directory);
  await firstStore.load();
  const token = await firstStore.register();
  assert.equal(firstStore.isAuthorized(token), true);

  const saved = await fs.readFile(firstStore.filePath, 'utf8');
  assert.equal(saved.includes(token), false);

  const restartedStore = createTrustedDeviceStore(directory);
  await restartedStore.load();
  assert.equal(restartedStore.isAuthorized(token), true);
  assert.equal(restartedStore.isAuthorized('wrong-device-token'), false);
});
