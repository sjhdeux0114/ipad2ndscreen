'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFrameMonitor } = require('../public/playback-stats');

test('frame intervals sample real composition timestamps and reset on visibility/reconnect', () => {
  let callback;
  let visibility;
  let canceled = 0;
  const page = { hidden: false, addEventListener: (_n, fn) => { visibility = fn; }, removeEventListener() {} };
  const video = { requestVideoFrameCallback(fn) { callback = fn; return 1; }, cancelVideoFrameCallback() { canceled++; } };
  const monitor = createFrameMonitor(video, page);
  const frame = (time, number) => callback(time, { presentationTime: time, presentedFrames: number });
  monitor.start();
  frame(0, 1); frame(16, 2); frame(50, 3);
  assert.deepEqual(monitor.sample(), { frameIntervalSupported: true, frameIntervalMeanMs: 25, frameIntervalMaxMs: 34 });
  assert.equal(monitor.sample().frameIntervalMeanMs, null);
  // Missing callbacks do not prove that the corresponding frames were dropped.
  frame(100, 6);
  assert.equal(monitor.sample().frameIntervalMeanMs, null);
  page.hidden = true; visibility(); frame(200, 7);
  page.hidden = false; visibility(); frame(1000, 8); frame(1033, 9);
  assert.equal(monitor.sample().frameIntervalMeanMs, 33);
  monitor.stop(); assert.equal(canceled, 1);
  monitor.start(); frame(2000, 1);
  assert.equal(monitor.sample().frameIntervalMeanMs, null);
  monitor.stop();
});

test('unsupported frame callbacks are reported as unsupported rather than zero', () => {
  const monitor = createFrameMonitor({}, { removeEventListener() {} });
  monitor.start();
  assert.deepEqual(monitor.sample(), { frameIntervalSupported: false, frameIntervalMeanMs: null, frameIntervalMaxMs: null });
  monitor.stop();
});
