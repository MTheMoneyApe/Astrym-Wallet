import { defineConfig } from '@playwright/test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const distWebapp = resolve(root, 'dist-webapp');

export default defineConfig({
  testDir: './tests/responsive',
  testMatch: '**/*.spec.ts',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'off',
    screenshot: 'off',
  },
  webServer: {
    command: `pnpm exec vite preview --config vite.webapp.config.ts --host 127.0.0.1 --port 4173 --strictPort`,
    cwd: root,
    port: 4173,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
