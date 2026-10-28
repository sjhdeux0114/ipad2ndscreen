'use strict';

const { api, preferH264 } = window.iPadDisplay;
const params = new URLSearchParams(location.search);
const pin = params.get('pin');
const peers = new Map();
const pendingCandidates = new Map();
let selectedSource = null;
let stream = null;
let hostEventSequence = 0;
let polling = false;
let builtInProfiles = [];
let customProfiles = [];
const CUSTOM_PROFILES_KEY = 'ipad-display.custom-profiles.v1';
const SELECTED_PROFILE_KEY = 'ipad-display.selected-profile.v1';

const elements = {
  addresses: document.querySelector('#addresses'),
  pin: document.querySelector('#pin'),
  sources: document.querySelector('#sources'),
  targetProfile: document.querySelector('#target-profile'),
  orientation: document.querySelector('#orientation'),
  targetSummary: document.querySelector('#target-summary'),
  customProfileToggle: document.querySelector('#custom-profile-toggle'),
  customProfileForm: document.querySelector('#custom-profile-form'),
  customName: document.querySelector('#custom-name'),
  customWidth: document.querySelector('#custom-width'),
  customHeight: document.querySelector('#custom-height'),
  deleteProfile: document.querySelector('#delete-profile'),
  start: document.querySelector('#start'),
  refresh: document.querySelector('#refresh'),
  preview: document.querySelector('#preview'),
  streamTitle: document.querySelector('#stream-title'),
  streamDetail: document.querySelector('#stream-detail'),
  error: document.querySelector('#error')
};

function showError(error) {
  elements.error.textContent = error?.message || String(error);
}

function allProfiles() {
  return [...builtInProfiles, ...customProfiles];
}

function currentProfile() {
  return allProfiles().find((profile) => profile.id === elements.targetProfile.value) || builtInProfiles[0];
}

function currentDimensions() {
  const profile = currentProfile();
  if (!profile) return { width: 1920, height: 1200 };
  return elements.orientation.value === 'portrait'
    ? { width: profile.height, height: profile.width }
    : { width: profile.width, height: profile.height };
}

function updateTargetSummary() {
  const profile = currentProfile();
  if (!profile) return;
  const { width, height } = currentDimensions();
  elements.targetSummary.textContent = `${profile.model} · ${width} × ${height} · 스트리밍 최대 60fps${profile.note ? ` · ${profile.note}` : ''}`;
  elements.deleteProfile.hidden = profile.brand !== '사용자';
  localStorage.setItem(SELECTED_PROFILE_KEY, profile.id);
}

function renderProfiles(selectedId = localStorage.getItem(SELECTED_PROFILE_KEY)) {
  const brands = new Map();
  for (const profile of allProfiles()) {
    if (!brands.has(profile.brand)) brands.set(profile.brand, []);
    brands.get(profile.brand).push(profile);
  }
  const groups = [...brands.entries()].map(([brand, profiles]) => {
    const group = document.createElement('optgroup');
    group.label = brand;
    for (const profile of profiles) {
      const option = document.createElement('option');
      option.value = profile.id;
      option.textContent = `${profile.model} — ${profile.width} × ${profile.height}`;
      group.append(option);
    }
    return group;
  });
  elements.targetProfile.replaceChildren(...groups);
  if (allProfiles().some((profile) => profile.id === selectedId)) elements.targetProfile.value = selectedId;
  updateTargetSummary();
}

async function loadProfiles() {
  const response = await fetch('device-profiles.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('기기 해상도 DB를 불러오지 못했습니다.');
  builtInProfiles = (await response.json()).profiles;
  try {
    const saved = JSON.parse(localStorage.getItem(CUSTOM_PROFILES_KEY) || '[]');
    customProfiles = Array.isArray(saved) ? saved : [];
  } catch {
    customProfiles = [];
  }
  renderProfiles();
}

function saveCustomProfiles() {
  localStorage.setItem(CUSTOM_PROFILES_KEY, JSON.stringify(customProfiles));
}

async function loadHostInfo() {
  const info = await window.hostApi.getHostInfo();
  elements.pin.textContent = info.pin;
  elements.addresses.replaceChildren(...info.addresses.map((address) => {
    const row = document.createElement('div');
    row.className = 'address';
    const code = document.createElement('code');
    code.textContent = address;
    const button = document.createElement('button');
    button.className = 'copy';
    button.textContent = '복사';
    button.addEventListener('click', async () => {
      await window.hostApi.copyText(address);
      button.textContent = '복사됨';
      setTimeout(() => { button.textContent = '복사'; }, 1200);
    });
    row.append(code, button);
    return row;
  }));
}

async function loadSources() {
  elements.sources.textContent = '디스플레이를 찾는 중…';
  const sources = await window.hostApi.getDisplaySources();
  elements.sources.replaceChildren(...sources.map((source, index) => {
    const button = document.createElement('button');
    button.className = 'source-card';
    button.dataset.sourceId = source.id;
    const image = document.createElement('img');
    image.alt = '';
    image.src = source.thumbnail;
    const name = document.createElement('span');
    name.textContent = source.name;
    button.append(image, name);
    button.addEventListener('click', () => selectSource(source, button));
    if (index === 0) queueMicrotask(() => selectSource(source, button));
    return button;
  }));
}

function selectSource(source, button) {
  selectedSource = source;
  document.querySelectorAll('.source-card').forEach((card) => card.classList.toggle('selected', card === button));
  elements.start.disabled = false;
}

async function startCapture() {
  if (!selectedSource) return;
  const previousStream = stream;
  const { width, height } = currentDimensions();
  const nextStream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: selectedSource.id,
        maxWidth: width,
        maxHeight: height,
        maxFrameRate: 60
      }
    }
  });
  const nextTrack = nextStream.getVideoTracks()[0];
  for (const peer of peers.values()) {
    const sender = peer.getSenders().find((item) => item.track?.kind === 'video');
    if (sender) await sender.replaceTrack(nextTrack);
  }
  stream = nextStream;
  for (const track of previousStream?.getTracks() || []) track.stop();
  const videoTrack = stream.getVideoTracks()[0];
  if ('contentHint' in videoTrack) videoTrack.contentHint = 'detail';
  elements.preview.srcObject = stream;
  elements.streamTitle.textContent = `${selectedSource.name} 전송 준비 완료`;
  elements.streamDetail.textContent = `${width} × ${height} · 최대 60fps · iPad 연결 대기 중`;
  elements.start.textContent = '전송 소스 변경';
  if (!polling) void pollHostEvents();
}

