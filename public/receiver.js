'use strict';

const { api, preferH264 } = window.iPadDisplay;
const video = document.querySelector('#display');
const pairing = document.querySelector('#pairing');
const form = document.querySelector('#pair-form');
const pinInput = document.querySelector('#pin');
const status = document.querySelector('#receiver-status');
const errorElement = document.querySelector('#receiver-error');
const fullscreen = document.querySelector('#fullscreen');
const latencyStats = document.querySelector('#latency-stats');
let peer;
let sessionId;
let pin;
let receiverEventSequence = 0;
let inputChannel;
let queuedReceiverCandidates = [];
let queuedHostCandidates = [];
let telemetryTimer;
let previousInbound;
let previousStatsAt;

function setStatus(text) {
  status.textContent = text;
}

function fail(error) {
  errorElement.textContent = error?.message || String(error);
  setStatus('연결 실패');
}

async function connect() {
  pin = pinInput.value.trim();
  errorElement.textContent = '';
  setStatus('Windows 서버 확인 중…');
  const config = await api('/api/config', pin);

  peer?.close();
  clearInterval(telemetryTimer);
  receiverEventSequence = 0;
  sessionId = undefined;
  queuedReceiverCandidates = [];
  queuedHostCandidates = [];
  previousInbound = undefined;
  previousStatsAt = undefined;
  peer = new RTCPeerConnection({
    iceServers: config.iceServers,
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require',
    targetLatency: 'lowest'
  });
  const connection = peer;
  let connectionSessionId;
  window.__ipadDisplayPeer = peer;
  const transceiver = peer.addTransceiver('video', { direction: 'recvonly' });
  preferH264(transceiver);
  inputChannel = peer.createDataChannel('input', { ordered: false, maxRetransmits: 0 });

  peer.addEventListener('track', (event) => {
    try { event.receiver.jitterBufferTarget = 0; } catch { /* Older Safari chooses its minimum. */ }
    try { event.receiver.playoutDelayHint = 0; } catch { /* Best-effort legacy latency hint. */ }
    video.srcObject = event.streams[0] || new MediaStream([event.track]);
    void video.play();
  });
  peer.addEventListener('icecandidate', ({ candidate }) => {
    if (!candidate) return;
    if (!connectionSessionId) {
      queuedReceiverCandidates.push(candidate.toJSON());
      return;
    }
    void sendReceiverCandidate(candidate.toJSON(), connectionSessionId);
  });
  peer.addEventListener('connectionstatechange', () => {
    const labels = { connecting: '연결 중…', connected: '연결됨', disconnected: '연결 끊김', failed: '연결 실패', closed: '연결 종료' };
    setStatus(labels[connection.connectionState] || connection.connectionState);
    if (connection.connectionState === 'connected') {
      pairing.classList.add('connected');
      fullscreen.hidden = false;
      startTelemetry(connection);
    } else if (['disconnected', 'failed', 'closed'].includes(connection.connectionState)) {
      clearInterval(telemetryTimer);
    }
  });

  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);
  const session = await api('/api/sessions', pin, {
    method: 'POST', body: JSON.stringify({ offer: peer.localDescription.toJSON() })
  });
  sessionId = session.sessionId;
  connectionSessionId = session.sessionId;
  for (const candidate of queuedReceiverCandidates) await sendReceiverCandidate(candidate, connectionSessionId);
  queuedReceiverCandidates = [];
  setStatus('PC 응답 대기 중…');
  void pollReceiverEvents(connection, sessionId);
}

async function sendReceiverCandidate(candidate, targetSessionId = sessionId) {
  await api(`/api/sessions/${targetSessionId}/receiver-candidate`, pin, {
    method: 'POST', body: JSON.stringify({ candidate })
  });
}

