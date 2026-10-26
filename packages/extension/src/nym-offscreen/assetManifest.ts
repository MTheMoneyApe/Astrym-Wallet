/**
 * Packaged @nymproject/mix-fetch@1.4.2 layout.
 *
 * Worker/WASM resolve via `new URL(..., import.meta.url)` inside the official
 * `index.js` / `web-worker-0.js`, so all files MUST stay siblings under
 * `nym-mixfetch/` after Vite copies `public/` → `dist/`.
 */

export const NYM_MIXFETCH_PACKAGE = '@nymproject/mix-fetch' as const;
export const NYM_MIXFETCH_VERSION = '1.4.2' as const;
export const NYM_MIXFETCH_DIR = 'nym-mixfetch' as const;

/** Files the official client loads relative to index.js / the worker. */
export const NYM_MIXFETCH_REQUIRED_FILES = [
  'index.js',
  'web-worker-0.js',
  'go_conn.wasm',
  'mix_fetch_wasm_bg.wasm',
  'package.json',
] as const;

export type NymMixFetchRequiredFile = (typeof NYM_MIXFETCH_REQUIRED_FILES)[number];

export const NYM_MIXFETCH_META_NAME = 'NYM_MIXFETCH_ASSET_META.json' as const;
