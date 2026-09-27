/**
 * Update Service for DarkMSAL
 *
 * Источник обновлений — GitHub Releases репозитория.
 *  - Windows / Linux (Electron): electron-updater в main-процессе, скачивание + проверка
 *    подписи Ed25519 + установка с перезапуском (electron/updater.cjs).
 *  - Android: манифест latest.json из релиза, APK качается и проверяется нативно
 *    (AppUpdater.java), установку подтверждает пользователь в системном окне.
 *  - Userscript: обновляет менеджер скриптов по @updateURL.
 *  - iOS / macOS / web: уведомление + ручное скачивание.
 */
import { CapacitorHttp } from '@capacitor/core';

export const APP_VERSION = '1.1.0';
const GITHUB_REPO = 'manlitodubonzj75-cloud/DarkLK';
const API_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
const MANIFEST_URL = `https://github.com/${GITHUB_REPO}/releases/latest/download/latest.json`;
const RELEASE_DOWNLOAD_BASE = `https://github.com/${GITHUB_REPO}/releases/download`;
const LAST_CHECK_KEY = 'msal_last_update_check';
const DISMISSED_VERSION_KEY = 'msal_dismissed_update_version';

/**
 * Compare two semver strings (e.g. "2.0.2" vs "2.0.1")
 * Returns:
 *   1 if v1 > v2
 *   -1 if v1 < v2
 *   0 if equal
 */
export function compareSemver(v1, v2) {
  if (!v1 || !v2) return 0;
  const clean1 = String(v1).replace(/^v/i, '').trim();
  const clean2 = String(v2).replace(/^v/i, '').trim();

  const parts1 = clean1.split('.').map(n => parseInt(n, 10) || 0);
  const parts2 = clean2.split('.').map(n => parseInt(n, 10) || 0);

  const len = Math.max(parts1.length, parts2.length);
  for (let i = 0; i < len; i++) {
    const a = parts1[i] || 0;
    const b = parts2[i] || 0;
    if (a > b) return 1;
    if (a < b) return -1;
  }
  return 0;
}

/**
 * Detect current platform
 */
export function getAppPlatform() {
  if (typeof window === 'undefined') return 'unknown';

  if (Boolean(window.__DARKMSAL_USERSCRIPT__)) return 'userscript';

  const capPlatform = window.Capacitor?.getPlatform?.();
  if (capPlatform === 'ios') return 'ios';
  if (capPlatform === 'android') return 'android';

  const ua = (navigator.userAgent || '').toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return 'ios';
  if (/android/.test(ua)) return 'android';

  if (window.electronAPI) {
    if (/macintosh|mac os x/.test(ua)) return 'mac';
    if (/windows/.test(ua)) return 'win';
    return 'linux';
  }

  if (/macintosh|mac os x/.test(ua)) return 'mac';
  if (/windows/.test(ua)) return 'win';
  if (/linux/.test(ua)) return 'linux';

  return 'web';
}

/**
 * Find matching asset from release for current platform
 */
export function findPlatformAsset(assets, platform) {
  if (!Array.isArray(assets) || assets.length === 0) return null;

  switch (platform) {
    case 'userscript': {
      return assets.find(a => a.name?.toLowerCase().endsWith('.user.js')) || null;
    }
    case 'ios': {
      // Look for .ipa file
      return assets.find(a => a.name?.toLowerCase().endsWith('.ipa')) || null;
    }
    case 'android': {
      // Look for .apk file
      return assets.find(a => a.name?.toLowerCase().endsWith('.apk')) || null;
    }
    case 'mac': {
      return assets.find(a => a.name?.toLowerCase().endsWith('.dmg')) ||
        assets.find(a => a.name?.toLowerCase().endsWith('.zip')) || null;
    }
    case 'win': {
      return assets.find(a => a.name?.toLowerCase().endsWith('.exe')) || null;
    }
    case 'linux': {
      return assets.find(a => a.name?.toLowerCase().endsWith('.appimage')) ||
        assets.find(a => a.name?.toLowerCase().endsWith('.deb')) || null;
    }
    default:
      return assets[0] || null;
  }
}

function getElectronUpdates() {
  return typeof window !== 'undefined' ? window.electronAPI?.updates || null : null;
}

function getAndroidUpdater() {
  return typeof window !== 'undefined' && window.Capacitor?.getPlatform?.() === 'android'
    ? window.AndroidUpdater || null
    : null;
}

function isDismissed(version) {
  try {
    return localStorage.getItem(DISMISSED_VERSION_KEY) === String(version).replace(/^v/i, '');
  } catch (_) {
    return false;
  }
}

