/**
 * DarkMSAL - OWA Probe & Diagnostic Script
 *
 * This script runs purely locally on your machine.
 * It NEVER saves your password to disk, NEVER logs it, and NEVER sends it anywhere
 * except directly to https://mail.msal.ru/owa/auth.owa.
 */

import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sessionFilePath = path.join(__dirname, '.owa-session.json');

function prompt(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise((resolve) => {
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
}

function promptPassword(query) {
  return new Promise((resolve) => {
    process.stdout.write(query);
    const stdin = process.stdin;
    const oldRaw = stdin.isRaw;
    let password = '';

    if (stdin.setRawMode) {
      stdin.setRawMode(true);
    }
    stdin.resume();

    const onData = (chunk) => {
      const char = chunk.toString();
      if (char === '\n' || char === '\r' || char === '\u0004') {
        if (stdin.setRawMode) stdin.setRawMode(oldRaw);
        stdin.pause();
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(password);
      } else if (char === '\u0003') {
        process.stdout.write('\n');
        process.exit(1);
      } else if (char === '\b' || char === '\x7f') {
        if (password.length > 0) {
          password = password.slice(0, -1);
          process.stdout.write('\b \b');
        }
      } else {
        password += char;
        process.stdout.write('*');
      }
    };

    stdin.on('data', onData);
  });
}

class CookieJar {
  constructor(initialCookies = {}) {
    this.cookies = new Map(Object.entries(initialCookies));
  }

  storeCookies(setCookieHeaders) {
    if (!setCookieHeaders) return;
    const list = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
    for (const raw of list) {
      const parts = raw.split(';')[0].trim();
      const eqIdx = parts.indexOf('=');
      if (eqIdx !== -1) {
        const name = parts.slice(0, eqIdx).trim();
        const value = parts.slice(eqIdx + 1).trim();
        this.cookies.set(name, value);
      }
    }
  }

  getCookieHeader() {
    const list = [];
    for (const [k, v] of this.cookies.entries()) {
      list.push(`${k}=${v}`);
    }
    return list.join('; ');
  }

  get(name) {
    return this.cookies.get(name);
  }

  toObject() {
    return Object.fromEntries(this.cookies.entries());
  }
}

function anonymize(obj, depth = 0) {
  if (depth > 10) return '[DepthLimit]';
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'boolean') return obj;
  if (typeof obj === 'number') return 0;
  if (typeof obj === 'string') {
    if (obj.includes('@')) return '[EMAIL_REDACTED]';
    if (obj.length > 50) return `[STRING_LEN_${obj.length}]`;
    return '[REDACTED_STR]';
  }
  if (Array.isArray(obj)) {
    if (obj.length === 0) return [];
    return obj.slice(0, 2).map((item) => anonymize(item, depth + 1));
  }
  if (typeof obj === 'object') {
    const res = {};
    for (const [k, v] of Object.entries(obj)) {
      // Id/ChangeKey НЕ сохраняем: в них зашит GUID конкретного почтового ящика
      if (k === '__type' || k === 'ResponseCode' || k === 'ResponseClass') {
        res[k] = v;
      } else {
        res[k] = anonymize(v, depth + 1);
      }
    }
    return res;
  }
  return typeof obj;
}

async function run() {
  console.log('='.repeat(65));
  console.log('   \x1b[36mDarkMSAL\x1b[0m: OWA Probe Tool (Test FindItem & FindConversation)');
  console.log('='.repeat(65));

  let jar = new CookieJar();
  let canary = '';

  // Check if existing session cookie file is available
  if (fs.existsSync(sessionFilePath)) {
    try {
      const savedSession = JSON.parse(fs.readFileSync(sessionFilePath, 'utf8'));
      if (savedSession.cookies && savedSession.canary) {
        console.log('\x1b[32m✔ Найдена активная сессия из предыдущего запуска, пробуем использовать без повторного ввода пароля...\x1b[0m');
        jar = new CookieJar(savedSession.cookies);
        canary = savedSession.canary;
      }
    } catch (_) {}
  }

  // If no session, perform login
  if (!jar.get('UserContext')) {
    const username = await prompt('Введите логин для почты (например, ivanov.ii): ');
    if (!username) process.exit(1);

    const password = await promptPassword('Введите пароль: ');
    if (!password) process.exit(1);

    console.log('\n\x1b[33m[1/4] Авторизация на https://mail.msal.ru/owa/auth.owa ...\x1b[0m');
    const loginBody = new URLSearchParams({
      destination: 'https://mail.msal.ru/owa/',
      flags: '4',
      forcedownlevel: '0',
      username: username,
      password: password,
      isUtf8: '1'
    }).toString();

    const loginRes = await fetch('https://mail.msal.ru/owa/auth.owa', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
        'Origin': 'https://mail.msal.ru',
        'Referer': 'https://mail.msal.ru/owa/auth/logon.aspx'
      },
      body: loginBody,
      redirect: 'manual'
    });

    jar.storeCookies(loginRes.headers.getSetCookie ? loginRes.headers.getSetCookie() : []);

    const location = loginRes.headers.get('location') || '';
    if (location.includes('reason=')) {
      console.error(`\x1b[31m❌ Ошибка авторизации: ${location}\x1b[0m`);
      process.exit(1);
    }

    console.log('\x1b[32m✔ Успешный вход!\x1b[0m');

    // Get Canary
    const owaHomeRes = await fetch('https://mail.msal.ru/owa/', {
      headers: {
        'Cookie': jar.getCookieHeader(),
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      },
      redirect: 'manual'
    });

    jar.storeCookies(owaHomeRes.headers.getSetCookie ? owaHomeRes.headers.getSetCookie() : []);
    const html = await owaHomeRes.text();
    canary = jar.get('X-OWA-CANARY');
    if (!canary) {
      const match = html.match(/["']?canary["']?\s*[:=]\s*["']([^"']+)["']/i);
      if (match) canary = match[1];
    }

    // Save session cookies locally for quick re-testing
    fs.writeFileSync(sessionFilePath, JSON.stringify({
      cookies: jar.toObject(),
      canary: canary
    }, null, 2), { mode: 0o600 });
  }

  console.log(`\x1b[32m✔ CSRF Canary готов: ${canary?.slice(0, 8)}...\x1b[0m`);

  const baseHeaders = {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Requested-With': 'XMLHttpRequest',
    'Cookie': jar.getCookieHeader(),
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    'X-OWA-CANARY': canary || ''
  };

  // 1. Test FindItem with correct Exchange2013 / Shallow
  console.log('\n\x1b[33m[2/4] Тестируем FindItem (с Traversal: Shallow & Exchange2013)...\x1b[0m');
  const findItemPayload = {
    __type: 'FindItemJsonRequest:#Exchange',
    Header: {
      __type: 'JsonRequestHeaders:#Exchange',
      RequestServerVersion: 'Exchange2013',
      TimeZoneContext: {
        __type: 'TimeZoneContext:#Exchange',
        TimeZoneDefinition: {
          __type: 'TimeZoneDefinitionType:#Exchange',
          Id: 'UTC'
        }
      }
    },
    Body: {
      __type: 'FindItemRequest:#Exchange',
      Traversal: 'Shallow',
      ItemShape: {
        __type: 'ItemResponseShape:#Exchange',
        BaseShape: 'IdOnly',
        AdditionalProperties: [
          { __type: 'PropertyUri:#Exchange', FieldURI: 'ItemSubject' },
          { __type: 'PropertyUri:#Exchange', FieldURI: 'ItemDateTimeReceived' },
          { __type: 'PropertyUri:#Exchange', FieldURI: 'ItemHasAttachments' },
          { __type: 'PropertyUri:#Exchange', FieldURI: 'MessageFrom' },
          { __type: 'PropertyUri:#Exchange', FieldURI: 'MessageIsRead' }
        ]
      },
      ParentFolderIds: [
        {
          __type: 'DistinguishedFolderId:#Exchange',
          Id: 'inbox'
        }
      ],
      IndexedPageItemView: {
        __type: 'IndexedPageView:#Exchange',
        BasePoint: 'Beginning',
        Offset: 0,
        MaxEntriesReturned: 10
      }
    }
  };

  const findItemRes = await fetch('https://mail.msal.ru/owa/service.svc?action=FindItem', {
    method: 'POST',
    headers: { ...baseHeaders, 'Action': 'FindItem' },
    body: JSON.stringify(findItemPayload)
  });

  console.log(`Статус FindItem: ${findItemRes.status} ${findItemRes.statusText}`);
  let findItemJson = null;
  if (findItemRes.ok) {
    findItemJson = await findItemRes.json();
    console.log('\x1b[32m✔ FindItem успешно вернул список писем!\x1b[0m');
  } else {
    const errText = await findItemRes.text();
    console.log(`\x1b[31mОшибка FindItem: ${errText.slice(0, 300)}\x1b[0m`);
  }

  // 2. Test FindConversation (Modern OWA view)
  console.log('\n\x1b[33m[3/4] Тестируем FindConversation (стандартный вид OWA)...\x1b[0m');
  const findConvPayload = {
    __type: 'FindConversationJsonRequest:#Exchange',
    Header: {
      __type: 'JsonRequestHeaders:#Exchange',
      RequestServerVersion: 'Exchange2013',
      TimeZoneContext: {
        __type: 'TimeZoneContext:#Exchange',
        TimeZoneDefinition: {
          __type: 'TimeZoneDefinitionType:#Exchange',
          Id: 'UTC'
        }
      }
    },
    Body: {
      __type: 'FindConversationRequest:#Exchange',
      ParentFolderId: {
        __type: 'TargetFolderId:#Exchange',
        BaseFolderId: {
          __type: 'DistinguishedFolderId:#Exchange',
          Id: 'inbox'
        }
      },
      Paging: {
        __type: 'IndexedPageView:#Exchange',
        BasePoint: 'Beginning',
        Offset: 0,
        MaxEntriesReturned: 10
      },
      ConversationShape: {
        __type: 'ConversationResponseShape:#Exchange',
        BaseShape: 'Default'
      }
    }
  };

  const findConvRes = await fetch('https://mail.msal.ru/owa/service.svc?action=FindConversation', {
    method: 'POST',
    headers: { ...baseHeaders, 'Action': 'FindConversation' },
    body: JSON.stringify(findConvPayload)
  });

  console.log(`Статус FindConversation: ${findConvRes.status} ${findConvRes.statusText}`);
  let findConvJson = null;
  if (findConvRes.ok) {
    findConvJson = await findConvRes.json();
    console.log('\x1b[32m✔ FindConversation успешно вернул список тредов!\x1b[0m');
  } else {
    const errText = await findConvRes.text();
    console.log(`\x1b[31mОшибка FindConversation: ${errText.slice(0, 300)}\x1b[0m`);
  }

  // 3. Save schemas
  console.log('\n\x1b[33m[4/4] Сохранение схем ответов в scripts/owa-schema.json...\x1b[0m');
  const schemaPath = path.join(__dirname, 'owa-schema.json');
  let existingSchema = {};
  try {
    existingSchema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  } catch (_) {}

  existingSchema.findItemSchema = anonymize(findItemJson);
  existingSchema.findConvSchema = anonymize(findConvJson);
  existingSchema.status.findItem = findItemRes.status;
  existingSchema.status.findConversation = findConvRes.status;

  fs.writeFileSync(schemaPath, JSON.stringify(existingSchema, null, 2), 'utf8');
  console.log('\x1b[32m✔ Схемы обновлены и анонимизированы!\x1b[0m\n');
}

run().catch((err) => {
  console.error('\x1b[31mОшибка:\x1b[0m', err.message);
  process.exit(1);
});
