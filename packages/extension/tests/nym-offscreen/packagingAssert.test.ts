/**
 * Packaging assertion — required mix-fetch siblings under public/nym-mixfetch.
 * Does not prove a live Mixnet session.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  NYM_MIXFETCH_DIR,
  NYM_MIXFETCH_META_NAME,
  NYM_MIXFETCH_PACKAGE,
  NYM_MIXFETCH_REQUIRED_FILES,
  NYM_MIXFETCH_VERSION,
} from '../../src/nym-offscreen/assetManifest.js';
import { bootstrapHostPermissionPatterns, NYM_DEFAULT_BOOTSTRAP_ORIGINS } from '../../src/nym-offscreen/networkAllowlist.js';
import { NYM_VERIFIED_GATEWAY } from '../../src/nym-offscreen/verifiedGateway.js';
import { DEFAULT_NYM_NETWORK_ALLOWLIST } from '../../src/nym-offscreen/networkAllowlist.js';

const PUBLIC_ROOT = resolve(__dirname, '../../public', NYM_MIXFETCH_DIR);

describe('nym-mixfetch packaging assert', () => {
  it('requires copied assets (run pnpm copy:nym if missing)', () => {
    expect(existsSync(PUBLIC_ROOT), `missing ${PUBLIC_ROOT}`).toBe(true);
    for (const file of NYM_MIXFETCH_REQUIRED_FILES) {
      const full = join(PUBLIC_ROOT, file);
      expect(existsSync(full), `missing ${file}`).toBe(true);
      expect(statSync(full).size).toBeGreaterThan(0);
    }
  });

  it('meta matches expected package version', () => {
    const meta = JSON.parse(readFileSync(join(PUBLIC_ROOT, NYM_MIXFETCH_META_NAME), 'utf8'));
    expect(meta.package).toBe(NYM_MIXFETCH_PACKAGE);
    expect(meta.version).toBe(NYM_MIXFETCH_VERSION);
  });

  it('index.js and worker keep import.meta.url sibling references', () => {
    const indexJs = readFileSync(join(PUBLIC_ROOT, 'index.js'), 'utf8');
    expect(indexJs).toContain('web-worker-0.js');
    expect(indexJs).toContain('createMixFetch');
    const workerJs = readFileSync(join(PUBLIC_ROOT, 'web-worker-0.js'), 'utf8');
    expect(workerJs).toContain('mix_fetch_wasm_bg.wasm');
    expect(workerJs).toContain('go_conn.wasm');
  });

  it('manifest host_permissions cover verified bootstrap only (no all_urls)', () => {
    const manifest = JSON.parse(
      readFileSync(resolve(__dirname, '../../public/manifest.json'), 'utf8'),
    );
    expect(manifest.host_permissions).toEqual(
      bootstrapHostPermissionPatterns({
        bootstrapApiOrigins: NYM_DEFAULT_BOOTSTRAP_ORIGINS,
        gatewayOrigins: [],
      }),
    );
    expect(JSON.stringify(manifest)).not.toContain('<all_urls>');
    expect(manifest.content_security_policy.extension_pages).toContain('wasm-unsafe-eval');
    expect(manifest.content_security_policy.extension_pages).toContain("worker-src 'self'");
    // MV3 extension_pages CSP: no remote script hosts; network gated by host_permissions.
    expect(manifest.content_security_policy.extension_pages).not.toMatch(/https:\/\//);
    expect(manifest.content_security_policy.extension_pages).not.toMatch(
      /(?<!wasm-)unsafe-eval/,
    );
  });

  it('manifest optional_host_permissions lists exact verified gateway pattern only', () => {
    const manifest = JSON.parse(
      readFileSync(resolve(__dirname, '../../public/manifest.json'), 'utf8'),
    );
    expect(manifest.optional_host_permissions).toEqual([
      NYM_VERIFIED_GATEWAY.hostPermissionPattern,
    ]);
    expect(manifest.optional_host_permissions.join(',')).not.toContain('*://');
    expect(manifest.optional_host_permissions.join(',')).not.toContain('<all_urls>');
    // Repo allowlist stays empty — optional permission ≠ auto-configured allowlist.
    expect(DEFAULT_NYM_NETWORK_ALLOWLIST.gatewayOrigins).toEqual([]);
  });
});
