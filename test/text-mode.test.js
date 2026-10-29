'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { normalizeSettings } = require('../src/settings-store');
const root = path.join(__dirname, '..');

test('text mode preserves dimensions and applies 30fps and text preferences to sender', async () => {
  const source = fs.readFileSync(path.join(root, 'public/host.js'), 'utf8');
  const dimensions = { width: 1920, height: 1200 };
  const context = { currentDimensions: () => dimensions, elements: { latencyProfile: { value: 'text-30' } } };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('function streamTuning()'), source.indexOf('function updateTargetSummary()')), context);
  const tuning = context.streamTuning();
  assert.equal(tuning.frameRate, 30);
  assert.equal(tuning.contentHint, 'text');
  assert.equal(tuning.degradationPreference, 'maintain-resolution');
  assert.deepEqual(dimensions, { width: 1920, height: 1200 });
  let applied;
  const sender = { track: { contentHint: 'motion' }, getParameters: () => ({ encodings: [{}] }), setParameters: async (p) => { applied = p; } };
  await context.tuneSender(sender);
  assert.equal(applied.encodings[0].maxFramerate, 30);
  assert.equal(applied.encodings[0].scaleResolutionDownBy, undefined);
  assert.equal(sender.track.contentHint, 'text');
  context.elements.latencyProfile.value = 'ultra-low';
  await context.tuneSender(sender);
  assert.equal(applied.encodings[0].maxFramerate, 60);
  assert.equal(sender.track.contentHint, 'motion');
  assert.equal(normalizeSettings({ latencyProfile: 'text-30' }).latencyProfile, 'text-30');
});

test('decoder display distinguishes unsupported statistics from zero dropped frames', () => {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'public/common.js'), 'utf8'), context);
  const format = context.window.iPadDisplay.formatDecoderStats;
  assert.match(format({}), /정보 미제공.*미지원.*미지원/);
  assert.match(format({ decoderImplementation: 'MediaCodec', powerEfficientDecoder: true, framesDropped: 0 }), /MediaCodec.*전력 효율: 예.*누적\): 0/);
  assert.match(format({ powerEfficientDecoder: false, framesDropped: 12 }), /전력 효율: 아니오.*누적\): 12/);
});
