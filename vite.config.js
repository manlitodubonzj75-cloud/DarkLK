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
    sourcemap: true
  }
})
