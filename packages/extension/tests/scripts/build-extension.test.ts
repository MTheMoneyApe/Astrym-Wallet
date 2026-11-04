import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  createNormalBuildEnvironment,
  runNymDevExtensionBuild,
  runNormalExtensionBuild,
} from '../../scripts/build-extension.mjs';

const EXTENSION_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

describe('extension build authorization', () => {
  it.each(['true', '1', 'unexpected'])(
    'overrides inherited authorization value %s',
    (authorization) => {
      const parentEnvironment = {
        VITE_NYM_LIVE_SMOKE_AUTHORIZED: authorization,
        CUSTOM_BUILD_SETTING: 'preserved',
      };

      const environment = createNormalBuildEnvironment(parentEnvironment);

      expect(environment.VITE_NYM_LIVE_SMOKE_AUTHORIZED).toBe('false');
      expect(environment.CUSTOM_BUILD_SETTING).toBe('preserved');
      expect(parentEnvironment.VITE_NYM_LIVE_SMOKE_AUTHORIZED).toBe(authorization);
    },
  );

  it('sets authorization to false when it is unset and preserves unrelated variables', () => {
    const environment = createNormalBuildEnvironment({
      CUSTOM_BUILD_SETTING: 'preserved',
    });

    expect(environment.VITE_NYM_LIVE_SMOKE_AUTHORIZED).toBe('false');
    expect(environment.CUSTOM_BUILD_SETTING).toBe('preserved');
  });

  it('forces live Nym smoke authorization off for every normal build step', () => {
    const calls: { args: string[]; env: NodeJS.ProcessEnv }[] = [];
    const status = runNormalExtensionBuild(
      (_command, args, options) => {
        calls.push({ args: args as string[], env: options?.env as NodeJS.ProcessEnv });
        return { status: 0 };
      },
      {
        VITE_NYM_LIVE_SMOKE_AUTHORIZED: 'true',
        CUSTOM_BUILD_SETTING: 'preserved',
        PATH: process.env.PATH,
      },
    );

    expect(status).toBe(0);
    expect(calls).toHaveLength(6);
    expect(calls.every(({ env }) => env.VITE_NYM_LIVE_SMOKE_AUTHORIZED === 'false')).toBe(
      true,
    );
    expect(calls.every(({ env }) => env.CUSTOM_BUILD_SETTING === 'preserved')).toBe(true);
    expect(calls.map(({ args }) => args[0])).toEqual([
      join(EXTENSION_ROOT, 'scripts/copy-spp-assets.mjs'),
      join(EXTENSION_ROOT, 'scripts/copy-nym-mixfetch-assets.mjs'),
      join(EXTENSION_ROOT, 'node_modules/vite/bin/vite.js'),
      join(EXTENSION_ROOT, 'node_modules/vite/bin/vite.js'),
      join(EXTENSION_ROOT, 'scripts/smoke-spp-assets.mjs'),
      join(EXTENSION_ROOT, 'scripts/smoke-nym-mixfetch-assets.mjs'),
    ]);

    const packageJson = JSON.parse(
      readFileSync(join(EXTENSION_ROOT, 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };
    expect(packageJson.scripts.build).toBe('node scripts/build-extension.mjs');
  });

  it('forces live Nym smoke authorization off in every nym-dev subprocess', () => {
    const calls: { args: string[]; env: NodeJS.ProcessEnv }[] = [];
    const status = runNymDevExtensionBuild(
      (_command, args, options) => {
        calls.push({ args: args as string[], env: options?.env as NodeJS.ProcessEnv });
        return { status: 0 };
      },
      {
        VITE_NYM_LIVE_SMOKE_AUTHORIZED: 'true',
        CUSTOM_BUILD_SETTING: 'preserved',
        PATH: process.env.PATH,
      },
    );

    expect(status).toBe(0);
    expect(calls).toHaveLength(4);
    expect(calls.every(({ env }) => env.VITE_NYM_LIVE_SMOKE_AUTHORIZED === 'false')).toBe(
      true,
    );
    expect(calls.every(({ env }) => env.CUSTOM_BUILD_SETTING === 'preserved')).toBe(true);
    expect(calls.map(({ args }) => args[0])).toEqual([
      join(EXTENSION_ROOT, 'scripts/copy-nym-mixfetch-assets.mjs'),
      join(EXTENSION_ROOT, 'node_modules/vite/bin/vite.js'),
      join(EXTENSION_ROOT, 'node_modules/vite/bin/vite.js'),
      join(EXTENSION_ROOT, 'scripts/smoke-nym-mixfetch-assets.mjs'),
    ]);

    const packageJson = JSON.parse(
      readFileSync(join(EXTENSION_ROOT, 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };
    expect(packageJson.scripts['build:nym-dev']).toBe(
      'node scripts/build-extension.mjs --nym-dev',
    );
  });

  it('keeps the dedicated live-smoke command explicitly authorized and separate', () => {
    const packageJson = JSON.parse(
      readFileSync(join(EXTENSION_ROOT, 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };
    const liveSmokeScript = readFileSync(
      join(EXTENSION_ROOT, 'scripts/build-nym-live-smoke.mjs'),
      'utf8',
    );

    expect(packageJson.scripts['build:nym-live-smoke']).toBe(
      'node scripts/build-nym-live-smoke.mjs',
    );
    expect(packageJson.scripts['build:nym-live-smoke']).not.toBe(packageJson.scripts.build);
    expect(liveSmokeScript).toMatch(
      /VITE_NYM_LIVE_SMOKE_AUTHORIZED:\s*'true'/,
    );
  });
});
