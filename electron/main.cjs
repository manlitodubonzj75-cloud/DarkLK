const { app, BrowserWindow, shell, session, ipcMain } = require('electron');
const path = require('path');

// Ensure app name is properly displayed in system trays, tasks and desktop environments
app.setName('DarkMSAL');

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'DarkMSAL',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    },
    backgroundColor: '#12151B',
    show: false,
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error(`[Load Error] code: ${errorCode}, desc: ${errorDescription}, url: ${validatedURL}`);
  });

  // Platform-consistent OS & UA metadata for seamless Anti-WAF compatibility
  let osName = 'GNU/Linux';
  let uaPlatform = 'X11; Linux x86_64';
  if (process.platform === 'win32') {
    osName = 'Windows';
    uaPlatform = 'Windows NT 10.0; Win64; x64';
  } else if (process.platform === 'darwin') {
    osName = 'macOS';
    uaPlatform = 'Macintosh; Intel Mac OS X 10_15_7';
  }

  const browserUserAgent = `Mozilla/5.0 (${uaPlatform}; rv:135.0) Gecko/20100101 Firefox/135.0`;
  const deviceModelHeader = `ClientType: browser, ClientName: Firefox, ClientVersion: 135.0, DeviceOS: ${osName}, DeviceType: desktop`;

  // Inject required CORS/Origin/Sec headers for direct connection to official MSAL APIs
  // Completely eliminates intermediate proxies, 100% compliant with 152-FZ
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const url = details.url || '';
    if (url.includes('mail.msal.ru')) {
      details.requestHeaders['Origin'] = 'https://mail.msal.ru';
      details.requestHeaders['Referer'] = 'https://mail.msal.ru/owa/';
      details.requestHeaders['User-Agent'] = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';
    } else if (url.includes('lk.msal.ru')) {
      details.requestHeaders['Origin'] = 'https://lk.msal.ru';
      details.requestHeaders['Referer'] = 'https://lk.msal.ru/';
      details.requestHeaders['User-Agent'] = browserUserAgent;
      details.requestHeaders['X-Device-Model'] = deviceModelHeader;
      details.requestHeaders['Sec-Fetch-Dest'] = 'empty';
      details.requestHeaders['Sec-Fetch-Mode'] = 'cors';
      details.requestHeaders['Sec-Fetch-Site'] = 'same-site';
      details.requestHeaders['Accept-Language'] = 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7';
    }
    callback({ cancel: false, requestHeaders: details.requestHeaders });
  });

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = { ...details.responseHeaders };
    const requestOrigin = details.requestHeaders?.['Origin'] || 'http://localhost:5173';
    responseHeaders['Access-Control-Allow-Origin'] = [requestOrigin];
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

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

// IPC handler for Node-level mail requests (bypasses browser CORS/Cookie restrictions entirely)
ipcMain.handle('mail-request', async (event, { url, method = 'GET', headers = {}, body = null, redirect = 'manual' }) => {
  try {
    const res = await globalThis.fetch(url, {
      method,
      headers,
      body,
      redirect
    });

    const status = res.status;
    const statusText = res.statusText;
    const ok = res.ok;
    const headersObj = {};
    for (const [k, v] of res.headers.entries()) {
      headersObj[k.toLowerCase()] = v;
    }

    let setCookie = null;
    if (res.headers.getSetCookie) {
      setCookie = res.headers.getSetCookie();
    } else if (res.headers.get('set-cookie')) {
      setCookie = res.headers.get('set-cookie');
    }

    const text = await res.text();
    return {
      success: true,
      status,
      statusText,
      ok,
      headers: headersObj,
      setCookie,
      text
    };
  } catch (err) {
    return {
      success: false,
      error: err.message
    };
  }
});

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
