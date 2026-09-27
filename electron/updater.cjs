/**
 * Автообновление десктопной версии из GitHub Releases.
 *
 * Схема: electron-updater качает установщик и проверяет его sha512 из latest*.yml.
 * Этого мало: yml лежит в том же релизе, и кто может править релиз — подменит оба.
 * Поэтому перед установкой проверяем собственную подпись Ed25519 над SHA256SUMS.txt
 * релиза. Приватный ключ есть только у мейнтейнера / в защищённом окружении CI,
 * публичный вшит в приложение (electron/update-public-key.pem).
 * Нет публичного ключа или подпись не сошлась — обновление НЕ ставится.
 */
const { app, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const OWNER = 'manlitodubonzj75-cloud';
const REPO = 'DarkLK';
const PUBLIC_KEY_PATH = path.join(__dirname, 'update-public-key.pem');

let autoUpdater = null;
let state = {
  status: 'idle', // idle | checking | available | none | downloading | verifying | ready | error | unsupported
  version: null,
  notes: null,
  progress: 0,
  error: null
};
let verifiedFile = null;
let getWindow = () => null;

function setState(patch) {
  state = { ...state, ...patch };
  const win = getWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send('update-state', state);
  }
}

function loadPublicKey() {
  try {
    const pem = fs.readFileSync(PUBLIC_KEY_PATH, 'utf8');
    const key = crypto.createPublicKey(pem);
    return key.asymmetricKeyType === 'ed25519' ? key : null;
  } catch (_) {
    return null;
  }
}

function unsupportedReason() {
  if (!app.isPackaged) return 'Автообновление работает только в собранном приложении';
  if (process.platform === 'darwin') return 'На macOS без подписи Apple автообновление невозможно — скачайте DMG вручную';
  if (process.platform === 'linux' && !process.env.APPIMAGE && !fs.existsSync(path.join(process.resourcesPath, 'package-type'))) {
    return 'Этот формат сборки не поддерживает автообновление';
  }
  if (!loadPublicKey()) return 'Ключ проверки обновлений не настроен в этой сборке';
  return null;
}

function stripHtml(s) {
  return typeof s === 'string' ? s.replace(/<[^>]+>/g, '').trim() : null;
}

function notesToText(notes) {
  if (Array.isArray(notes)) return notes.map((n) => stripHtml(n.note)).filter(Boolean).join('\n\n');
  return stripHtml(notes);
}

async function fetchText(url) {
  const res = await globalThis.fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} для ${path.basename(url)}`);
  return res.text();
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('error', reject).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex')));
  });
}

/**
 * Проверяет, что хотя бы один скачанный файл есть в подписанном списке хэшей релиза.
 */
async function verifyDownloaded(files, version) {
  const publicKey = loadPublicKey();
  if (!publicKey) throw new Error('Нет ключа проверки обновлений');

  const base = `https://github.com/${OWNER}/${REPO}/releases/download/v${version}`;
  const sums = await fetchText(`${base}/SHA256SUMS.txt`);
  const sigB64 = (await fetchText(`${base}/SHA256SUMS.txt.sig`)).trim();

  const ok = crypto.verify(null, Buffer.from(sums, 'utf8'), publicKey, Buffer.from(sigB64, 'base64'));
  if (!ok) throw new Error('Подпись обновления не прошла проверку');

  const allowed = new Set(
    sums.split(/\r?\n/).map((l) => l.trim().split(/\s+/)[0]).filter((h) => /^[a-f0-9]{64}$/i.test(h)).map((h) => h.toLowerCase())
  );

  for (const file of files) {
    if (!file || !fs.existsSync(file)) continue;
    if (!/\.(exe|AppImage|deb|rpm)$/i.test(file)) continue;
    const hash = await sha256File(file);
    if (allowed.has(hash)) return file;
  }
  throw new Error('Скачанный файл не совпадает с подписанным релизом');
}

function initUpdater(windowGetter, assertTrustedSender) {
  getWindow = windowGetter;
  const guard = (fn) => async (event, ...args) => {
    assertTrustedSender(event);
    return fn(...args);
  };

  const reason = unsupportedReason();
  if (reason) {
    state.status = 'unsupported';
    state.error = reason;
  } else {
    ({ autoUpdater } = require('electron-updater'));
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowPrerelease = false;
    autoUpdater.allowDowngrade = false;
    autoUpdater.setFeedURL({ provider: 'github', owner: OWNER, repo: REPO, releaseType: 'release' });

    autoUpdater.on('download-progress', (p) => {
      setState({ status: 'downloading', progress: Math.round(p.percent || 0) });
    });
    autoUpdater.on('error', (err) => {
      if (state.status === 'checking' || state.status === 'downloading') {
        setState({ status: 'error', error: err?.message || String(err) });
      }
    });
  }

  ipcMain.handle('update-get-state', guard(() => state));

  ipcMain.handle('update-check', guard(async () => {
    if (!autoUpdater) return state;
    if (['downloading', 'verifying', 'ready'].includes(state.status)) return state;
    setState({ status: 'checking', error: null });
    try {
      const result = await autoUpdater.checkForUpdates();
      const info = result?.updateInfo;
      if (result?.isUpdateAvailable && info?.version) {
        setState({ status: 'available', version: info.version, notes: notesToText(info.releaseNotes), progress: 0 });
      } else {
        setState({ status: 'none', version: info?.version || null });
      }
    } catch (err) {
      setState({ status: 'error', error: err?.message || String(err) });
    }
    return state;
  }));

  ipcMain.handle('update-download', guard(async () => {
    if (!autoUpdater) return state;
    if (state.status !== 'available' && state.status !== 'error') return state;
    if (!state.version) return state;
    try {
      setState({ status: 'downloading', progress: 0, error: null });
      const files = await autoUpdater.downloadUpdate();
      setState({ status: 'verifying', progress: 100 });
      verifiedFile = await verifyDownloaded(files, state.version);
      setState({ status: 'ready' });
    } catch (err) {
      verifiedFile = null;
      setState({ status: 'error', error: err?.message || String(err) });
    }
    return state;
  }));

  ipcMain.handle('update-install', guard(async () => {
    if (!autoUpdater || state.status !== 'ready' || !verifiedFile) return false;
    // Повторная сверка хэша прямо перед запуском установщика
    try {
      await verifyDownloaded([verifiedFile], state.version);
    } catch (err) {
      setState({ status: 'error', error: err?.message || String(err) });
      return false;
    }
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
    return true;
  }));
}

module.exports = { initUpdater, _verifyDownloaded: verifyDownloaded };
