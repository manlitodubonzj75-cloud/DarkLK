const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  platform: process.platform,
  apiBaseUrl: 'https://lk.msal.ru:3443'
});
