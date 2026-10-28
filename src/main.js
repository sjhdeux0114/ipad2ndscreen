'use strict';

const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, Menu, clipboard, desktopCapturer, ipcMain, powerSaveBlocker } = require('electron');
const { createDisplayServer } = require('./server');

const PORT = Number(process.env.IPAD_DISPLAY_PORT) || 5178;
const PIN = String(Math.floor(100000 + Math.random() * 900000));
let mainWindow;
let displayServer;
let powerBlockerId;

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
    backgroundColor: '#0b1020',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  await mainWindow.loadURL(`http://127.0.0.1:${PORT}/host.html?pin=${PIN}`);
}

app.whenReady().then(async () => {
  displayServer = createDisplayServer({
    staticRoot: path.join(__dirname, '..', 'public'),
    pin: PIN,
    port: PORT,
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
    addresses: localIpv4Addresses().map((address) => `http://${address}:${PORT}`)
  }));
  ipcMain.handle('copy-text', (_event, text) => clipboard.writeText(String(text)));

  await createWindow();
});

app.on('window-all-closed', () => app.quit());

app.on('before-quit', () => {
  if (powerBlockerId !== undefined && powerSaveBlocker.isStarted(powerBlockerId)) powerSaveBlocker.stop(powerBlockerId);
  void displayServer?.stop();
});
