'use strict';

const { api, preferH264 } = window.iPadDisplay;
const video = document.querySelector('#display');
const pairing = document.querySelector('#pairing');
const form = document.querySelector('#pair-form');
const pinInput = document.querySelector('#pin');
const status = document.querySelector('#receiver-status');
const errorElement = document.querySelector('#receiver-error');
const fullscreen = document.querySelector('#fullscreen');
let peer;
let sessionId;
let pin;
let receiverEventSequence = 0;
let inputChannel;
let queuedReceiverCandidates = [];
let queuedHostCandidates = [];

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
  peer = new RTCPeerConnection({ iceServers: config.iceServers });
  window.__ipadDisplayPeer = peer;
  const transceiver = peer.addTransceiver('video', { direction: 'recvonly' });
  preferH264(transceiver);
  inputChannel = peer.createDataChannel('input', { ordered: false, maxRetransmits: 0 });

  peer.addEventListener('track', (event) => {
    video.srcObject = event.streams[0] || new MediaStream([event.track]);
    void video.play();
  });
  peer.addEventListener('icecandidate', ({ candidate }) => {
    if (!candidate) return;
    if (!sessionId) {
      queuedReceiverCandidates.push(candidate.toJSON());
      return;
    }
    void sendReceiverCandidate(candidate.toJSON());
  });
  peer.addEventListener('connectionstatechange', () => {
    const labels = { connecting: '연결 중…', connected: '연결됨', disconnected: '연결 끊김', failed: '연결 실패', closed: '연결 종료' };
    setStatus(labels[peer.connectionState] || peer.connectionState);
    if (peer.connectionState === 'connected') {
      pairing.classList.add('connected');
      fullscreen.hidden = false;
    }
  });

  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);
  const session = await api('/api/sessions', pin, {
    method: 'POST', body: JSON.stringify({ offer: peer.localDescription.toJSON() })
  });
  sessionId = session.sessionId;
  for (const candidate of queuedReceiverCandidates) await sendReceiverCandidate(candidate);
  queuedReceiverCandidates = [];
  setStatus('PC 응답 대기 중…');
  void pollReceiverEvents();
}

async function sendReceiverCandidate(candidate) {
  await api(`/api/sessions/${sessionId}/receiver-candidate`, pin, {
    method: 'POST', body: JSON.stringify({ candidate })
  });
}

async function pollReceiverEvents() {
  while (peer && !['closed', 'failed'].includes(peer.connectionState)) {
    try {
      const { events } = await api(`/api/sessions/${sessionId}/events?since=${receiverEventSequence}`, pin);
      for (const event of events) {
        receiverEventSequence = Math.max(receiverEventSequence, event.id);
        if (event.type === 'answer' && !peer.remoteDescription) {
          await peer.setRemoteDescription(event.payload.answer);
          for (const candidate of queuedHostCandidates) await peer.addIceCandidate(candidate);
          queuedHostCandidates = [];
        }
        if (event.type === 'host-candidate') {
          if (peer.remoteDescription) await peer.addIceCandidate(event.payload.candidate);
          else queuedHostCandidates.push(event.payload.candidate);
        }
      }
    } catch (error) {
      fail(error);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
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
