const { app, BrowserWindow, ipcMain, shell, dialog, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const { initUpdater } = require('./updater.cjs');

let mainWindow;

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
const DEV_URL = 'http://localhost:5173';

// Единственные хосты, куда main-процесс ходит по просьбе рендерера
const API_ORIGINS = new Set(['https://lk.msal.ru:3443']);
const MAIL_ORIGINS = new Set(['https://mail.msal.ru']);

// Какие ссылки можно отдавать во внешний браузер/почтовик
const EXTERNAL_PROTOCOLS = new Set(['https:', 'http:', 'mailto:']);

function isAllowedExternal(url) {
  try {
    return EXTERNAL_PROTOCOLS.has(new URL(url).protocol);
  } catch (_) {
    return false;
  }
}

function assertOrigin(url, allowed) {
  let u;
  try {
    u = new URL(url);
  } catch (_) {
    throw new Error('Некорректный URL');
  }
  if (!allowed.has(u.origin)) {
    throw new Error(`Запрос на ${u.origin} запрещён`);
  }
  return u;
}

// IPC принимаем только от главного фрейма нашего окна
function assertTrustedSender(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) {
    throw new Error('Untrusted IPC sender');
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'DarkMSAL',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false
    },
    autoHideMenuBar: true,
    show: false
  });

  if (isDev) {
    mainWindow.loadURL(DEV_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Новые окна (ссылки из писем и т.п.) — только http/https/mailto и только во внешнем браузере
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternal(url)) {
      shell.openExternal(url).catch(() => {});
    }
    return { action: 'deny' };
  });

  // Само окно приложения никуда не уходит со своей страницы
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const appUrl = mainWindow.webContents.getURL();
    const sameApp = isDev ? url.startsWith(DEV_URL) : url.split('#')[0] === appUrl.split('#')[0];
    if (!sameApp) {
      event.preventDefault();
      if (isAllowedExternal(url)) shell.openExternal(url).catch(() => {});
    }
  });
}

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault());
});

/* ------------------------------------------------------------------ */
/* Ключ шифрования локальных данных (safeStorage = Keychain/DPAPI/libsecret) */
/* ------------------------------------------------------------------ */

function vaultKeyPath() {
  return path.join(app.getPath('userData'), 'vault.key');
}

function safeStorageUsable() {
  if (!safeStorage.isEncryptionAvailable()) return false;
  // На Linux без keyring Electron молча использует захардкоженный ключ — это не защита
  if (process.platform === 'linux' && typeof safeStorage.getSelectedStorageBackend === 'function') {
    const backend = safeStorage.getSelectedStorageBackend();
    if (backend === 'basic_text' || backend === 'unknown') return false;
  }
  return true;
}

ipcMain.handle('vault-key', async (event, op, value) => {
  assertTrustedSender(event);
  if (!safeStorageUsable()) return null;
  const file = vaultKeyPath();
  if (op === 'get') {
    if (!fs.existsSync(file)) return null;
    try {
      return safeStorage.decryptString(fs.readFileSync(file));
    } catch (_) {
      return null;
    }
  }
  if (op === 'set') {
    if (typeof value !== 'string' || !value) return false;
    fs.writeFileSync(file, safeStorage.encryptString(value), { mode: 0o600 });
    return true;
  }
  if (op === 'delete') {
    try { fs.unlinkSync(file); } catch (_) {}
    return true;
  }
  return null;
});

/* ------------------------------------------------------------------ */
/* Сетевые запросы (обход CORS) — строго на lk.msal.ru:3443 и mail.msal.ru */
/* ------------------------------------------------------------------ */

async function doRequest({ url, method = 'GET', headers = {}, body = null, redirect = 'manual', timeout = 30000 }) {
  const res = await globalThis.fetch(url, {
    method,
    headers,
    body,
    redirect: redirect === 'follow' ? 'follow' : 'manual',
    signal: AbortSignal.timeout(Math.min(Math.max(Number(timeout) || 30000, 1000), 60000))
  });

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
    status: res.status,
    statusText: res.statusText,
    ok: res.ok,
    headers: headersObj,
    setCookie,
    text,
    data: text
  };
}

function makeRequestHandler(allowedOrigins) {
  return async (event, options = {}) => {
    try {
      assertTrustedSender(event);
      assertOrigin(options.url, allowedOrigins);
      return await doRequest(options);
    } catch (err) {
      return { success: false, error: err.message, status: 0 };
    }
  };
}

ipcMain.handle('api-request', makeRequestHandler(API_ORIGINS));
ipcMain.handle('mail-request', makeRequestHandler(MAIL_ORIGINS));

/* ------------------------------------------------------------------ */
/* Скачивание вложений почты                                          */
/* ------------------------------------------------------------------ */

function safeFileName(name) {
  const base = path.basename(String(name || 'attachment')).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim();
  return base && base !== '.' && base !== '..' ? base.slice(0, 200) : 'attachment';
}

ipcMain.handle('mail-download', async (event, { url, fileName, headers = {}, base64Data } = {}) => {
  try {
    assertTrustedSender(event);

    let buffer;
    if (typeof base64Data === 'string' && base64Data) {
      buffer = Buffer.from(base64Data, 'base64');
    } else {
      assertOrigin(url, MAIL_ORIGINS);
      const res = await globalThis.fetch(url, {
        method: 'GET',
        headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(120000)
      });
      if (!res.ok) {
        return { success: false, error: `Сервер почты вернул ${res.status}` };
      }
      buffer = Buffer.from(await res.arrayBuffer());
    }

    const cleanName = safeFileName(fileName);
    const { filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Сохранить вложение',
      defaultPath: path.join(app.getPath('downloads'), cleanName)
    });
    if (!filePath) {
      return { success: false, canceled: true };
    }

    fs.writeFileSync(filePath, buffer);
    return { success: true, fileName: path.basename(filePath), filePath };
  } catch (err) {
    console.error('[Electron] mail-download error:', err);
    return { success: false, error: err.message };
  }
});

app.whenReady().then(() => {
  initUpdater(() => mainWindow, assertTrustedSender);
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
