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
let capturePromise = null;
let builtInProfiles = [];
let customProfiles = [];
const CUSTOM_PROFILES_KEY = 'ipad-display.custom-profiles.v1';
const SELECTED_PROFILE_KEY = 'ipad-display.selected-profile.v1';
const DISPLAY_SCALE_KEY = 'ipad-display.scale.v1';
let virtualDisplayInstalled = false;

const elements = {
  addresses: document.querySelector('#addresses'),
  pin: document.querySelector('#pin'),
  sources: document.querySelector('#sources'),
  targetProfile: document.querySelector('#target-profile'),
  orientation: document.querySelector('#orientation'),
  displayScale: document.querySelector('#display-scale'),
  latencyProfile: document.querySelector('#latency-profile'),
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
  error: document.querySelector('#error'),
  virtualDisplayStatus: document.querySelector('#virtual-display-status'),
  virtualDisplayMessage: document.querySelector('#virtual-display-message'),
  applyVirtualDisplay: document.querySelector('#apply-virtual-display'),
  removeVirtualDisplay: document.querySelector('#remove-virtual-display'),
  settingsForm: document.querySelector('#settings-form'),
  autoStart: document.querySelector('#auto-start'),
  masterCode: document.querySelector('#master-code'),
  generateMasterCode: document.querySelector('#generate-master-code'),
  settingsMessage: document.querySelector('#settings-message')
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

function streamTuning() {
  const { width, height } = currentDimensions();
  const profile = elements.latencyProfile.value;
  const pixelsPerSecond = width * height * 60;
  const factors = { 'ultra-low': 0.12, balanced: 0.18, quality: 0.28 };
  const limits = {
    'ultra-low': [12_000_000, 42_000_000],
    balanced: [16_000_000, 58_000_000],
    quality: [20_000_000, 80_000_000]
  };
  const [minimum, maximum] = limits[profile] || limits['ultra-low'];
  return {
    bitrate: Math.max(minimum, Math.min(maximum, Math.round(pixelsPerSecond * (factors[profile] || factors['ultra-low'])))),
    contentHint: profile === 'quality' ? 'detail' : 'motion',
    degradationPreference: profile === 'quality' ? 'maintain-resolution' : 'maintain-framerate'
  };
}

async function tuneSender(sender) {
  if (!sender) return;
  const tuning = streamTuning();
  const apply = async (includePriority) => {
    const parameters = sender.getParameters();
    parameters.encodings ??= [{}];
    parameters.encodings[0].maxBitrate = tuning.bitrate;
    parameters.encodings[0].maxFramerate = 60;
    if (includePriority) parameters.encodings[0].priority = 'high';
    parameters.degradationPreference = tuning.degradationPreference;
    await sender.setParameters(parameters);
  };
  try {
    await apply(true);
  } catch {
    try { await apply(false); } catch { /* Browser keeps its safe defaults. */ }
  }
}

function updateTargetSummary() {
  const profile = currentProfile();
  if (!profile) return;
  const { width, height } = currentDimensions();
  const latencyLabel = elements.latencyProfile.selectedOptions[0]?.textContent || '초저지연';
  elements.targetSummary.textContent = `${profile.model} · ${width} × ${height} · Windows 배율 ${elements.displayScale.value}% · ${latencyLabel} · 최대 60fps${profile.note ? ` · ${profile.note}` : ''}`;
  elements.deleteProfile.hidden = profile.brand !== '사용자';
  localStorage.setItem(SELECTED_PROFILE_KEY, profile.id);
  localStorage.setItem(DISPLAY_SCALE_KEY, elements.displayScale.value);
}

async function loadSettings() {
  const saved = await window.hostApi.getSettings();
  elements.autoStart.checked = saved.autoStart;
  elements.autoStart.disabled = !saved.autoStartAvailable;
  elements.masterCode.value = saved.masterCode || '';
  elements.latencyProfile.value = saved.latencyProfile || 'ultra-low';
  if (!saved.autoStartAvailable) elements.settingsMessage.textContent = '자동 실행은 설치 버전에서 사용할 수 있습니다.';
  updateTargetSummary();
}

async function saveSettings({ announce = true } = {}) {
  const masterCode = elements.masterCode.value.trim();
  if (masterCode && !/^\d{6}$/.test(masterCode)) throw new Error('마스터 코드는 숫자 6자리여야 합니다.');
  const saved = await window.hostApi.saveSettings({
    autoStart: elements.autoStart.checked,
    masterCode,
    latencyProfile: elements.latencyProfile.value
  });
  if (announce) {
    const codeMessage = saved.masterCode ? '마스터 코드가 즉시 활성화되었습니다.' : '마스터 코드를 사용하지 않습니다.';
    const startupMessage = saved.autoStart && saved.autoStartAvailable
      ? ' Windows 자동 실행도 켰습니다.'
      : saved.autoStartAvailable ? ' Windows 자동 실행은 꺼져 있습니다.' : '';
    elements.settingsMessage.textContent = codeMessage + startupMessage;
  }
  return saved;
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

async function loadSources(preferredId = selectedSource?.id, previousIds = null) {
  elements.sources.textContent = '디스플레이를 찾는 중…';
  const sources = await window.hostApi.getDisplaySources();
  const preferred = sources.find((source) => source.id === preferredId)
    || (previousIds ? sources.find((source) => !previousIds.has(source.id)) : null)
    || sources.find((source) => source.preferred)
    || sources[0];
  const buttons = sources.map((source) => {
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
    return button;
  });
  elements.sources.replaceChildren(...buttons);
  const preferredIndex = sources.findIndex((source) => source.id === preferred?.id);
  if (preferredIndex >= 0) selectSource(sources[preferredIndex], buttons[preferredIndex]);
  return sources;
}

async function refreshVirtualDisplayStatus() {
  const status = await window.hostApi.getVirtualDisplayStatus();
  virtualDisplayInstalled = status.installed;
  elements.virtualDisplayStatus.textContent = status.ready ? '가상 화면 준비됨' : status.installed ? '가상 화면 확인 필요' : '아직 설치되지 않음';
  elements.virtualDisplayStatus.classList.toggle('ready', status.ready);
  elements.applyVirtualDisplay.textContent = status.installed ? '해상도·배율 적용' : '가상 확장 화면 만들기';
  elements.removeVirtualDisplay.hidden = !status.installed;
}

async function applyVirtualDisplay() {
  const previousSources = await window.hostApi.getDisplaySources();
  const previousIds = new Set(previousSources.map((source) => source.id));
  const { width, height } = currentDimensions();
  const settings = { width, height, scale: Number(elements.displayScale.value) };
  elements.applyVirtualDisplay.disabled = true;
  elements.removeVirtualDisplay.disabled = true;
  elements.virtualDisplayMessage.textContent = '관리자 승인 후 가상 디스플레이를 설정합니다…';
  elements.error.textContent = '';
  try {
    const result = virtualDisplayInstalled
      ? await window.hostApi.configureVirtualDisplay(settings)
      : await window.hostApi.installVirtualDisplay(settings);
    elements.virtualDisplayMessage.textContent = result.message;
    await new Promise((resolve) => setTimeout(resolve, 1800));
    await refreshVirtualDisplayStatus();
    await loadSources(null, previousIds);
  } finally {
    elements.applyVirtualDisplay.disabled = false;
    elements.removeVirtualDisplay.disabled = false;
  }
}

async function removeVirtualDisplay() {
  elements.removeVirtualDisplay.disabled = true;
  elements.applyVirtualDisplay.disabled = true;
  elements.virtualDisplayMessage.textContent = '가상 디스플레이를 제거하는 중…';
  try {
    const result = await window.hostApi.removeVirtualDisplay();
    elements.virtualDisplayMessage.textContent = result.message;
    await refreshVirtualDisplayStatus();
    await loadSources();
  } finally {
    elements.removeVirtualDisplay.disabled = false;
    elements.applyVirtualDisplay.disabled = false;
  }
}

function selectSource(source, button) {
  selectedSource = source;
  document.querySelectorAll('.source-card').forEach((card) => card.classList.toggle('selected', card === button));
  elements.start.disabled = false;
  const { id, name, displayId } = source;
  void window.hostApi.rememberDisplaySource({ id, name, displayId }).catch(showError);
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
  const tuning = streamTuning();
  if ('contentHint' in nextTrack) nextTrack.contentHint = tuning.contentHint;
  for (const peer of peers.values()) {
    const sender = peer.getSenders().find((item) => item.track?.kind === 'video');
    if (sender) {
      await sender.replaceTrack(nextTrack);
      await tuneSender(sender);
    }
  }
  stream = nextStream;
  for (const track of previousStream?.getTracks() || []) track.stop();
  elements.preview.srcObject = stream;
  elements.streamTitle.textContent = `${selectedSource.name} 전송 준비 완료`;
  elements.streamDetail.textContent = `${width} × ${height} · 최대 60fps · iPad 연결 대기 중`;
  elements.start.textContent = '전송 소스 변경';
  if (!polling) void pollHostEvents();
}

async function ensureCaptureStarted({ force = false } = {}) {
  const hasLiveVideo = stream?.getVideoTracks().some((track) => track.readyState === 'live');
  if (!force && hasLiveVideo) return stream;
  if (!selectedSource) await loadSources();
  if (!selectedSource) throw new Error('전송할 디스플레이를 찾지 못했습니다.');
  if (!capturePromise) {
    capturePromise = startCapture().finally(() => { capturePromise = null; });
  }
  await capturePromise;
  return stream;
}

async function createPeer(sessionId, offer) {
  await ensureCaptureStarted();
  peers.get(sessionId)?.close();
  const peer = new RTCPeerConnection({ iceServers: [], bundlePolicy: 'max-bundle', rtcpMuxPolicy: 'require' });
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
    if (peer.connectionState === 'connected') {
      const sender = peer.getSenders().find((item) => item.track?.kind === 'video');
      void tuneSender(sender);
    }
    if (['closed', 'failed', 'disconnected'].includes(peer.connectionState)) peers.delete(sessionId);
  });
  peer.addEventListener('datachannel', ({ channel }) => {
    channel.addEventListener('message', ({ data }) => {
      try {
        const message = JSON.parse(data);
        if (message.type === 'telemetry') {
          elements.streamDetail.textContent = `iPad 연결됨 · ${message.fps || 0}fps · RTT ${message.rttMs ?? '-'}ms · 버퍼 ${message.jitterMs ?? '-'}ms · 디코드 ${message.decodeMs ?? '-'}ms · ${message.codec || 'H.264'}`;
        }
      } catch {
        // Touch input messages are handled by the native input milestone.
      }
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
  await tuneSender(sender);
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
        hostEventSequence = Math.max(hostEventSequence, event.id);
      }
    } catch (error) {
      showError(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
}

elements.start.addEventListener('click', () => ensureCaptureStarted({ force: true }).catch(showError));
elements.refresh.addEventListener('click', () => loadSources().catch(showError));
elements.applyVirtualDisplay.addEventListener('click', () => applyVirtualDisplay().catch(showError));
elements.removeVirtualDisplay.addEventListener('click', () => removeVirtualDisplay().catch(showError));
elements.targetProfile.addEventListener('change', () => {
  updateTargetSummary();
  if (stream) void ensureCaptureStarted({ force: true }).catch(showError);
});
elements.orientation.addEventListener('change', () => {
  updateTargetSummary();
  if (stream) void ensureCaptureStarted({ force: true }).catch(showError);
});
elements.displayScale.addEventListener('change', updateTargetSummary);
elements.latencyProfile.addEventListener('change', () => {
  updateTargetSummary();
  for (const peer of peers.values()) {
    const sender = peer.getSenders().find((item) => item.track?.kind === 'video');
    void tuneSender(sender);
  }
  void saveSettings({ announce: false }).catch(showError);
});
elements.settingsForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void saveSettings().catch(showError);
});
elements.masterCode.addEventListener('input', () => {
  elements.masterCode.value = elements.masterCode.value.replace(/\D/g, '').slice(0, 6);
});
elements.generateMasterCode.addEventListener('click', async () => {
  elements.masterCode.value = await window.hostApi.generateMasterCode();
  elements.masterCode.focus();
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
  if (stream) void ensureCaptureStarted({ force: true }).catch(showError);
});
elements.deleteProfile.addEventListener('click', () => {
  const profile = currentProfile();
  if (profile?.brand !== '사용자') return;
  customProfiles = customProfiles.filter((item) => item.id !== profile.id);
  saveCustomProfiles();
  renderProfiles('balanced-1920x1200');
  if (stream) void ensureCaptureStarted({ force: true }).catch(showError);
});

elements.displayScale.value = localStorage.getItem(DISPLAY_SCALE_KEY) || '150';
Promise.all([loadHostInfo(), loadProfiles(), loadSettings(), refreshVirtualDisplayStatus()])
  .then(() => loadSources())
  .then(() => { if (!polling) void pollHostEvents(); })
  .catch(showError);
