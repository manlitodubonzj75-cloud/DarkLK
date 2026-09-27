const { app, BrowserWindow, ipcMain, shell, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

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
      webSecurity: false
    },
    autoHideMenuBar: true,
    show: false
  });

  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// IPC Handlers
ipcMain.handle('get-app-version', () => app.getVersion());

ipcMain.handle('open-external-url', async (event, url) => {
  await shell.openExternal(url);
  return true;
});

// Native Desktop Downloader (Mail Attachments & Reports)
ipcMain.handle('mail-download', async (event, { fileName, base64Data }) => {
  try {
    const { dialog } = require('electron');
    const { filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Сохранить вложение',
      defaultPath: path.join(app.getPath('downloads'), fileName || 'attachment')
    });

    if (!filePath) {
      return { success: false, canceled: true };
    }

    const buffer = Buffer.from(base64Data, 'base64');
    fs.writeFileSync(filePath, buffer);
    return { success: true, filePath };
  } catch (err) {
    console.error('[Electron] mail-download error:', err);
    return { success: false, error: err.message };
  }
});

// Native Desktop Mail Transport (Bypasses CORS & Cookie Policies for Exchange OWA)
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
      text,
      data: text
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
