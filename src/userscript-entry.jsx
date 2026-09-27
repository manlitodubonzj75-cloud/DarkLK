import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import { cryptoStorage } from './api/cryptoStorage.js';

// Mark environment as Userscript
if (typeof window !== 'undefined') {
  window.__DARKMSAL_USERSCRIPT__ = true;
}

function initDarkMSAL() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('darkmsal-root')) return;

  // Ensure document.body exists
  if (!document.body) {
    setTimeout(initDarkMSAL, 50);
    return;
  }

  const isEnabled = localStorage.getItem('darkmsal_active') !== 'false';

  // Toggle background legacy university site visibility and scrolling to prevent CPU/touch conflicts
  const updateLegacySite = (darkActive) => {
    const origRoot = document.getElementById('root');
    if (origRoot) {
      origRoot.style.display = darkActive ? 'none' : '';
    }
    if (darkActive) {
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
      document.documentElement.style.height = '100%';
      document.body.style.height = '100%';
    } else {
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
      document.documentElement.style.height = '';
      document.body.style.height = '';
    }
  };

  updateLegacySite(isEnabled);

  // Inject iOS Safari touch optimization CSS
  const iosFixStyle = document.createElement('style');
  iosFixStyle.id = 'darkmsal-ios-touch-fix';
  iosFixStyle.textContent = `
    #darkmsal-root {
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      right: 0 !important;
      bottom: 0 !important;
      width: 100% !important;
      height: 100% !important;
      height: 100dvh !important;
      overflow: hidden !important;
      margin: 0 !important;
      padding: 0 !important;
      -webkit-font-smoothing: antialiased;
    }
    #darkmsal-root * {
      -webkit-tap-highlight-color: transparent;
    }
    #darkmsal-root button,
    #darkmsal-root [role="button"],
    #darkmsal-root a,
    #darkmsal-root .cursor-pointer,
    #darkmsal-floating-toggle {
      touch-action: manipulation !important;
      cursor: pointer;
    }
  `;
  document.head.appendChild(iosFixStyle);

  // Main container overlay (does NOT have overflow-y: auto - scrolling happens inside AppShell PullToRefresh)
  const rootContainer = document.createElement('div');
  rootContainer.id = 'darkmsal-root';
  rootContainer.style.position = 'fixed';
  rootContainer.style.top = '0';
  rootContainer.style.left = '0';
  rootContainer.style.right = '0';
  rootContainer.style.bottom = '0';
  rootContainer.style.width = '100%';
  rootContainer.style.height = '100%';
  rootContainer.style.zIndex = '2147483640';
  rootContainer.style.overflow = 'hidden';
  rootContainer.style.display = isEnabled ? 'block' : 'none';
  rootContainer.style.backgroundColor = '#0b0f19';

  // Floating button to return to DarkMSAL from legacy university LK
  const floatingBtn = document.createElement('button');
  floatingBtn.id = 'darkmsal-floating-toggle';
  floatingBtn.innerHTML = '⚡ DarkMSAL';
  floatingBtn.title = 'Открыть DarkMSAL';
  floatingBtn.style.position = 'fixed';
  floatingBtn.style.bottom = '20px';
  floatingBtn.style.right = '20px';
  floatingBtn.style.zIndex = '2147483647';
  floatingBtn.style.padding = '10px 16px';
  floatingBtn.style.backgroundColor = '#10b981';
  floatingBtn.style.color = '#ffffff';
  floatingBtn.style.borderRadius = '9999px';
  floatingBtn.style.fontWeight = 'bold';
  floatingBtn.style.fontSize = '13px';
  floatingBtn.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.4)';
  floatingBtn.style.cursor = 'pointer';
  floatingBtn.style.border = '2px solid rgba(255, 255, 255, 0.2)';
  floatingBtn.style.display = isEnabled ? 'none' : 'flex';
  floatingBtn.style.alignItems = 'center';
  floatingBtn.style.gap = '6px';
  floatingBtn.style.transition = 'all 0.2s ease-in-out';
  floatingBtn.style.touchAction = 'manipulation';
  floatingBtn.style.webkitTapHighlightColor = 'transparent';

  const handleToggle = (e) => {
    if (e) {
      if (e.type === 'touchend') e.preventDefault();
      e.stopPropagation();
    }
    rootContainer.style.display = 'block';
    floatingBtn.style.display = 'none';
    updateLegacySite(true);
    localStorage.setItem('darkmsal_active', 'true');
  };

  floatingBtn.addEventListener('click', handleToggle);
  floatingBtn.addEventListener('touchend', handleToggle, { passive: false });

  window.addEventListener('darkmsal-minimize', () => {
    rootContainer.style.display = 'none';
    floatingBtn.style.display = 'flex';
    updateLegacySite(false);
    localStorage.setItem('darkmsal_active', 'false');
  });

  document.body.appendChild(rootContainer);
  document.body.appendChild(floatingBtn);

  // Ключ шифрования хранится в GM-хранилище менеджера скриптов (страница его не видит).
  cryptoStorage.init().finally(() => {
    ReactDOM.createRoot(rootContainer).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  });
}

// Ensure execution when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initDarkMSAL);
} else {
  initDarkMSAL();
}

// Fallback in case document.body was replaced
window.addEventListener('load', () => {
  if (!document.getElementById('darkmsal-root')) {
    initDarkMSAL();
  }
});
