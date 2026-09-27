import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: 'https://lk.msal.ru:3443',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api/, '')
      },
      '/owa-proxy': {
        target: 'https://mail.msal.ru',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/owa-proxy/, '')
      }
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: true
  }
})
