import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log('[Userscript] Building DarkMSAL Userscript bundle...');

// 1. Run Vite build for userscript
execSync('npx vite build --config vite.userscript.config.js', {
  cwd: rootDir,
  stdio: 'inherit'
});

const distDir = path.join(rootDir, 'dist-userscript');
const releaseDir = path.join(rootDir, 'release');
if (!fs.existsSync(releaseDir)) {
  fs.mkdirSync(releaseDir, { recursive: true });
}

// 2. Read compiled CSS and JS
const cssFile = path.join(distDir, 'style.css');
const jsFile = path.join(distDir, 'darkmsal.iife.js');

const cssContent = fs.existsSync(cssFile) ? fs.readFileSync(cssFile, 'utf8') : '';
const jsContent = fs.readFileSync(jsFile, 'utf8');

// 3. Construct Userscript metadata header
const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const version = pkg.version || '1.0.0';

const header = `// ==UserScript==
// @name         DarkMSAL
// @namespace    https://github.com/Dewerro67/MSALKA
// @version      ${version}
// @description  Тёмный современный интерфейс для личного кабинета студента МГЮА (lk.msal.ru)
// @author       DarkMSAL Team
// @match        *://lk.msal.ru/*
// @match        *://*.msal.ru/*
// @include      *://lk.msal.ru*
// @include      *://*.msal.ru*
// @include      https://lk.msal.ru*
// @include      http://lk.msal.ru*
// @run-at       document-end
// @noframes
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @updateURL    https://raw.githubusercontent.com/Dewerro67/MSALKA/main/release/darkmsal.user.js
// @downloadURL  https://raw.githubusercontent.com/Dewerro67/MSALKA/main/release/darkmsal.user.js
// @icon         https://raw.githubusercontent.com/Dewerro67/MSALKA/main/public/logo.png
// ==/UserScript==
`;

// 4. Wrap with CSS injector and execution logic
const userScriptCode = `${header}
(function() {
  'use strict';

  // Inject DarkMSAL compiled Tailwind & component CSS
  const css = ${JSON.stringify(cssContent)};
  if (typeof GM_addStyle !== 'undefined') {
    GM_addStyle(css);
  } else {
    function injectStyle() {
      if (document.getElementById('darkmsal-injected-styles')) return;
      const styleEl = document.createElement('style');
      styleEl.id = 'darkmsal-injected-styles';
      styleEl.textContent = css;
      (document.head || document.documentElement).appendChild(styleEl);
    }
    if (document.head || document.documentElement) {
      injectStyle();
    } else {
      document.addEventListener('DOMContentLoaded', injectStyle);
    }
  }

  // Execute bundled DarkMSAL React application
  ${jsContent}
})();
`;

const outputFile = path.join(releaseDir, 'darkmsal.user.js');
fs.writeFileSync(outputFile, userScriptCode, 'utf8');

// Clean up intermediate build directory
try {
  fs.rmSync(distDir, { recursive: true, force: true });
} catch (_) {}

console.log(`\n✅ Userscript build succeeded!`);
console.log(`📦 Output: release/darkmsal.user.js (${(fs.statSync(outputFile).size / 1024).toFixed(1)} KB)`);
