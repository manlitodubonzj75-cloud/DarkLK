/**
 * MailClient: Direct HTTP/JSON-RPC transport to Microsoft Exchange 2013/2016 OWA
 * Bypasses CORS and cookie issues using Electron IPC, CapacitorHttp, or Userscript
 */
import { CapacitorHttp } from '@capacitor/core';
import { cryptoStorage } from './cryptoStorage';

const isElectron = typeof window !== "undefined" && Boolean(window.electronAPI?.isElectron);
const isCapacitor = typeof window !== "undefined" && Boolean(window.Capacitor?.isNativePlatform?.());
const isUserscript = typeof GM_xmlhttpRequest !== "undefined" || (typeof GM !== "undefined" && Boolean(GM?.xmlHttpRequest));

const getBaseUrl = () => {
  if (isElectron || isCapacitor || isUserscript) {
    return 'https://mail.msal.ru';
  }
  // Local web dev proxy in vite.config.js
  return '/owa-proxy';
};


function gmRequest(options) {
  return new Promise((resolve, reject) => {
    const fn = (typeof GM_xmlhttpRequest !== "undefined")
      ? GM_xmlhttpRequest
      : (typeof GM !== "undefined" && GM?.xmlHttpRequest)
        ? GM.xmlHttpRequest.bind(GM)
        : null;

    if (!fn) {
      return reject(new Error("Userscript GM_xmlhttpRequest is not available"));
    }

    fn({
      timeout: options.timeout || 30000,
      ...options,
      onload: (res) => resolve(res),
      onerror: (err) => reject(new Error(err?.error || err?.statusText || "GM_xmlhttpRequest failed")),
      ontimeout: () => reject(new Error("GM_xmlhttpRequest timeout"))
    });
  });
}

function parseHeadersString(headerStr) {
  const headers = {};
  if (!headerStr || typeof headerStr !== "string") return headers;
  const lines = headerStr.trim().split(/\r?\n/);
  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx > 0) {
      const key = line.slice(0, idx).trim().toLowerCase();
      const val = line.slice(idx + 1).trim();
      headers[key] = val;
    }
  }
  return headers;
}

function base64ToBlob(base64, mimeType = 'application/octet-stream') {
  try {
    const cleanBase64 = base64.replace(/\s/g, '');
    const byteCharacters = atob(cleanBase64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], { type: mimeType });
  } catch (e) {
    console.warn('[MailClient] base64ToBlob conversion failed:', e);
    return null;
  }
}

class MailClient {
  constructor() {
    this.sessionCookies = {};
    this.canary = null;
    this.isAuthenticating = false;
    this.loadCachedSession();
  }

  isAuthenticated() {
    const creds = cryptoStorage.getMailCredentials();
    const hasCreds = Boolean((creds?.username || creds?.login) && creds?.password);
    const hasSession = Boolean(this.canary || this.sessionCookies['UserContext'] || this.sessionCookies['usercontext']);
    return hasCreds || hasSession;
  }

  getBaseUrl() {
    return getBaseUrl();
  }

