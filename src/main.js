'use strict';

const os = require('node:os');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { app, BrowserWindow, Menu, Tray, nativeImage, clipboard, desktopCapturer, ipcMain, powerSaveBlocker, shell } = require('electron');
const { createDisplayServer } = require('./server');
const { DEFAULT_SETTINGS, createSettingsStore } = require('./settings-store');

const execFileAsync = promisify(execFile);

const PORT = Number(process.env.IPAD_DISPLAY_PORT) || 5178;
const PIN = String(Math.floor(100000 + Math.random() * 900000));
let mainWindow;
let displayServer;
let powerBlockerId;
let tray;
let settingsStore;
let settings = { ...DEFAULT_SETTINGS };
let isQuitting = false;
let trayHintShown = false;

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTrayIcon() {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#6f7cff"/><rect x="7" y="8" width="18" height="13" rx="2" fill="white"/><path d="M12 25h8M16 21v4" stroke="white" stroke-width="2" stroke-linecap="round"/></svg>';
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`).resize({ width: 20, height: 20 });
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
    const command = "$device = Get-PnpDevice -InstanceId 'ROOT\\MTTVDD\\*' -ErrorAction Stop | Select-Object -First 1; $device.Status";
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, timeout: 10000 });
    const status = stdout.trim();
    return { installed: Boolean(status), ready: status.toUpperCase() === 'OK', status };
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
      const result = JSON.parse(await fs.readFile(exchange.result, 'utf8'));
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

async function createWindow() {
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
  await mainWindow.loadURL(`http://127.0.0.1:${PORT}/host.html?pin=${PIN}`);
}

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return;
  settingsStore = createSettingsStore(app.getPath('userData'));
  settings = await settingsStore.load();
  if (settings.autoStart) applyAutoStart(true);
  displayServer = createDisplayServer({
    staticRoot: path.join(__dirname, '..', 'public'),
    pin: PIN,
    port: PORT,
    isPinAuthorized: (supplied) => supplied === PIN || Boolean(settings.masterCode && supplied === settings.masterCode),
    onSessionCountChanged: (count) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('session-count', count);
    }
  });
  await displayServer.start();
  powerBlockerId = powerSaveBlocker.start('prevent-display-sleep');

  ipcMain.handle('get-display-sources', async () => {
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 320, height: 180 } });
    return sources.map((source) => ({ id: source.id, name: source.name, thumbnail: source.thumbnail.toDataURL() }));
  });
  ipcMain.handle('get-host-info', () => ({
    pin: PIN,
    port: PORT,
    masterCodeConfigured: Boolean(settings.masterCode),
    addresses: localIpv4Addresses().map((address) => `http://${address}:${PORT}`)
  }));
  ipcMain.handle('get-settings', () => ({ ...settings, masterCodeConfigured: Boolean(settings.masterCode), autoStartAvailable: app.isPackaged }));
  ipcMain.handle('generate-master-code', () => String(crypto.randomInt(100000, 1000000)));
  ipcMain.handle('save-settings', async (_event, value) => {
    settings = await settingsStore.save(value);
    const autoStartApplied = applyAutoStart(settings.autoStart);
    return { ...settings, autoStartApplied, autoStartAvailable: app.isPackaged };
  });
  ipcMain.handle('copy-text', (_event, text) => clipboard.writeText(String(text)));
  ipcMain.handle('virtual-display-status', () => virtualDisplayStatus());
  ipcMain.handle('virtual-display-install', (_event, settings) => runVirtualDisplayOperation('install', settings));
  ipcMain.handle('virtual-display-configure', (_event, settings) => runVirtualDisplayOperation('configure', settings));
  ipcMain.handle('virtual-display-remove', () => runVirtualDisplayOperation('remove'));

  createTray();
  await createWindow();
});

app.on('second-instance', showMainWindow);
app.on('window-all-closed', () => {});

app.on('before-quit', () => {
  isQuitting = true;
  if (powerBlockerId !== undefined && powerSaveBlocker.isStarted(powerBlockerId)) powerSaveBlocker.stop(powerBlockerId);
  void displayServer?.stop();
});
