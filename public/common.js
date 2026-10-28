'use strict';

window.iPadDisplay = {
  async api(path, credentials, options = {}) {
    const normalized = typeof credentials === 'string' ? { pin: credentials } : (credentials || {});
    const headers = { ...(options.headers || {}) };
    if (normalized.pin) headers['X-Pairing-Pin'] = normalized.pin;
    if (normalized.deviceToken) headers['X-Device-Token'] = normalized.deviceToken;
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(path, { ...options, headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || `Request failed (${response.status})`);
      error.status = response.status;
      throw error;
    }
    return payload;
  },

  preferH264(transceiver) {
    if (!transceiver?.setCodecPreferences || !window.RTCRtpReceiver?.getCapabilities) return;
    const codecs = RTCRtpReceiver.getCapabilities('video')?.codecs || [];
    const h264 = codecs
      .filter((codec) => codec.mimeType.toLowerCase() === 'video/h264')
      .sort((left, right) => {
        const score = (codec) => {
          const fmtp = codec.sdpFmtpLine || '';
          return (fmtp.includes('profile-level-id=42') ? 2 : 0) + (fmtp.includes('packetization-mode=1') ? 1 : 0);
        };
        return score(right) - score(left);
      });
    const rest = codecs.filter((codec) => codec.mimeType.toLowerCase() !== 'video/h264');
    if (h264.length) transceiver.setCodecPreferences([...h264, ...rest]);
  }
};
