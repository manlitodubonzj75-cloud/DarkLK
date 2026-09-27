import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'

// Единственный источник версии — package.json
const APP_VERSION = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  base: './',
  server: {
    host: 'localhost',
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
        cookieDomainRewrite: '',
        rewrite: (path) => path.replace(/^\/owa-proxy/, ''),
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes, req, res) => {
            const sc = proxyRes.headers['set-cookie'];
            if (sc) {
              res.setHeader('X-Set-Cookie-Exposed', JSON.stringify(sc));
            }
            if (proxyRes.headers['location']) {
              const loc = proxyRes.headers['location'];
              const rewrittenLoc = loc.replace(/^https?:\/\/mail\.msal\.ru/, '/owa-proxy');
              proxyRes.headers['location'] = rewrittenLoc;
              res.setHeader('location', rewrittenLoc);
              res.setHeader('X-Location-Exposed', rewrittenLoc);
            }
          });
        }
      }
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: false
  }
})
