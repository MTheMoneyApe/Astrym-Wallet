import { cp, access } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const output = resolve(root, 'packages/extension/dist-webapp');
const required = ['webapp.html', 'manifest.webmanifest', 'webapp-sw.js'];
for (const file of required) {
  await access(resolve(output, file));
}
await cp(resolve(root, 'public'), output, { recursive: true, force: true });
for (const file of ['index.html', 'styles.css', 'site.js']) {
  await access(resolve(output, file));
}
console.log('[vercel-site] Combined landing + webapp output verified.');
