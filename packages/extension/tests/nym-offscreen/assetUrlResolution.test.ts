/**
 * Regression: official mix-fetch resolves worker/WASM via import.meta.url siblings.
 * Packaged files under nym-mixfetch/ must stay co-located after Vite public→dist copy.
 * Does not execute createMixFetch or contact the network.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  NYM_MIXFETCH_DIR,
  NYM_MIXFETCH_REQUIRED_FILES,
} from '../../src/nym-offscreen/assetManifest.js';

const PUBLIC_ROOT = resolve(__dirname, '../../public', NYM_MIXFETCH_DIR);
const DIST_ROOT = resolve(__dirname, '../../dist', NYM_MIXFETCH_DIR);

function pickRoot(): string {
  if (existsSync(join(DIST_ROOT, 'index.js'))) return DIST_ROOT;
  if (existsSync(join(PUBLIC_ROOT, 'index.js'))) return PUBLIC_ROOT;
  throw new Error(
    `Missing ${NYM_MIXFETCH_DIR} under public/ or dist/ — run pnpm copy:nym`,
  );
}

describe('nym-mixfetch import.meta.url asset resolution', () => {
  it('keeps index.js / worker / wasm as siblings', () => {
    const root = pickRoot();
    for (const file of NYM_MIXFETCH_REQUIRED_FILES) {
      const full = join(root, file);
      expect(existsSync(full), full).toBe(true);
      expect(statSync(full).size).toBeGreaterThan(0);
    }
  });

  it('index.js constructs worker from import.meta.url sibling', () => {
    const root = pickRoot();
    const indexJs = readFileSync(join(root, 'index.js'), 'utf8');
    expect(indexJs).toMatch(
      /new URL\(\s*['"]web-worker-0\.js['"]\s*,\s*import\.meta\.url\s*\)/,
    );
    expect(indexJs).toContain('createMixFetch');
  });

  it('web-worker-0.js loads both WASM via import.meta.url siblings', () => {
    const root = pickRoot();
    const workerJs = readFileSync(join(root, 'web-worker-0.js'), 'utf8');
    expect(workerJs).toMatch(
      /new URL\(\s*['"]mix_fetch_wasm_bg\.wasm['"]\s*,\s*import\.meta\.url\s*\)/,
    );
    expect(workerJs).toMatch(
      /new URL\(\s*['"]go_conn\.wasm['"]\s*,\s*import\.meta\.url\s*\)/,
    );
  });

  it('chrome-extension URL simulation resolves under /nym-mixfetch/', () => {
    const base =
      'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/nym-mixfetch/index.js';
    const worker = new URL('web-worker-0.js', base);
    expect(worker.pathname).toBe('/nym-mixfetch/web-worker-0.js');
    const wasmBg = new URL('mix_fetch_wasm_bg.wasm', worker.href);
    const goConn = new URL('go_conn.wasm', worker.href);
    expect(wasmBg.pathname).toBe('/nym-mixfetch/mix_fetch_wasm_bg.wasm');
    expect(goConn.pathname).toBe('/nym-mixfetch/go_conn.wasm');
  });

  it('offscreen entry loads packaged module by path (not Vite-bundled into entry)', () => {
    const offscreenSrc = readFileSync(
      resolve(__dirname, '../../src/nym-offscreen/runtime.ts'),
      'utf8',
    );
    expect(offscreenSrc).toContain('`${NYM_MIXFETCH_DIR}/${file}`');
    expect(offscreenSrc).toContain('resolveAssetUrl');
    expect(offscreenSrc).toMatch(/import\(\s*\/\*\s*@vite-ignore\s*\*\/\s*url\s*\)/);
  });
});
