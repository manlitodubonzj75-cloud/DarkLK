const { app, BrowserWindow, session, shell } = require('electron');
const path = require('path');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: 'DarkMSAL',
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#12151B',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: false
    }
  });

  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Renderer Console] [${level}] ${message} (${sourceId}:${line})`);
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error(`[Load Error] code: ${errorCode}, desc: ${errorDescription}, url: ${validatedURL}`);
  });

  // Inject required CORS/Origin headers for direct connection to official MSAL APIs
  // Completely eliminates intermediate proxies, 100% compliant with 152-FZ
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const url = details.url || '';
    if (url.includes('lk.msal.ru') || url.includes('mail.msal.ru')) {
      details.requestHeaders['Origin'] = 'https://lk.msal.ru';
      details.requestHeaders['Referer'] = 'https://lk.msal.ru/';
      details.requestHeaders['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:150.0) Gecko/20100101 Firefox/150.0';
      details.requestHeaders['X-Device-Model'] = 'ClientType: browser, ClientName: Firefox, ClientVersion: 151.0, DeviceOS: Windows, DeviceType: desktop';
    }
    callback({ cancel: false, requestHeaders: details.requestHeaders });
  });

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = { ...details.responseHeaders };
    responseHeaders['Access-Control-Allow-Origin'] = ['*'];
    responseHeaders['Access-Control-Allow-Headers'] = ['*'];
    responseHeaders['Access-Control-Allow-Methods'] = ['GET, POST, PUT, PATCH, DELETE, OPTIONS'];
    responseHeaders['Access-Control-Allow-Credentials'] = ['true'];
    callback({ responseHeaders });
  });

  // Safe external navigation
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
