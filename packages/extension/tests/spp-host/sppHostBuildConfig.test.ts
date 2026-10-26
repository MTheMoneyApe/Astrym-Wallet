/**
 * Static checks for the host-only Vite config (Fase 5D.5).
 * Does not run vite build or touch the real SPP SDK.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXT_ROOT = join(__dirname, '../..');

describe('vite.spp-host.config.ts (host-only, static)', () => {
  const configSrc = readFileSync(join(EXT_ROOT, 'vite.spp-host.config.ts'), 'utf8');
  const pkg = JSON.parse(readFileSync(join(EXT_ROOT, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };

  it('keeps emptyOutDir false and publicDir false', () => {
    expect(configSrc).toMatch(/emptyOutDir:\s*false/);
    expect(configSrc).toMatch(/publicDir:\s*false/);
    expect(configSrc).not.toMatch(/emptyOutDir:\s*true/);
  });

  it('uses only spp-host.html as rollup input', () => {
    expect(configSrc).toMatch(/input:\s*resolve\(__dirname,\s*'spp-host\.html'\)/);
    expect(configSrc).not.toMatch(/popup\.html/);
    expect(configSrc).not.toMatch(/src\/content/);
    expect(configSrc).not.toMatch(/src\/provider/);
    expect(configSrc).not.toMatch(/src\/background/);
  });

  it('prefixes host outputs to avoid shared bundle collisions', () => {
    expect(configSrc).toMatch(/entryFileNames:\s*'spp-host\.js'/);
    expect(configSrc).toMatch(/chunkFileNames:\s*'spp-host-chunk-/);
    expect(configSrc).toMatch(/assetFileNames:\s*'spp-host-asset-/);
    expect(configSrc).toMatch(/modulePreload:\s*\{\s*polyfill:\s*false\s*\}/);
  });

  it('build:spp-host script only runs the dedicated config (no copy:spp / full build)', () => {
    const script = pkg.scripts['build:spp-host'];
    expect(script).toBe('vite build --config vite.spp-host.config.ts');
    expect(script).not.toMatch(/copy-spp|copy:spp|smoke:spp|vite\.config\.ts|background\.config/);
    expect(pkg.scripts['build']).toContain('copy-spp-assets');
    expect(pkg.scripts['build']).not.toBe(script);
  });

  it('source authorization remains false', () => {
    const prep = readFileSync(join(EXT_ROOT, 'src/spp-host/storageLabPrep.ts'), 'utf8');
    expect(prep).toMatch(/export const STORAGE_LAB_EXECUTION_AUTHORIZED = false/);
  });
});
