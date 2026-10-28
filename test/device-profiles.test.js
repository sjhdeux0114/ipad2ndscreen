'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

test('device profile database has valid, unique landscape resolutions', () => {
  const filePath = path.join(__dirname, '..', 'public', 'device-profiles.json');
  const database = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.equal(database.schemaVersion, 1);
  assert.ok(database.profiles.length >= 20);
  const ids = new Set();
  for (const profile of database.profiles) {
    assert.match(profile.id, /^[a-z0-9-]+$/);
    assert.equal(ids.has(profile.id), false, `duplicate profile id: ${profile.id}`);
    ids.add(profile.id);
    assert.ok(profile.model.length > 0);
    assert.ok(Number.isInteger(profile.width) && profile.width >= 640);
    assert.ok(Number.isInteger(profile.height) && profile.height >= 480);
    assert.ok(profile.width >= profile.height, `${profile.id} must store landscape dimensions`);
    assert.ok(profile.maxRefreshRate >= 60);
  }
});

test('requested target devices are included', () => {
  const database = require('../public/device-profiles.json');
  const ids = new Set(database.profiles.map((profile) => profile.id));
  for (const id of [
    'apple-ipad-mini-5', 'apple-ipad-mini-6', 'apple-ipad-mini-7', 'apple-ipad-mini-8',
    'apple-ipad-air-11', 'apple-ipad-pro-11-current', 'apple-ipad-pro-12-9',
    'samsung-tab-s10-plus', 'samsung-tab-s10-ultra'
  ]) assert.ok(ids.has(id), `missing profile: ${id}`);
});