async function createPeer(sessionId, offer) {
  if (!stream) return;
  peers.get(sessionId)?.close();
  const peer = new RTCPeerConnection({ iceServers: [] });
  peers.set(sessionId, peer);

  peer.addEventListener('icecandidate', ({ candidate }) => {
    if (candidate) void api(`/api/sessions/${sessionId}/host-candidate`, pin, {
      method: 'POST', body: JSON.stringify({ candidate: candidate.toJSON() })
    }).catch(showError);
  });
  peer.addEventListener('connectionstatechange', () => {
    elements.streamDetail.textContent = peer.connectionState === 'connected'
      ? 'iPad 연결됨 · WebRTC로 화면 전송 중'
      : `연결 상태: ${peer.connectionState}`;
    if (['closed', 'failed', 'disconnected'].includes(peer.connectionState)) peers.delete(sessionId);
  });
  peer.addEventListener('datachannel', ({ channel }) => {
    channel.addEventListener('message', () => {
      // Touch messages are reserved for the native Windows input bridge milestone.
    });
  });

  await peer.setRemoteDescription(offer);
  // The receiver's offer already owns the video m-line. Reusing it is essential:
  // creating a second transceiver before setRemoteDescription can connect the
  // data channel while leaving Safari without a negotiated video track.
  const sender = peer.addTrack(stream.getVideoTracks()[0], stream);
  const transceiver = peer.getTransceivers().find((item) => item.sender === sender);
  preferH264(transceiver);
  for (const candidate of pendingCandidates.get(sessionId) || []) await peer.addIceCandidate(candidate);
  pendingCandidates.delete(sessionId);
  const answer = await peer.createAnswer();
  await peer.setLocalDescription(answer);
  await api(`/api/sessions/${sessionId}/answer`, pin, {
    method: 'POST', body: JSON.stringify({ answer: peer.localDescription.toJSON() })
  });
}

async function pollHostEvents() {
  polling = true;
  while (polling) {
    try {
      const { events } = await api(`/api/host/events?since=${hostEventSequence}`, pin);
      for (const event of events) {
        hostEventSequence = Math.max(hostEventSequence, event.id);
        const { sessionId } = event.payload;
        if (event.type === 'offer') await createPeer(sessionId, event.payload.offer);
        if (event.type === 'receiver-candidate') {
          const peer = peers.get(sessionId);
          if (peer?.remoteDescription) await peer.addIceCandidate(event.payload.candidate);
          else pendingCandidates.set(sessionId, [...(pendingCandidates.get(sessionId) || []), event.payload.candidate]);
        }
        if (event.type === 'close') {
          peers.get(sessionId)?.close();
          peers.delete(sessionId);
        }
      }
    } catch (error) {
      showError(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

elements.start.addEventListener('click', () => startCapture().catch(showError));
elements.refresh.addEventListener('click', () => loadSources().catch(showError));
elements.targetProfile.addEventListener('change', () => {
  updateTargetSummary();
  if (stream) void startCapture().catch(showError);
});
elements.orientation.addEventListener('change', () => {
  updateTargetSummary();
  if (stream) void startCapture().catch(showError);
});
elements.customProfileToggle.addEventListener('click', () => {
  elements.customProfileForm.hidden = !elements.customProfileForm.hidden;
  if (!elements.customProfileForm.hidden) elements.customName.focus();
});
elements.customProfileForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const width = Number(elements.customWidth.value);
  const height = Number(elements.customHeight.value);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 640 || height < 480 || width > 7680 || height > 4320) {
    showError(new Error('커스텀 해상도는 가로 640~7680, 세로 480~4320 범위의 정수여야 합니다.'));
    return;
  }
  const profile = {
    id: `custom-${crypto.randomUUID?.() || Date.now()}`,
    brand: '사용자',
    model: elements.customName.value.trim(),
    width: Math.max(width, height),
    height: Math.min(width, height),
    maxRefreshRate: 60
  };
  customProfiles.push(profile);
  saveCustomProfiles();
  renderProfiles(profile.id);
  elements.customProfileForm.hidden = true;
  elements.error.textContent = '';
  if (stream) void startCapture().catch(showError);
});
elements.deleteProfile.addEventListener('click', () => {
  const profile = currentProfile();
  if (profile?.brand !== '사용자') return;
  customProfiles = customProfiles.filter((item) => item.id !== profile.id);
  saveCustomProfiles();
  renderProfiles('balanced-1920x1200');
  if (stream) void startCapture().catch(showError);
});

Promise.all([loadHostInfo(), loadSources(), loadProfiles()]).catch(showError);
