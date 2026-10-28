'use strict';

window.iPadDisplay = {
  async api(path, pin, options = {}) {
    const headers = { ...(options.headers || {}), 'X-Pairing-Pin': pin };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(path, { ...options, headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
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
