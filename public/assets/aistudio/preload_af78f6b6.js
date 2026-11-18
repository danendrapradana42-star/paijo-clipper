'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('autoClipperDesktop', {
  saveGeminiKey: (key) => ipcRenderer.invoke('gemini-key:set', key),
  clearGeminiKey: () => ipcRenderer.invoke('gemini-key:clear'),
  geminiKeyStatus: () => ipcRenderer.invoke('gemini-key:status'),
  openGoogleFlow: () => ipcRenderer.invoke('google-flow:open')
});