async function fetchManifest() {
  // Нативный HTTP: без CORS и без лимита GitHub API (60 запросов/час на IP — в сети вуза это мало)
  const res = await CapacitorHttp.get({
    url: `${MANIFEST_URL}?t=${Date.now()}`,
    responseType: 'json',
    connectTimeout: 15000,
    readTimeout: 15000
  });
  if (res.status < 200 || res.status >= 300) {
    const err = new Error(`Манифест обновления: HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const data = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
  if (!data?.version || !Array.isArray(data.files)) throw new Error('Некорректный манифест обновления');
  return data;
}

function parseAndroidStatus(raw) {
  try {
    return JSON.parse(raw);
  } catch (_) {
    return { state: 'error', progress: 0, error: 'Нет ответа от установщика' };
  }
}

export const updateService = {
  getAppVersion() {
    return APP_VERSION;
  },

  /**
   * Проверка обновлений. Возвращает { hasUpdate, mode, latestVersion, currentVersion, releaseNotes, asset, ... }
   * mode: 'electron' | 'android' | 'manual'
   */
  async checkForUpdates({ force = false } = {}) {
    const electron = getElectronUpdates();
    if (electron) {
      try {
        const st = await electron.check();
        if (st?.status !== 'unsupported') {
          if (st?.status === 'error') {
            return { hasUpdate: false, currentVersion: APP_VERSION, error: st.error };
          }
          const hasUpdate = st?.status === 'available' || st?.status === 'ready' || st?.status === 'downloading' || st?.status === 'verifying';
          if (hasUpdate && !force && isDismissed(st.version)) {
            return { hasUpdate: false, latestVersion: st.version, currentVersion: APP_VERSION };
          }
          return {
            hasUpdate,
            mode: 'electron',
            latestVersion: st?.version,
            currentVersion: APP_VERSION,
            releaseNotes: st?.notes || '',
            releaseUrl: `https://github.com/${GITHUB_REPO}/releases/latest`,
            platform: getAppPlatform()
          };
        }
        // unsupported (macOS, dev-сборка, нет ключа) — ниже обычная проверка с ручным скачиванием
      } catch (err) {
        console.warn('[Update] Electron updater check failed:', err?.message);
      }
    }

    const android = getAndroidUpdater();
    if (android) {
      try {
        const manifest = await fetchManifest();
        const currentVersion = android.getCurrentVersion?.() || APP_VERSION;
        const apk = manifest.files.find((f) => /\.apk$/i.test(f.name));
        const hasUpdate = Boolean(apk) && compareSemver(manifest.version, currentVersion) > 0;
        if (hasUpdate && !force && isDismissed(manifest.version)) {
          return { hasUpdate: false, latestVersion: manifest.version, currentVersion };
        }
        return {
          hasUpdate,
          mode: 'android',
          latestVersion: manifest.version,
          currentVersion,
          releaseName: `DarkMSAL ${manifest.tag}`,
          releaseNotes: manifest.notes || '',
          releaseUrl: `https://github.com/${GITHUB_REPO}/releases/tag/${manifest.tag}`,
          publishedAt: manifest.publishedAt,
          asset: apk ? {
            name: apk.name,
            size: apk.size,
            sha256: apk.sha256,
            browser_download_url: `${RELEASE_DOWNLOAD_BASE}/${manifest.tag}/${encodeURIComponent(apk.name)}`
          } : null,
          platform: 'android'
        };
      } catch (err) {
        // Старые релизы без latest.json — падаем на GitHub API
        console.warn('[Update] Manifest check failed, falling back to GitHub API:', err?.message);
      }
    }

    const res = await this._checkViaGitHubApi({ force });
    return res ? { mode: 'manual', ...res } : res;
  },

  /**
   * Установка. onProgress({ status, progress, error }) — для прогресс-бара в модалке.
   * Возвращает промис; для electron/android резолвится, когда запущена установка.
   */
  async installUpdate(updateInfo, onProgress = () => {}) {
    if (!updateInfo) return;

    if (updateInfo.mode === 'electron' && getElectronUpdates()) {
      const electron = getElectronUpdates();
      const unsubscribe = electron.onState((st) => onProgress(st));
      try {
        let st = await electron.getState();
        if (st.status !== 'ready') {
          st = await electron.download();
        }
        onProgress(st);
        if (st.status !== 'ready') {
          throw new Error(st.error || 'Не удалось скачать обновление');
        }
        onProgress({ status: 'installing', progress: 100 });
        const ok = await electron.install();
        if (!ok) throw new Error('Установка отменена: обновление не прошло проверку');
      } finally {
        unsubscribe();
      }
      return;
    }

    if (updateInfo.mode === 'android' && getAndroidUpdater() && updateInfo.asset?.sha256) {
      const android = getAndroidUpdater();
      let st = parseAndroidStatus(android.getStatus());

      if (st.state !== 'ready' && st.state !== 'need_permission') {
        if (!android.start(updateInfo.asset.browser_download_url, updateInfo.asset.sha256)) {
          st = parseAndroidStatus(android.getStatus());
          throw new Error(st.error || 'Не удалось начать загрузку');
        }
        // Поллинг прогресса нативной загрузки
        st = await new Promise((resolve) => {
          const timer = setInterval(() => {
            const cur = parseAndroidStatus(android.getStatus());
            onProgress({ status: cur.state === 'downloading' ? 'downloading' : cur.state, progress: cur.progress, error: cur.error });
            if (cur.state !== 'downloading') {
              clearInterval(timer);
              resolve(cur);
            }
          }, 400);
        });
      }

      if (st.state === 'error') {
        throw new Error(st.error || 'Ошибка загрузки обновления');
      }

      const started = android.install();
      st = parseAndroidStatus(android.getStatus());
      if (!started && st.state === 'need_permission') {
        onProgress({ status: 'need_permission', progress: 100 });
        return;
      }
      if (!started) throw new Error(st.error || 'Не удалось запустить установку');
      onProgress({ status: 'installing', progress: 100 });
      return;
    }

    this._manualInstall(updateInfo);
  },

  async _checkViaGitHubApi({ force = false } = {}) {
    const currentVersion = APP_VERSION;
    const platform = getAppPlatform();

    // Cache check throttling (1 hour) unless force
    if (!force) {
      try {
        const lastCheck = localStorage.getItem(LAST_CHECK_KEY);
        if (lastCheck) {
          const age = Date.now() - parseInt(lastCheck, 10);
          if (age < 3600000) { // less than 1 hour
            const cachedRelease = localStorage.getItem('msal_latest_release_cache');
            if (cachedRelease) {
              const parsed = JSON.parse(cachedRelease);
              const hasUpdate = compareSemver(parsed.tag_name, currentVersion) > 0;
              const dismissed = localStorage.getItem(DISMISSED_VERSION_KEY);
              if (dismissed === parsed.tag_name) {
                return { hasUpdate: false, latestVersion: parsed.tag_name, currentVersion };
              }
              const asset = findPlatformAsset(parsed.assets, platform);
              return {
                hasUpdate,
                latestVersion: parsed.tag_name?.replace(/^v/i, ''),
                releaseName: parsed.name || parsed.tag_name,
                releaseNotes: parsed.body || '',
                releaseUrl: parsed.html_url,
                publishedAt: parsed.published_at,
                currentVersion,
                asset,
                platform
              };
            }
          }
        }
      } catch (_) {}
    }

    try {
      const response = await fetch(API_URL, {
        headers: {
          'Accept': 'application/vnd.github.v3+json'
        }
      });

      if (!response.ok) {
        if (response.status === 404) {
          return { hasUpdate: false, currentVersion, message: 'Релизы пока не опубликованы' };
        }
        if (response.status === 403) {
          console.warn('[Update] GitHub API rate limit reached');
          return { hasUpdate: false, currentVersion, message: 'Лимит обращений к GitHub API' };
        }
        throw new Error(`GitHub API HTTP ${response.status}`);
      }

      const release = await response.json();
      localStorage.setItem(LAST_CHECK_KEY, String(Date.now()));
      localStorage.setItem('msal_latest_release_cache', JSON.stringify(release));

      const latestTag = release.tag_name || '';
      const latestClean = latestTag.replace(/^v/i, '');
      const hasUpdate = compareSemver(latestClean, currentVersion) > 0;

      // If user dismissed this update version and this is not a manual force check
      if (!force) {
        const dismissed = localStorage.getItem(DISMISSED_VERSION_KEY);
        if (dismissed === latestClean) {
          return { hasUpdate: false, latestVersion: latestClean, currentVersion };
        }
      }

      const asset = findPlatformAsset(release.assets, platform);

      return {
        hasUpdate,
        latestVersion: latestClean,
        releaseName: release.name || release.tag_name,
        releaseNotes: release.body || '',
        releaseUrl: release.html_url,
        publishedAt: release.published_at,
        currentVersion,
        asset,
        platform
      };
    } catch (err) {
      console.warn('[Update] Check failed:', err.message);
      return {
        hasUpdate: false,
        currentVersion,
        error: err.message
      };
    }
  },

  /**
   * Remember that user dismissed an update prompt for a given version
   */
  dismissUpdate(version) {
    if (version) {
      localStorage.setItem(DISMISSED_VERSION_KEY, String(version).replace(/^v/i, ''));
    }
  },

  /**
   * Clear dismissed version
   */
  clearDismissed() {
    localStorage.removeItem(DISMISSED_VERSION_KEY);
  },

  /**
   * Ручное скачивание: открыть файл релиза в браузере
   */
  _manualInstall(updateInfo) {
    if (!updateInfo) return;

    const { asset, releaseUrl, platform } = updateInfo;
    const downloadUrl = asset?.browser_download_url || releaseUrl;

    if (platform === 'userscript') {
      if (downloadUrl) {
        window.location.href = downloadUrl;
        return;
      }
    }

    if (platform === 'ios') {
      // On iOS:
      // 1. If AltStore is installed, support altstore://install?url=...
      // 2. Direct download of IPA in browser for TrollStore/Scarlet/SideStore
      if (asset?.browser_download_url) {
        window.open(asset.browser_download_url, '_system');
        return;
      }
    }

    if (downloadUrl) {
      window.open(downloadUrl, '_system');
    }
  }
};
