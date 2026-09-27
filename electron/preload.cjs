const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  platform: process.platform,
  apiBaseUrl: 'https://lk.msal.ru:3443',
  // main-процесс пропускает только https://lk.msal.ru:3443 и https://mail.msal.ru
  apiRequest: (options) => ipcRenderer.invoke('api-request', options),
  mailRequest: (options) => ipcRenderer.invoke('mail-request', options),
  mailDownload: (options) => ipcRenderer.invoke('mail-download', options),
  vaultKey: (op, value) => ipcRenderer.invoke('vault-key', op, value)
});
