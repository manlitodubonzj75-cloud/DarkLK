const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  platform: process.platform,
  apiBaseUrl: 'https://lk.msal.ru:3443',
  // main-процесс пропускает только https://lk.msal.ru:3443 и https://mail.msal.ru
  apiRequest: (options) => ipcRenderer.invoke('api-request', options),
  mailRequest: (options) => ipcRenderer.invoke('mail-request', options),
  mailDownload: (options) => ipcRenderer.invoke('mail-download', options),
  vaultKey: (op, value) => ipcRenderer.invoke('vault-key', op, value),
  // Автообновление из GitHub Releases (с проверкой подписи Ed25519 в main-процессе)
  updates: {
    getState: () => ipcRenderer.invoke('update-get-state'),
    check: () => ipcRenderer.invoke('update-check'),
    download: () => ipcRenderer.invoke('update-download'),
    install: () => ipcRenderer.invoke('update-install'),
    onState: (cb) => {
      const listener = (_e, st) => cb(st);
      ipcRenderer.on('update-state', listener);
      return () => ipcRenderer.removeListener('update-state', listener);
    }
  }
});
