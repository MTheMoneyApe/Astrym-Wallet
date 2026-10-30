import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

/** Standalone Android / browser build. No MV3 service worker bundle. */
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    host: true,
    port: 5173,
    strictPort: false,
  },
  preview: {
    host: true,
    port: 4173,
  },
  build: {
    outDir: 'dist-webapp',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        webapp: resolve(__dirname, 'webapp.html'),
        'spp-host': resolve(__dirname, 'spp-host.html'),
      },
    },
  },
});
