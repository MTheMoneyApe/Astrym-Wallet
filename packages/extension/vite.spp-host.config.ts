/**
 * Host-only Vite build for Solanym SPP lab page (Fase 5D.5).
 *
 * Purpose: refresh dist/spp-host.html + dist/spp-host.js (and host-prefixed chunks)
 * without emptyOutDir, without copying public/spp, and without rebuilding popup /
 * background / content / provider.
 *
 * Does NOT flip STORAGE_LAB_EXECUTION_AUTHORIZED (remains false in source).
 * Does NOT run copy-spp-assets or prepare-vendor.
 *
 * Usage (from packages/extension) — only when explicitly authorized:
 *   pnpm run build:spp-host
 */
import { defineConfig } from 'vite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  /**
   * Absolute `/` paths match the existing extension layout
   * (chrome-extension://<id>/spp-host.js). Same pattern as the multi-entry build.
   */
  base: '/',

  /**
   * Critical: do not sync `public/` into `dist/`.
   * Otherwise Vite would rewrite `dist/spp/**` from `public/spp` (~277 MB I/O).
   */
  publicDir: false,

  // spp-host is vanilla TS — no React plugin (avoids pulling popup toolchain).
  plugins: [],

  build: {
    outDir: 'dist',
    /** Preserve existing dist/spp, popup, background, content, provider, icons, manifest. */
    emptyOutDir: false,
    /**
     * Do not emit a shared `modulepreload-polyfill.js` that other extension pages
     * already reference; host HTML will load without that shared polyfill file.
     */
    modulePreload: { polyfill: false },
    cssCodeSplit: true,
    rollupOptions: {
      /** Sole HTML entry — no popup/content/provider. */
      input: resolve(__dirname, 'spp-host.html'),
      output: {
        /** Overwrites only the stale host entry (intentional). */
        entryFileNames: 'spp-host.js',
        /**
         * Any code-split chunks must be host-prefixed so they cannot collide with
         * popup.js / content.js / provider.js / background.js.
         */
        chunkFileNames: 'spp-host-chunk-[name]-[hash].js',
        /** CSS/other assets likewise host-prefixed + hashed. */
        assetFileNames: 'spp-host-asset-[name]-[hash][extname]',
      },
    },
  },
});