  /**
   * Helper to trigger browser/webview file download via Blob URL
   */
  _triggerBlobDownload(blob, fileName) {
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = fileName;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      try {
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
      } catch (_) {}
    }, 4000);
  }

  /**
   * Download attachment file across Electron, Android Capacitor, iOS, Userscripts, and Web
   */
  async downloadAttachmentFile(attachmentId, fileName = "attachment", contentType = "application/octet-stream") {
    if (!this.canary) {
      await this.reauthenticate();
    }
    const fullUrl = this.getAttachmentUrl(attachmentId);
    const cookieHeader = this.getCookieHeader();
    const reqHeaders = {};
    if (cookieHeader) reqHeaders["Cookie"] = cookieHeader;
    if (this.canary) reqHeaders["X-OWA-CANARY"] = this.canary;

    // 1. Electron IPC mode
    if (isElectron && typeof window.electronAPI?.mailDownload === "function") {
      const resp = await window.electronAPI.mailDownload({
        url: fullUrl,
        fileName,
        headers: reqHeaders
      });
      if (!resp.success) {
        throw new Error(resp.error || "Ошибка скачивания файла в Electron");
      }
      return { success: true, fileName: resp.fileName, filePath: resp.filePath };
    }

    // 2. Android Capacitor with Native AndroidDownloader
    if (isCapacitor && window.Capacitor?.getPlatform?.() === "android") {
      try {
        const res = await CapacitorHttp.request({
          method: "GET",
          url: fullUrl,
          headers: reqHeaders,
          responseType: "blob"
        });
        const base64Data = res.data;
        if (!base64Data) {
          throw new Error("Пустой ответ от сервера при скачивании вложения");
        }
        if (typeof window.AndroidDownloader?.saveFile === "function") {
          window.AndroidDownloader.saveFile(fileName, contentType, base64Data);
          return { success: true, fileName };
        }
        const blob = base64ToBlob(base64Data, contentType);
        if (blob) {
          this._triggerBlobDownload(blob, fileName);
          return { success: true, fileName };
        }
      } catch (capErr) {
        console.warn('[MailClient] Android native download failed, trying EWS fallback:', capErr.message);
      }
    }

    // 2.5 Userscript mode: direct GET with Blob response via GM_xmlhttpRequest
    if (isUserscript) {
      try {
        const gmRes = await gmRequest({
          method: "GET",
          url: fullUrl,
          headers: reqHeaders,
          responseType: "blob"
        });
        if (gmRes.status >= 200 && gmRes.status < 400 && gmRes.response) {
          this._triggerBlobDownload(gmRes.response, fileName);
          return { success: true, fileName };
        }
      } catch (gmErr) {
        console.warn("[MailClient] Userscript direct download failed, trying EWS fallback:", gmErr.message);
      }
    }

    // 3. Browser & Capacitor iOS: direct GET with Blob URL
    try {
      const res = await fetch(fullUrl, {
        method: "GET",
        headers: reqHeaders,
        credentials: "include"
      });

      if (res.ok) {
        const blob = await res.blob();
        this._triggerBlobDownload(blob, fileName);
        return { success: true, fileName };
      }
    } catch (fetchErr) {
      console.warn('[MailClient] Direct attachment fetch failed, falling back to GetAttachment RPC:', fetchErr.message);
    }

    // 4. Universal Fallback: EWS JSON-RPC GetAttachment with base64 MIME
    try {
      const payload = {
        __type: 'GetAttachmentJsonRequest:#Exchange',
        Header: {
          __type: 'JsonRequestHeaders:#Exchange',
          RequestServerVersion: 'Exchange2013'
        },
        Body: {
          __type: 'GetAttachmentRequest:#Exchange',
          AttachmentShape: {
            __type: 'AttachmentResponseShape:#Exchange',
            IncludeMimeContent: true
          },
          AttachmentIds: [
            {
              __type: 'RequestAttachmentId:#Exchange',
              Id: attachmentId
            }
          ]
        }
      };

      const rpcRes = await this.serviceCall('GetAttachment', payload);
      const attItem = rpcRes?.Body?.ResponseMessages?.Items?.[0]?.Attachments?.[0];
      const base64Content = attItem?.Content;
      if (base64Content) {
        const mime = contentType || attItem.ContentType || 'application/octet-stream';
        if (isCapacitor && window.Capacitor?.getPlatform?.() === "android" && typeof window.AndroidDownloader?.saveFile === "function") {
          window.AndroidDownloader.saveFile(fileName, mime, base64Content);
          return { success: true, fileName };
        }
        const blob = base64ToBlob(base64Content, mime);
        if (blob) {
          this._triggerBlobDownload(blob, fileName);
          return { success: true, fileName };
        }
      }
    } catch (rpcErr) {
      console.warn('[MailClient] GetAttachment JSON-RPC fallback also failed:', rpcErr);
    }

    throw new Error(`Не удалось скачать вложение "${fileName}"`);
  }

  /**
   * Alias method for downloading attachments
   */
  async downloadAttachment(attachmentId, fileName = "attachment", contentType = "application/octet-stream") {
    return await this.downloadAttachmentFile(attachmentId, fileName, contentType);
  }

  getAttachmentUrl(attachmentId) {
    const base = getBaseUrl();
    const canaryParam = this.canary ? `&X-OWA-CANARY=${encodeURIComponent(this.canary)}` : "";
    return `${base}/owa/service.svc/s/GetFileAttachment?id=${encodeURIComponent(attachmentId)}&isDownload=1${canaryParam}`;
  }

  saveSession() {
    try {
      localStorage.setItem("msal_mail_cookies", JSON.stringify(this.sessionCookies));
      if (this.canary) {
        localStorage.setItem("msal_mail_canary", this.canary);
      }
    } catch (_) {}
  }

  loadCachedSession() {
    try {
      const saved = localStorage.getItem("msal_mail_cookies");
      if (saved) {
        this.sessionCookies = JSON.parse(saved);
      }
      const savedCanary = localStorage.getItem("msal_mail_canary");
      if (savedCanary) {
        this.canary = savedCanary;
      }
    } catch (_) {}
  }

  clearSession() {
    this.sessionCookies = {};
    this.canary = null;
    try {
      localStorage.removeItem("msal_mail_cookies");
      localStorage.removeItem("msal_mail_canary");
    } catch (_) {}
  }

  parseAndStoreCookies(cookieArrayOrStr) {
    if (!cookieArrayOrStr) return;
    const cookies = Array.isArray(cookieArrayOrStr)
      ? cookieArrayOrStr
      : cookieArrayOrStr.split(/,(?=\s*[a-zA-Z0-9_\-]+=)/);

    for (const c of cookies) {
      const parts = c.split(';')[0].trim().split('=');
      if (parts.length >= 2) {
        const name = parts[0].trim();
        const value = parts.slice(1).join('=').trim();
        if (value && value !== 'deleted') {
          this.sessionCookies[name] = value;
          if (name.toUpperCase() === 'X-OWA-CANARY') {
            this.canary = value;
          }
        }
      }
    }
    this.saveSession();
  }

  _extractCanaryFromHtml(html) {
    if (!html || typeof html !== 'string') return;
    const match = html.match(/var\s+g_canary\s*=\s*["']([^"']+)["']/i) ||
                  html.match(/"UserCanary"\s*:\s*["']([^"']+)["']/i) ||
                  html.match(/"canary"\s*:\s*["']([^"']+)["']/i) ||
                  html.match(/name="X-OWA-CANARY"\s+value="([^"]+)"/i) ||
                  html.match(/&canary=([^&"'>\s]+)/i);
    if (match && match[1]) {
      this.canary = match[1];
      this.sessionCookies['X-OWA-CANARY'] = this.canary;
      this.saveSession();
    }
  }

  getCookieHeader() {
    return Object.entries(this.sessionCookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  async rawRequest(path, { method = 'GET', headers = {}, body = null, redirect = 'manual' } = {}) {
    const fullUrl = `${getBaseUrl()}${path}`;
    const cookieHeader = this.getCookieHeader();

    const reqHeaders = { ...headers };
    if (cookieHeader) {
      reqHeaders['Cookie'] = cookieHeader;
    }

    // 1. Electron IPC mode
    if (isElectron && typeof window.electronAPI?.mailRequest === 'function') {
      const res = await window.electronAPI.mailRequest({
        url: fullUrl,
        method,
        headers: reqHeaders,
        body,
        redirect
      });

      const cookiesToParse = res.setCookie || res.headers?.['set-cookie'] || res.headers?.['Set-Cookie'];
      if (cookiesToParse) {
        this.parseAndStoreCookies(cookiesToParse);
      }
      return {
        status: res.status,
        statusText: res.statusText,
        ok: res.ok,
        headers: res.headers || {},
        data: res.data || res.text || ''
      };
    }

    // 2. Capacitor HTTP mode
    if (isCapacitor) {
      const res = await CapacitorHttp.request({
        method,
        url: fullUrl,
        headers: reqHeaders,
        data: body,
        readTimeout: 30000,
        connectTimeout: 30000
      });

      const cookiesToParse = res.headers?.['set-cookie'] || res.headers?.['Set-Cookie'];
      if (cookiesToParse) {
        this.parseAndStoreCookies(cookiesToParse);
      }

      return {
        status: res.status,
        statusText: `${res.status}`,
        ok: res.status >= 200 && res.status < 400,
        headers: res.headers || {},
        data: res.data
      };
    }

    // 2.5 Userscript mode: GM_xmlhttpRequest
    if (isUserscript) {
      const gmRes = await gmRequest({
        method,
        url: fullUrl,
        headers: reqHeaders,
        data: body
      });

      const headersObj = parseHeadersString(gmRes.responseHeaders);
      const cookiesToParse = headersObj["set-cookie"];
      if (cookiesToParse) {
        this.parseAndStoreCookies(cookiesToParse);
      }
      if (headersObj["x-owa-canary"]) {
        this.canary = headersObj["x-owa-canary"];
        this.sessionCookies["X-OWA-CANARY"] = this.canary;
        this.saveSession();
      }

      let data = gmRes.responseText || "";
      const contentType = headersObj["content-type"] || "";
      if (contentType.includes("application/json")) {
        try {
          data = JSON.parse(gmRes.responseText);
        } catch (_) {}
      }

      return {
        status: gmRes.status,
        statusText: gmRes.statusText,
        ok: gmRes.status >= 200 && gmRes.status < 400,
        headers: headersObj,
        data
      };
    }

    // 3. Standard Browser Fetch (using Vite proxy in dev)
    const fetchHeaders = new Headers(reqHeaders);
    const res = await fetch(fullUrl, {
      method,
      headers: fetchHeaders,
      body,
      redirect: 'follow',
      credentials: 'include'
    });

    const exposedCookies = res.headers.get('X-Set-Cookie-Exposed');
    if (exposedCookies) {
      try {
        const parsed = JSON.parse(exposedCookies);
        this.parseAndStoreCookies(parsed);
      } catch (_) {}
    }

    if (typeof document !== 'undefined' && document.cookie) {
      this.parseAndStoreCookies(document.cookie);
    }

    let data;
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      data = await res.json().catch(() => null);
    } else {
      data = await res.text().catch(() => '');
    }

    const headersObj = {};
    for (const [k, v] of res.headers.entries()) {
      headersObj[k.toLowerCase()] = v;
    }

    return {
      status: res.status,
      statusText: res.statusText,
      ok: res.ok,
      headers: headersObj,
      data
    };
  }

  async _attemptLoginWithUser(candidateUser, password) {
    const bodyParams = new URLSearchParams();
    bodyParams.append('destination', 'https://mail.msal.ru/owa');
    bodyParams.append('flags', '4');
    bodyParams.append('forcedownlevel', '0');
    bodyParams.append('username', candidateUser);
    bodyParams.append('password', password);
    bodyParams.append('isUtf8', '1');

    const res = await this.rawRequest('/owa/auth.owa', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
      },
      body: bodyParams.toString(),
      redirect: 'manual'
    });

    const loc = res.headers?.['location'] || res.headers?.['Location'] || res.headers?.['x-location-exposed'];
    if (loc) {
      if (loc.includes('reason=2') || loc.includes('reason=logoff')) {
        throw new Error('Неверный логин или пароль от почты МГЮА');
      }
    }

    // If redirected or received HTML containing login page error
    if (typeof res.data === 'string') {
      if (res.data.includes('logonForm') && (res.data.includes('reason=2') || res.data.includes('signInExpl'))) {
        throw new Error('Неверный логин или пароль от почты МГЮА');
      }
      this._extractCanaryFromHtml(res.data);
    }

    // Probe /owa/ to fetch page HTML and extract canary if not found yet
    if (!this.canary) {
      try {
        const probeRes = await this.rawRequest('/owa/', { method: 'GET' });
        if (typeof probeRes.data === 'string') {
          this._extractCanaryFromHtml(probeRes.data);
        }
        if (probeRes.headers?.['x-owa-canary']) {
          this.canary = probeRes.headers['x-owa-canary'];
          this.sessionCookies['X-OWA-CANARY'] = this.canary;
        }
      } catch (probeErr) {
        console.warn('[MailClient] Probe /owa/ warning:', probeErr.message);
      }
    }

    if (this.canary) {
      this.sessionCookies['X-OWA-CANARY'] = this.canary;
    }
    this.saveSession();

    // Verify session with a lightweight GetFolder test call
    try {
      const verifyRes = await this.serviceCall('GetFolder', {
        __type: 'GetFolderJsonRequest:#Exchange',
        Header: {
          __type: 'JsonRequestHeaders:#Exchange',
          RequestServerVersion: 'Exchange2013'
        },
        Body: {
          __type: 'GetFolderRequest:#Exchange',
          FolderShape: { __type: 'FolderResponseShape:#Exchange', BaseShape: 'IdOnly' },
          FolderIds: [{ __type: 'DistinguishedFolderId:#Exchange', Id: 'inbox' }]
        }
      });
      if (verifyRes?.Body?.ResponseMessages?.Items?.[0]?.ResponseClass === 'Success' || verifyRes?.Body) {
        return true;
      }
    } catch (vErr) {
      if (!this.canary && Object.keys(this.sessionCookies).length === 0) {
        throw new Error('Не удалось получить сессию Exchange OWA');
      }
    }

    return true;
  }

  async login(username, password) {
    if (!username || !password) throw new Error('Логин и пароль обязательны');
    this.clearSession();

    const rawUser = username.trim();
    const candidates = [rawUser];
    if (rawUser.includes('@')) {
      candidates.push(rawUser.split('@')[0]);
    } else {
      candidates.push(`${rawUser}@msal.ru`);
    }

    let lastError = null;
    let authenticatedUser = null;

    for (const candidate of candidates) {
      try {
        const ok = await this._attemptLoginWithUser(candidate, password);
        if (ok) {
          authenticatedUser = candidate;
          break;
        }
      } catch (err) {
        lastError = err;
        if (err.message && err.message.includes('Неверный логин')) {
          continue; // try next candidate format
        }
        throw err;
      }
    }

    if (!authenticatedUser) {
      throw lastError || new Error('Не удалось войти в почту МГЮА');
    }

    cryptoStorage.setMailCredentials(authenticatedUser, password);
    return true;
  }

  async reauthenticate() {
    if (this.isAuthenticating) return;
    this.isAuthenticating = true;
    try {
      const creds = cryptoStorage.getMailCredentials() || cryptoStorage.getSavedCredentials();
      const user = creds?.username || creds?.login;
      const pass = creds?.password;
      if (!user || !pass) {
        throw new Error('Учётные данные почты отсутствуют, требуется повторный вход');
      }
      await this.login(user, pass);
    } finally {
      this.isAuthenticating = false;
    }
  }

  async logout() {
    try {
      await this.rawRequest('/owa/logoff.owa', { method: 'GET' });
    } catch (_) {}
    this.clearSession();
    cryptoStorage.clearMailCredentials();
  }

  async serviceCall(action, payload, retryCount = 0) {
    const fullUrl = `${getBaseUrl()}/owa/service.svc?action=${action}`;
    const cookieHeader = this.getCookieHeader();

    const headers = {
      'Content-Type': 'application/json; charset=UTF-8',
      'Action': action
    };

    if (this.canary) {
      headers['X-OWA-CANARY'] = this.canary;
    }
    if (cookieHeader) {
      headers['Cookie'] = cookieHeader;
    }

    let res;

    // 1. Electron IPC mode
    if (isElectron && typeof window.electronAPI?.mailRequest === 'function') {
      res = await window.electronAPI.mailRequest({
        url: fullUrl,
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });
      const cookiesToParse = res.setCookie || res.headers?.['set-cookie'] || res.headers?.['Set-Cookie'];
      if (cookiesToParse) {
        this.parseAndStoreCookies(cookiesToParse);
      }
      if (res.headers && res.headers['x-owa-canary']) {
        this.canary = res.headers['x-owa-canary'];
        this.sessionCookies['X-OWA-CANARY'] = this.canary;
        this.saveSession();
      }
      res.data = res.data || (res.text ? JSON.parse(res.text) : null);
    }
    // 2. Capacitor HTTP mode
    else if (isCapacitor) {
      const capRes = await CapacitorHttp.request({
        method: 'POST',
        url: fullUrl,
        headers,
        data: payload,
        readTimeout: 30000,
        connectTimeout: 30000
      });
      const cookiesToParse = capRes.headers?.['set-cookie'] || capRes.headers?.['Set-Cookie'];
      if (cookiesToParse) {
        this.parseAndStoreCookies(cookiesToParse);
      }
      if (capRes.headers && capRes.headers['x-owa-canary']) {
        this.canary = capRes.headers['x-owa-canary'];
        this.sessionCookies['X-OWA-CANARY'] = this.canary;
        this.saveSession();
      }
      res = {
        status: capRes.status,
        statusText: `${capRes.status}`,
        ok: capRes.status >= 200 && capRes.status < 400,
        headers: capRes.headers || {},
        data: capRes.data
      };
    }
    // 2.5 Userscript mode: use GM_xmlhttpRequest
    else if (isUserscript) {
      const gmRes = await gmRequest({
        method: "POST",
        url: fullUrl,
        headers,
        data: JSON.stringify(payload)
      });
      const headersObj = parseHeadersString(gmRes.responseHeaders);
      const cookiesToParse = headersObj["set-cookie"];
      if (cookiesToParse) {
        this.parseAndStoreCookies(cookiesToParse);
      }
      if (headersObj["x-owa-canary"]) {
        this.canary = headersObj["x-owa-canary"];
        this.sessionCookies["X-OWA-CANARY"] = this.canary;
        this.saveSession();
      }
      let data = null;
      try {
        data = JSON.parse(gmRes.responseText);
      } catch (_) {
        data = gmRes.responseText;
      }
      res = {
        status: gmRes.status,
        statusText: gmRes.statusText,
        ok: gmRes.status >= 200 && gmRes.status < 400,
        headers: headersObj,
        data
      };
    }

    // 3. Web Dev Proxy mode
    else {
      const fetchHeaders = new Headers(headers);
      const webRes = await fetch(fullUrl, {
        method: 'POST',
        headers: fetchHeaders,
        body: JSON.stringify(payload),
        credentials: 'include'
      });

      const exposedCookies = webRes.headers.get('X-Set-Cookie-Exposed');
      if (exposedCookies) {
        try {
          const parsed = JSON.parse(exposedCookies);
          this.parseAndStoreCookies(parsed);
        } catch (_) {}
      }

      const resCanary = webRes.headers.get('x-owa-canary');
      if (resCanary) {
        this.canary = resCanary;
        this.sessionCookies['X-OWA-CANARY'] = this.canary;
        this.saveSession();
      }

      let data = null;
      try {
        data = await webRes.json();
      } catch (_) {
        data = await webRes.text().catch(() => null);
      }

      res = {
        status: webRes.status,
        statusText: webRes.statusText,
        ok: webRes.ok,
        headers: Object.fromEntries(webRes.headers.entries()),
        data
      };
    }

    // Session expiration / re-authentication handler (Exchange returns 440 or 401 or redirects to logon)
    if (res.status === 440 || res.status === 401 || (typeof res.data === 'string' && res.data.includes('logonForm'))) {
      if (retryCount < 1) {
        console.warn(`[MailClient] OWA session expired (status ${res.status}). Triggering silent re-authentication...`);
        await this.reauthenticate();
        return await this.serviceCall(action, payload, retryCount + 1);
      }
      throw new Error('Сессия почты истекла, требуется повторный вход');
    }

    if (!res.ok && res.status >= 400) {
      throw new Error(`Ошибка сервиса Exchange (${res.status}): ${res.statusText || 'Сервер временно недоступен'}`);
    }

    return res.data;
  }
}

export const mailClient = new MailClient();
export default mailClient;
