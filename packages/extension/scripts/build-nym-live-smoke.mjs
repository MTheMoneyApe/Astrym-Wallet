/**
 * One-shot extension rebuild with VITE_NYM_LIVE_SMOKE_AUTHORIZED=true.
 * Does not copy/rebuild SPP vendor assets. Does not request Chrome permissions.
 *
 * After this build: reload the unpacked extension, Grant permission in UI,
 * then invoke NYM_LIVE_SMOKE with confirmLiveSmoke:true (or Connect).
 * Rebuild with `pnpm build:nym-dev` afterwards to clear the auth flag.
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env, VITE_NYM_LIVE_SMOKE_AUTHORIZED: 'true' };

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: root, env, stdio: 'inherit', shell: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

run('node', ['scripts/copy-nym-mixfetch-assets.mjs']);
run('npx', ['vite', 'build', '--config', 'vite.config.ts']);
run('npx', ['vite', 'build', '--config', 'vite.background.config.ts']);
run('node', ['scripts/smoke-nym-mixfetch-assets.mjs', '--dist']);

console.log(
  '[nym-live-smoke] Built with VITE_NYM_LIVE_SMOKE_AUTHORIZED=true. Reload Chrome extension, grant exact host permission in UI, then run live smoke. Revert with: pnpm build:nym-dev',
);
