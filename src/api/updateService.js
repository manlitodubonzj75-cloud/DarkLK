/**
 * Update Service for DarkMSAL
 * Checks GitHub Releases (Dewerro67/MSALKA) for updates, compares semver versions,
 * identifies matching platform assets (.ipa for iOS, .apk for Android, .user.js for Userscript, etc.),
 * and handles downloading/installing updates on user devices.
 */

export const APP_VERSION = '1.1.0';
const GITHUB_REPO = 'manlitodubonzj75-cloud/DarkLK';
const API_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
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

export const updateService = {
  getAppVersion() {
    return APP_VERSION;
  },

  /**
   * Check GitHub for updates
   * @param {Object} options { force?: boolean }
   * @returns {Promise<Object>} { hasUpdate, latestVersion, currentVersion, releaseNotes, asset, releaseUrl, ... }
   */
  async checkForUpdates({ force = false } = {}) {
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
   * Download / Install the update
   */
  installUpdate(updateInfo) {
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
