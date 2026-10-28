'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hostApi', {
  getDisplaySources: () => ipcRenderer.invoke('get-display-sources'),
  getHostInfo: () => ipcRenderer.invoke('get-host-info'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  generateMasterCode: () => ipcRenderer.invoke('generate-master-code'),
  copyText: (text) => ipcRenderer.invoke('copy-text', text),
  getVirtualDisplayStatus: () => ipcRenderer.invoke('virtual-display-status'),
  installVirtualDisplay: (settings) => ipcRenderer.invoke('virtual-display-install', settings),
  configureVirtualDisplay: (settings) => ipcRenderer.invoke('virtual-display-configure', settings),
  removeVirtualDisplay: () => ipcRenderer.invoke('virtual-display-remove')
});
