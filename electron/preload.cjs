const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  platform: process.platform,
  apiBaseUrl: 'https://lk.msal.ru:3443',
  mailRequest: (options) => ipcRenderer.invoke('mail-request', options)
});
