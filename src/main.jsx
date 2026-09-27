import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { cryptoStorage } from './api/cryptoStorage.js'

// Хранилище расшифровывается ДО рендера: токены, профиль и кэш читаются синхронно из RAM.
cryptoStorage.init().finally(() => {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
})
