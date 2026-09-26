import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

// Mark environment as Userscript
if (typeof window !== 'undefined') {
  window.__DARKMSAL_USERSCRIPT__ = true;
}

function initDarkMSAL() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('darkmsal-root')) return;

  const isEnabled = localStorage.getItem('darkmsal_active') !== 'false';

  // Main container overlay
  const rootContainer = document.createElement('div');
  rootContainer.id = 'darkmsal-root';
  rootContainer.style.position = 'fixed';
  rootContainer.style.top = '0';
  rootContainer.style.left = '0';
  rootContainer.style.width = '100vw';
  rootContainer.style.height = '100vh';
  rootContainer.style.zIndex = '2147483640';
  rootContainer.style.overflowY = 'auto';
  rootContainer.style.overflowX = 'hidden';
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

  floatingBtn.onmouseover = () => {
    floatingBtn.style.transform = 'scale(1.05)';
  };
  floatingBtn.onmouseout = () => {
    floatingBtn.style.transform = 'scale(1)';
  };

  floatingBtn.onclick = () => {
    rootContainer.style.display = 'block';
    floatingBtn.style.display = 'none';
    localStorage.setItem('darkmsal_active', 'true');
  };

  window.addEventListener('darkmsal-minimize', () => {
    rootContainer.style.display = 'none';
    floatingBtn.style.display = 'flex';
    localStorage.setItem('darkmsal_active', 'false');
  });

  const parent = document.body || document.documentElement;
  parent.appendChild(rootContainer);
  parent.appendChild(floatingBtn);

  ReactDOM.createRoot(rootContainer).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initDarkMSAL);
} else {
  initDarkMSAL();
}
