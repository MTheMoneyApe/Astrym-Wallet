import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: resolve(__dirname, 'src/background/index.ts'),
      output: {
        entryFileNames: 'background.js',
        chunkFileNames: 'worker-[name].js',
        assetFileNames: 'worker-[name].[ext]',
      },
    },
  },
});