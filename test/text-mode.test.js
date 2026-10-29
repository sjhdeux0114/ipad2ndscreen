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
  const context = { currentDimensions: () => dimensions, elements: { latencyProfile: { value: 'text' }, frameRate: { value: '30' } } };
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
  context.elements.frameRate.value = '60';
  await context.tuneSender(sender);
  assert.equal(applied.encodings[0].maxFramerate, 60);
  assert.equal(sender.track.contentHint, 'text');
  context.elements.latencyProfile.value = 'ultra-low';
  await context.tuneSender(sender);
  assert.equal(applied.encodings[0].maxFramerate, 60);
  assert.equal(sender.track.contentHint, 'motion');
  assert.equal(normalizeSettings({ latencyProfile: 'text-30' }).latencyProfile, 'text');
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

test('legacy text-30 settings migrate without losing the frame rate', () => {
  assert.equal(normalizeSettings({ latencyProfile: 'text-30' }).frameRate, 30);
  assert.equal(normalizeSettings({ latencyProfile: 'text', frameRate: 60 }).frameRate, 60);
  assert.equal(normalizeSettings({ frameRate: 45 }).frameRate, 60);
});

test('forced capture changes are not lost while an earlier capture is pending', async () => {
  const source = fs.readFileSync(path.join(root, 'public/host.js'), 'utf8');
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  let calls = 0;
  const context = {
    capturePromise: null, selectedSource: {}, stream: null,
    startCapture: async () => { calls++; if (calls === 1) await pending; context.stream = { getVideoTracks: () => [{ readyState: 'live' }] }; },
    loadSources: async () => {}
  };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('async function ensureCaptureStarted('), source.indexOf('async function createPeer(')), context);
  const first = context.ensureCaptureStarted({ force: true });
  const second = context.ensureCaptureStarted({ force: true });
  assert.equal(calls, 1);
  release();
  await Promise.all([first, second]);
  assert.equal(calls, 2);
});

test('sender tuning reports failure instead of silently retaining an old frame cap', async () => {
  const source = fs.readFileSync(path.join(root, 'public/host.js'), 'utf8');
  const context = { currentDimensions: () => ({ width: 1920, height: 1200 }), elements: { latencyProfile: { value: 'text' }, frameRate: { value: '60' } } };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('function streamTuning()'), source.indexOf('function updateTargetSummary()')), context);
  await assert.rejects(context.tuneSender({ track: {}, getParameters: () => ({ encodings: [{}] }), setParameters: async () => { throw new Error('rejected'); } }), /rejected/);
});

test('PC preview stops rendering during transmission and resumes after the last receiver disconnects', () => {
  const source = fs.readFileSync(path.join(root, 'public/host.js'), 'utf8');
  let paused = 0;
  let played = 0;
  const stream = {};
  const peers = new Map([['first', { connectionState: 'connected' }], ['second', { connectionState: 'connected' }]]);
  const context = { peers, stream, selectedSource: { name: 'Screen' }, elements: { preview: { srcObject: stream, pause() { paused++; }, play() { played++; return Promise.resolve(); } }, streamTitle: {} } };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('function updateHostPreview()'), source.indexOf('async function startCapture()')), context);
  context.updateHostPreview();
  assert.equal(context.elements.preview.srcObject, null);
  assert.equal(paused, 1);
  peers.delete('first'); context.updateHostPreview();
  assert.equal(context.elements.preview.srcObject, null);
  peers.clear(); context.updateHostPreview();
  assert.equal(context.elements.preview.srcObject, stream);
  assert.equal(played, 1);
});
