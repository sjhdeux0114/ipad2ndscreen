'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hostApi', {
  getDisplaySources: () => ipcRenderer.invoke('get-display-sources'),
  getHostInfo: () => ipcRenderer.invoke('get-host-info'),
  copyText: (text) => ipcRenderer.invoke('copy-text', text)
});
