import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { cryptoStorage } from './api/cryptoStorage.js'

// Pre-initialize cryptoStorage keystore on app launch
cryptoStorage.init().catch((err) => {
  console.warn('[Main] Early cryptoStorage init notice:', err);
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
