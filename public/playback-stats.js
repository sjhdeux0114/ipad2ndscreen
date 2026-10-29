'use strict';

// Composition timestamps are a best-effort proxy for display timing, not scan-out measurements.
function createFrameMonitor(video, page) {
  const supported = typeof video.requestVideoFrameCallback === 'function';
  let active = false;
  let callbackId;
  let previous;
  let total = 0;
  let count = 0;
  let maximum = 0;
  function reset() { previous = undefined; total = 0; count = 0; maximum = 0; }
  function onFrame(_now, metadata) {
    if (!active) return;
    if (page.hidden) reset();
    else {
      if (previous && metadata.presentedFrames === previous.presentedFrames + 1) {
        const interval = metadata.presentationTime - previous.presentationTime;
        if (Number.isFinite(interval) && interval > 0) {
          total += interval;
          count++;
          maximum = Math.max(maximum, interval);
        }
      }
      previous = metadata;
    }
    callbackId = video.requestVideoFrameCallback(onFrame);
  }
  return {
    start() {
      this.stop();
      if (!supported) return;
      active = true;
      page.addEventListener('visibilitychange', reset);
      callbackId = video.requestVideoFrameCallback(onFrame);
    },
    stop() {
      active = false;
      if (callbackId !== undefined) video.cancelVideoFrameCallback?.(callbackId);
      callbackId = undefined;
      page.removeEventListener('visibilitychange', reset);
      reset();
    },
    sample() {
      const result = {
        frameIntervalSupported: supported,
        frameIntervalMeanMs: count ? total / count : null,
        frameIntervalMaxMs: count ? maximum : null
      };
      total = 0; count = 0; maximum = 0;
      return result;
    }
  };
}

if (typeof module !== 'undefined') module.exports = { createFrameMonitor };
else window.createFrameMonitor = createFrameMonitor;
