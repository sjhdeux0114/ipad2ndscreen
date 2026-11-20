'use strict';

const os = require('node:os');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { app, BrowserWindow, Menu, Tray, nativeImage, clipboard, desktopCapturer, ipcMain, net, powerSaveBlocker, shell } = require('electron');
const { createDisplayServer } = require('./server');
const { DEFAULT_SETTINGS, createSettingsStore } = require('./settings-store');
const { createTrustedDeviceStore } = require('./trusted-device-store');
const { parseVirtualDisplayResult } = require('./virtual-display-result');
const { findPreferredDisplaySource, normalizeDisplaySource } = require('./display-source-preference');

const execFileAsync = promisify(execFile);

let serverPort;
const PIN = String(Math.floor(100000 + Math.random() * 900000));
let mainWindow;
let displayServer;
let powerBlockerId;
let tray;
let settingsStore;
let trustedDeviceStore;
let settings = { ...DEFAULT_SETTINGS };
let pendingSettingsWrite = Promise.resolve();

function updateSettings(changes) {
  const write = pendingSettingsWrite.then(async () => {
    settings = await settingsStore.save({ ...settings, ...changes });
    return settings;
  });
  pendingSettingsWrite = write.catch(() => {});
  return write;
}
let isQuitting = false;
let trayHintShown = false;
const TRAY_ICON_PNG = 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAZUlEQVR4nGNgwALya/7/pwXGZhfNLSXKMfS2HMMRI9sBA2U53BGjDsAnSS0w9B0gJmtOFh51wKgDRh0w6gCqOYBSMHQdQA9MtgNI8eWoA6jmAGokusHngAFvlo86YFB0Tgeyew4AvRsJoiIJLq8AAAAASUVORK5CYII=';

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTrayIcon() {
  const icon = nativeImage.createFromBuffer(Buffer.from(TRAY_ICON_PNG, 'base64'));
  if (icon.isEmpty()) throw new Error('트레이 아이콘을 불러오지 못했습니다.');
  return icon.resize({ width: 20, height: 20, quality: 'best' });
}

function createTray() {
  tray = new Tray(createTrayIcon());
  tray.setToolTip('iPad Display Server');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'iPad Display Server 열기', click: showMainWindow },
    { type: 'separator' },
    {
      label: '완전히 종료',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]));
  tray.on('click', showMainWindow);
  tray.on('double-click', showMainWindow);
}

function applyAutoStart(enabled) {
  if (!app.isPackaged) return false;
  const args = ['--hidden'];
  app.setLoginItemSettings({ openAtLogin: enabled, enabled, path: process.execPath, args });
  return app.getLoginItemSettings({ path: process.execPath, args }).openAtLogin;
}

function helperPath() {
  const root = app.isPackaged ? path.join(process.resourcesPath, 'app.asar.unpacked') : path.join(__dirname, '..');
  return path.join(root, 'native', 'DisplayManager', 'publish', 'DisplayManager.exe');
}

function driverExchangePaths() {
  const localAppData = process.env.LOCALAPPDATA || app.getPath('appData');
  const directory = path.join(localAppData, 'iPadDisplayServer');
  return {
    directory,
    command: path.join(directory, 'driver-command.json'),
    result: path.join(directory, 'driver-result.json')
  };
}

async function virtualDisplayStatus() {
  try {
    const command = "$device = Get-PnpDevice -InstanceId 'ROOT\\MTTVDD\\*' -ErrorAction SilentlyContinue | Where-Object Status -eq 'OK' | Select-Object -First 1; $device.Status";
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, timeout: 10000 });
    const status = stdout.trim();
    const ready = status.toUpperCase() === 'OK';
    return { installed: ready, ready, status };
  } catch {
    return { installed: false, ready: false, status: '' };
  }
}

async function runVirtualDisplayOperation(operation, settings = {}) {
  const executable = helperPath();
  await fs.access(executable);
  const exchange = driverExchangePaths();
  await fs.mkdir(exchange.directory, { recursive: true });
  const token = crypto.randomUUID();
  const command = {
    token,
    operation,
    width: Number(settings.width) || 1920,
    height: Number(settings.height) || 1200,
    scale: Number(settings.scale) || 150
  };
  await fs.rm(exchange.result, { force: true });
  await fs.writeFile(exchange.command, JSON.stringify(command), { encoding: 'utf8', mode: 0o600 });
  const launchError = await shell.openPath(executable);
  if (launchError) throw new Error(`관리자 도구를 실행하지 못했습니다: ${launchError}`);

  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    try {
      const result = parseVirtualDisplayResult(await fs.readFile(exchange.result, 'utf8'));
      if (result.token !== token) continue;
      if (!result.success) throw new Error(result.error || result.message);
      return result;
    } catch (error) {
      if (error.code === 'ENOENT' || error instanceof SyntaxError) continue;
      throw error;
    }
  }
  throw new Error('관리자 승인을 기다리는 시간이 초과되었습니다. 다시 시도해 주세요.');
}

function localIpv4Addresses() {
  const addresses = [];
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const item of interfaces || []) {
      if (item.family === 'IPv4' && !item.internal && !item.address.startsWith('169.254.')) addresses.push(item.address);
    }
  }
  return [...new Set(addresses)];
}

function createWindow() {
  Menu.setApplicationMenu(null);
  mainWindow = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 760,
    minHeight: 600,
    title: 'iPad Display Server',
    show: !process.argv.includes('--hidden'),
    backgroundColor: '#0b1020',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });
  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow.hide();
    if (!trayHintShown) {
      trayHintShown = true;
      tray?.displayBalloon({
        title: 'iPad Display Server가 계속 실행 중입니다',
        content: '작업 표시줄 알림 영역 아이콘에서 다시 열거나 완전히 종료할 수 있습니다.'
      });
    }
  });
}

