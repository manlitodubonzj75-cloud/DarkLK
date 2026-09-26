import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  plugins: [react()],
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    outDir: 'dist-userscript',
    emptyOutDir: true,
    lib: {
      entry: path.resolve(__dirname, 'src/userscript-entry.jsx'),
      name: 'DarkMSAL',
      formats: ['iife'],
      fileName: () => 'darkmsal.iife.js',
    },
    rollupOptions: {
      output: {
        extend: true,
        inlineDynamicImports: true,
      },
    },
  },
});
