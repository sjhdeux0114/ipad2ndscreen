'use strict';

window.iPadDisplay = {
  formatDecoderStats(stats) {
    const efficiency = stats.powerEfficientDecoder === true ? '전력 효율: 예'
      : stats.powerEfficientDecoder === false ? '전력 효율: 아니오' : '전력 효율: 미지원';
    return `디코더: ${stats.decoderImplementation || '정보 미제공'} · ${efficiency} · 프레임 누락(누적): ${stats.framesDropped ?? '미지원'}`;
  },
  formatPlaybackStats(stats) {
    const resolution = stats.frameWidth > 0 && stats.frameHeight > 0 ? `${stats.frameWidth}×${stats.frameHeight}` : '대기 중';
    const freezes = stats.freezeCount == null ? '미지원' : `${stats.freezeCount}회`;
    const duration = stats.totalFreezesDuration == null ? '미지원' : `${stats.totalFreezesDuration.toFixed(1)}초`;
    const interval = stats.frameIntervalSupported === false ? '미지원' : stats.frameIntervalMeanMs == null ? '측정 대기' : `평균 ${stats.frameIntervalMeanMs.toFixed(1)} / 최대 ${stats.frameIntervalMaxMs.toFixed(1)}ms`;
    return `수신 ${resolution} · 화면 멈춤(누적) ${freezes} / ${duration} · 출력 간격(최근) ${interval}`;
  },
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