function serverForPort(port) {
  return createDisplayServer({
    staticRoot: path.join(__dirname, '..', 'public'),
    pin: PIN,
    port,
    isPinAuthorized: (supplied) => supplied === PIN || Boolean(settings.masterCode && supplied === settings.masterCode),
    isDeviceAuthorized: (token) => trustedDeviceStore.isAuthorized(token),
    registerDevice: () => trustedDeviceStore.register(),
    onSessionCountChanged: (count) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('session-count', count);
    }
  });
}

let changingPort = false;
async function activatePort(port, persist) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('포트 번호는 1~65535 사이여야 합니다.');
  if (changingPort) throw new Error('포트를 변경하는 중입니다.');
  if (port === serverPort) {
    if (persist && settings.serverPort !== port) await updateSettings({ serverPort: port });
    return;
  }
  changingPort = true;
  const candidate = serverForPort(port);
  const previous = displayServer;
  const previousPort = serverPort;
  try {
    const address = await candidate.start();
    // Chromium and Safari refuse HTTP navigation on certain well-known ports.
    const url = `http://127.0.0.1:${address.port}/host.html?pin=${PIN}`;
    const probe = await net.fetch(url, { method: 'HEAD' });
    if (!probe.ok) throw new Error('서버의 접속 주소를 열 수 없습니다.');
    displayServer = candidate;
    serverPort = address.port;
    await mainWindow.loadURL(url);
    if (persist && settings.serverPort !== address.port) await updateSettings({ serverPort: address.port });
  } catch (error) {
    const switched = displayServer === candidate;
    displayServer = previous;
    serverPort = previousPort;
    if (switched && persist) {
      if (previous) await mainWindow.loadURL(`http://127.0.0.1:${previousPort}/host.html?pin=${PIN}`);
      else await showPortSettings(port, error);
    }
    await candidate.stop();
    if (error.code === 'EADDRINUSE') throw new Error(`${port} 포트를 다른 프로그램이 사용 중입니다.`);
    if (error.code === 'EACCES') throw new Error(`Windows에서 ${port} 포트 사용을 허용하지 않습니다.`);
    throw error;
  } finally {
    changingPort = false;
  }
  await previous?.stop();
  if (powerBlockerId === undefined) powerBlockerId = powerSaveBlocker.start('prevent-display-sleep');
}

async function showPortSettings(port, error) {
  await mainWindow.loadFile(path.join(__dirname, '..', 'public', 'port-settings.html'), {
    query: { port: String(port), error: error.message }
  });
  showMainWindow();
}

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return;
  settingsStore = createSettingsStore(app.getPath('userData'));
  trustedDeviceStore = createTrustedDeviceStore(app.getPath('userData'));
  await trustedDeviceStore.load();
  settings = await settingsStore.load();
  if (settings.autoStart) applyAutoStart(true);
  ipcMain.handle('change-server-port', async (_event, port) => {
    try {
      await activatePort(port, true);
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error.message };
    }
  });

  ipcMain.handle('get-display-sources', async () => {
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 320, height: 180 } });
    const serialized = sources.map((source) => ({
      id: source.id,
      name: source.name,
      displayId: String(source.display_id || ''),
      thumbnail: source.thumbnail.toDataURL()
    }));
    const preferred = findPreferredDisplaySource(serialized, settings.lastDisplaySource);
    return serialized.map((source) => ({ ...source, preferred: source.id === preferred?.id }));
  });
  ipcMain.handle('get-host-info', () => ({
    pin: PIN,
    port: serverPort,
    masterCodeConfigured: Boolean(settings.masterCode),
    addresses: localIpv4Addresses().map((address) => `http://${address}:${serverPort}`)
  }));
  ipcMain.handle('get-settings', () => ({ ...settings, masterCodeConfigured: Boolean(settings.masterCode), autoStartAvailable: app.isPackaged }));
  ipcMain.handle('generate-master-code', () => String(crypto.randomInt(100000, 1000000)));
  ipcMain.handle('save-settings', async (_event, value) => {
    await updateSettings(value);
    const autoStartApplied = applyAutoStart(settings.autoStart);
    return { ...settings, autoStartApplied, autoStartAvailable: app.isPackaged };
  });
  ipcMain.handle('remember-display-source', async (_event, source) => {
    await updateSettings({ lastDisplaySource: normalizeDisplaySource(source) });
    return settings.lastDisplaySource;
  });
  ipcMain.handle('copy-text', (_event, text) => clipboard.writeText(String(text)));
  ipcMain.handle('virtual-display-status', () => virtualDisplayStatus());
  ipcMain.handle('virtual-display-install', (_event, settings) => runVirtualDisplayOperation('install', settings));
  ipcMain.handle('virtual-display-configure', (_event, settings) => runVirtualDisplayOperation('configure', settings));
  ipcMain.handle('virtual-display-remove', () => runVirtualDisplayOperation('remove'));

  createTray();
  createWindow();
  const port = Number(process.env.IPAD_DISPLAY_PORT) || settings.serverPort;
  try {
    await activatePort(port, false);
  } catch (error) {
    await showPortSettings(port, error);
  }
}).catch((error) => {
  require('electron').dialog.showErrorBox('iPad Display Server 시작 실패', error.message);
  app.quit();
});

app.on('second-instance', showMainWindow);
app.on('window-all-closed', () => {});

app.on('before-quit', () => {
  isQuitting = true;
  if (powerBlockerId !== undefined && powerSaveBlocker.isStarted(powerBlockerId)) powerSaveBlocker.stop(powerBlockerId);
  void displayServer?.stop();
});
