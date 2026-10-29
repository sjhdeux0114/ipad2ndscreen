'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { findPreferredDisplaySource, normalizeDisplaySource } = require('../src/display-source-preference');

const sources = [
  { id: 'screen:0:0', name: 'Screen 1', displayId: '100' },
  { id: 'screen:2:0', name: 'Screen 3', displayId: '300' }
];

test('last display is restored by stable display id before transient source id', () => {
  const selected = findPreferredDisplaySource(sources, {
    id: 'screen:9:0',
    name: 'Old name',
    displayId: '300'
  });
  assert.equal(selected, sources[1]);
});

test('last display falls back to source id and display name', () => {
  assert.equal(findPreferredDisplaySource(sources, { id: 'screen:2:0' }), sources[1]);
  assert.equal(findPreferredDisplaySource(sources, { name: 'Screen 3' }), sources[1]);
  assert.equal(findPreferredDisplaySource(sources, { name: 'Missing' }), null);
  assert.deepEqual(normalizeDisplaySource({ id: 3, name: 'Screen 3' }), { id: '', name: 'Screen 3', displayId: '' });
});