async function pollReceiverEvents(connection, currentSessionId) {
  while (peer === connection && !['closed', 'failed'].includes(connection.connectionState)) {
    try {
      const { events } = await api(`/api/sessions/${currentSessionId}/events?since=${receiverEventSequence}`, pin);
      for (const event of events) {
        receiverEventSequence = Math.max(receiverEventSequence, event.id);
        if (event.type === 'answer' && !peer.remoteDescription) {
          await connection.setRemoteDescription(event.payload.answer);
          for (const candidate of queuedHostCandidates) await connection.addIceCandidate(candidate);
          queuedHostCandidates = [];
        }
        if (event.type === 'host-candidate') {
          if (connection.remoteDescription) await connection.addIceCandidate(event.payload.candidate);
          else queuedHostCandidates.push(event.payload.candidate);
        }
      }
    } catch (error) {
      fail(error);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
}

function startTelemetry(connection) {
  clearInterval(telemetryTimer);
  const collect = async () => {
    if (connection.connectionState !== 'connected') return;
    const report = await connection.getStats();
    const inbound = [...report.values()].find((item) => item.type === 'inbound-rtp' && item.kind === 'video');
    if (!inbound) return;
    const candidatePair = [...report.values()].find((item) => item.type === 'candidate-pair' && item.state === 'succeeded' && (item.nominated || item.selected));
    const codec = report.get(inbound.codecId);
    const now = performance.now();
    const elapsedSeconds = previousStatsAt ? (now - previousStatsAt) / 1000 : 0;
    const emittedDelta = previousInbound ? inbound.jitterBufferEmittedCount - previousInbound.jitterBufferEmittedCount : 0;
    const decodedDelta = previousInbound ? inbound.framesDecoded - previousInbound.framesDecoded : 0;
    const jitterDelta = previousInbound ? inbound.jitterBufferDelay - previousInbound.jitterBufferDelay : 0;
    const decodeDelta = previousInbound ? inbound.totalDecodeTime - previousInbound.totalDecodeTime : 0;
    const telemetry = {
      type: 'telemetry',
      fps: Math.round(inbound.framesPerSecond || (elapsedSeconds > 0 ? decodedDelta / elapsedSeconds : 0)),
      rttMs: Number.isFinite(candidatePair?.currentRoundTripTime) ? Math.round(candidatePair.currentRoundTripTime * 1000) : null,
      jitterMs: emittedDelta > 0 ? Math.round((jitterDelta / emittedDelta) * 1000) : null,
      decodeMs: decodedDelta > 0 ? Math.round((decodeDelta / decodedDelta) * 1000 * 10) / 10 : null,
      packetsLost: inbound.packetsLost || 0,
      codec: codec?.mimeType?.replace('video/', '') || 'H.264'
    };
    latencyStats.hidden = false;
    latencyStats.textContent = `${telemetry.fps}fps · RTT ${telemetry.rttMs ?? '-'}ms · buffer ${telemetry.jitterMs ?? '-'}ms · decode ${telemetry.decodeMs ?? '-'}ms`;
    if (inputChannel?.readyState === 'open') inputChannel.send(JSON.stringify(telemetry));
    previousInbound = {
      jitterBufferEmittedCount: inbound.jitterBufferEmittedCount || 0,
      jitterBufferDelay: inbound.jitterBufferDelay || 0,
      framesDecoded: inbound.framesDecoded || 0,
      totalDecodeTime: inbound.totalDecodeTime || 0
    };
    previousStatsAt = now;
  };
  telemetryTimer = setInterval(() => void collect().catch(() => {}), 1000);
  void collect().catch(() => {});
}

function sendPointer(event, kind) {
  if (inputChannel?.readyState !== 'open') return;
  const rect = video.getBoundingClientRect();
  inputChannel.send(JSON.stringify({
    type: 'pointer',
    kind,
    x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
    y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    buttons: event.buttons,
    pointerType: event.pointerType
  }));
}

video.addEventListener('pointerdown', (event) => { video.setPointerCapture(event.pointerId); sendPointer(event, 'down'); });
video.addEventListener('pointermove', (event) => sendPointer(event, 'move'));
video.addEventListener('pointerup', (event) => sendPointer(event, 'up'));
form.addEventListener('submit', (event) => { event.preventDefault(); void connect().catch(fail); });
fullscreen.addEventListener('click', () => {
  if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
  else if (document.documentElement.requestFullscreen) void document.documentElement.requestFullscreen();
});

const pinFromUrl = new URLSearchParams(location.search).get('pin');
if (/^\d{6}$/.test(pinFromUrl || '')) pinInput.value = pinFromUrl;
