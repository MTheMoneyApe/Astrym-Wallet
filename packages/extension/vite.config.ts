import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'popup.html'),
        webapp: resolve(__dirname, 'webapp.html'),
        'spp-host': resolve(__dirname, 'spp-host.html'),
        'nym-offscreen': resolve(__dirname, 'nym-offscreen.html'),
        content: resolve(__dirname, 'src/content/index.ts'),
        provider: resolve(__dirname, 'src/provider/index.ts')
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name].[ext]'
      }
    }
  }
});

