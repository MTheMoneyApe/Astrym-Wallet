/**
 * Copy stellar-private-payments@0.2.1 assets into ./vendor/ for
 * chrome-extension:// script-src 'self' (no remote CDN).
 *
 * Does NOT modify package.json / lockfiles. Run from this directory:
 *   node prepare-vendor.mjs
 */
import { cpSync, existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// mv3-spike → …/packages/wallet-core (5 levels up)
const walletCoreRoot = join(__dirname, '../../../../../');
const pkgRoot = join(walletCoreRoot, 'node_modules', 'stellar-private-payments');
const pkgPath = join(pkgRoot, 'package.json');
if (!existsSync(pkgPath)) {
  console.error(JSON.stringify({ error: 'SDK package not found', pkgPath }, null, 2));
  process.exit(1);
}
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const vendorRoot = join(__dirname, 'vendor');

if (existsSync(vendorRoot)) {
  rmSync(vendorRoot, { recursive: true, force: true });
}
mkdirSync(vendorRoot, { recursive: true });

const dirCopies = [
  ['dist', 'dist'],
  ['js', 'js'],
];

const results = [];
for (const [rel, destName] of dirCopies) {
  const src = join(pkgRoot, rel);
  const dest = join(vendorRoot, destName);
  if (!existsSync(src)) {
    results.push({ destName, ok: false, reason: 'missing', src });
    continue;
  }
  cpSync(src, dest, { recursive: true });
  results.push({ destName, ok: true, src });
}

writeFileSync(
  join(vendorRoot, 'VENDOR_META.json'),
  JSON.stringify(
    {
      name: pkg.name,
      version: pkg.version,
      resolvedFrom: pkgRoot,
      copiedAt: new Date().toISOString(),
      files: results,
      note: 'Harness spike only — never ship as production wallet package',
    },
    null,
    2,
  ),
);

console.log(JSON.stringify({ vendorRoot, version: pkg.version, results }, null, 2));
process.exit(results.every((r) => r.ok) ? 0 : 1);
