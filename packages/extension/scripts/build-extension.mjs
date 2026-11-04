import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const EXTENSION_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const VITE_CLI = join(EXTENSION_ROOT, 'node_modules', 'vite', 'bin', 'vite.js');

const BUILD_STEPS = [
  ['scripts/copy-spp-assets.mjs'],
  ['scripts/copy-nym-mixfetch-assets.mjs'],
  [VITE_CLI, 'build', '--config', 'vite.config.ts'],
  [VITE_CLI, 'build', '--config', 'vite.background.config.ts'],
  ['scripts/smoke-spp-assets.mjs'],
  ['scripts/smoke-nym-mixfetch-assets.mjs', '--dist'],
];
const NYM_DEV_BUILD_STEPS = [
  ['scripts/copy-nym-mixfetch-assets.mjs'],
  [VITE_CLI, 'build', '--config', 'vite.config.ts'],
  [VITE_CLI, 'build', '--config', 'vite.background.config.ts'],
  ['scripts/smoke-nym-mixfetch-assets.mjs', '--dist'],
];

export function createNormalBuildEnvironment(parentEnvironment) {
  return {
    ...parentEnvironment,
    VITE_NYM_LIVE_SMOKE_AUTHORIZED: 'false',
  };
}

export function runNormalExtensionBuild(
  runCommand = spawnSync,
  parentEnvironment = process.env,
) {
  return runBuildSteps(BUILD_STEPS, runCommand, parentEnvironment);
}

export function runNymDevExtensionBuild(
  runCommand = spawnSync,
  parentEnvironment = process.env,
) {
  return runBuildSteps(NYM_DEV_BUILD_STEPS, runCommand, parentEnvironment);
}

function runBuildSteps(steps, runCommand, parentEnvironment) {
  const env = createNormalBuildEnvironment(parentEnvironment);

  for (const [script, ...args] of steps) {
    const isVite = script === VITE_CLI;
    const commandArgs = isVite ? [script, ...args] : [join(EXTENSION_ROOT, script), ...args];
    const result = runCommand(process.execPath, commandArgs, {
      cwd: EXTENSION_ROOT,
      env,
      stdio: 'inherit',
    });

    if (result.error) throw result.error;
    if (result.status !== 0) return result.status ?? 1;
  }

  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode =
    process.argv[2] === '--nym-dev'
      ? runNymDevExtensionBuild()
      : runNormalExtensionBuild();
}
