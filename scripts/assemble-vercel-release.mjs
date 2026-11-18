import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const extensionDist = resolve(root, 'packages/extension/dist');
const webappDist = resolve(root, 'packages/extension/dist-webapp');
const staticCommit = '01c7cc6c9f556baee09ddd8272a51db389e6b7cc';
const staticAssets = [
  { source: 'public/index.html', target: 'index.html', blobSha: 'a4a5e009fa13234cc84623e9675737673732a50d' },
  { source: 'public/site.js', target: 'site.js', blobSha: '9b8dcb174ad6aba7001b3d539345ff2117d59aab' },
  { source: 'public/styles.css', target: 'styles.css', blobSha: 'ae311d35f80ad636b6fff9751b408494b6403053' },
  { source: 'public/brand/astrym-logo.png', target: 'brand/astrym-logo.png', blobSha: 'acbf1050407dc9bb549e9f34968610458f11d568' },
  { source: 'public/brand/astrym-symbol.png', target: 'brand/astrym-symbol.png', blobSha: 'acbf1050407dc9bb549e9f34968610458f11d568' },
];

function fail(message) {
  throw new Error(`release assembly failed: ${message}`);
}
async function requireFile(path, label) {
  try {
    await access(path);
  } catch {
    fail(`missing ${label}: ${path}`);
  }
}
function gitBlobSha(data) {
  return createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');
}
async function sha256File(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

for (const path of ['webapp.html', 'manifest.webmanifest', 'webapp-sw.js']) {
  await requireFile(resolve(webappDist, path), `WebApp asset ${path}`);
}
for (const path of ['manifest.json', 'popup.html', 'spp-host.html', 'nym-offscreen.html', 'background.js', 'content.js', 'provider.js']) {
  await requireFile(resolve(extensionDist, path), `MV3 asset ${path}`);
}

const mv3Manifest = JSON.parse(await readFile(resolve(extensionDist, 'manifest.json'), 'utf8'));
if (mv3Manifest.manifest_version !== 3) fail('MV3 manifest_version is not 3');
if (mv3Manifest.background?.type !== 'module') fail('MV3 background service worker is not a module');
if (typeof mv3Manifest.background?.service_worker !== 'string') fail('MV3 service worker path is missing');
await requireFile(resolve(extensionDist, mv3Manifest.background.service_worker), 'MV3 background service worker');
for (const [label, rel] of [
  ['popup', mv3Manifest.action?.default_popup],
  ...Object.entries(mv3Manifest.icons ?? {}).map(([size, value]) => [`icon ${size}`, value]),
  ...Object.entries(mv3Manifest.action?.default_icon ?? {}).map(([size, value]) => [`action icon ${size}`, value]),
]) {
  if (rel) await requireFile(resolve(extensionDist, rel), label);
}
const sppMeta = JSON.parse(await readFile(resolve(extensionDist, 'spp/SPP_ASSET_META.json'), 'utf8'));
if (sppMeta.profile !== 'full' || !Array.isArray(sppMeta.files) || sppMeta.files.length === 0) {
  fail('MV3 package does not contain the full SPP asset inventory');
}
const pwaManifest = JSON.parse(await readFile(resolve(webappDist, 'manifest.webmanifest'), 'utf8'));
if (pwaManifest.start_url !== './webapp.html' || pwaManifest.display !== 'standalone') {
  fail('PWA manifest does not target the full-page wallet in standalone mode');
}

for (const asset of staticAssets) {
  const url = `https://raw.githubusercontent.com/MTheMoneyApe/Astrym-Wallet/${staticCommit}/${asset.source}`;
  const response = await fetch(url);
  if (!response.ok) fail(`could not fetch pinned landing asset ${asset.source}: HTTP ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  const actualBlobSha = gitBlobSha(data);
  if (actualBlobSha !== asset.blobSha) {
    fail(`pinned landing asset changed: ${asset.source} (expected ${asset.blobSha}, got ${actualBlobSha})`);
  }
  const destination = resolve(webappDist, asset.target);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, data);
}

const zipPath = resolve(webappDist, 'downloads/astrym-wallet-mv3.zip');
await mkdir(dirname(zipPath), { recursive: true });
const packageResult = spawnSync('python3', [
  'scripts/package-mv3-extension.py',
  extensionDist,
  zipPath,
], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
if (packageResult.status !== 0) {
  fail(`MV3 ZIP packaging failed: ${packageResult.stderr || packageResult.stdout || packageResult.error}`);
}
const sizeBytes = (await stat(zipPath)).size;
const sha256 = await sha256File(zipPath);
const sourceCommit = process.env.VERCEL_GIT_COMMIT_SHA
  || process.env.GITHUB_SHA
  || (() => {
    const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
    return result.status === 0 ? result.stdout.trim() : 'unknown';
  })();
const releaseMetadata = {
  product: 'Astrym Wallet MV3',
  version: mv3Manifest.version,
  manifestVersion: mv3Manifest.manifest_version,
  sourceCommit,
  archive: '/downloads/astrym-wallet-mv3.zip',
  sizeBytes,
  sha256,
  sppProfile: sppMeta.profile,
  sppFiles: sppMeta.files.length,
  pwaStartUrl: pwaManifest.start_url,
  staticAssetCommit: staticCommit,
  staticAssets: staticAssets.map(({ target, blobSha }) => ({ path: target, gitBlobSha1: blobSha })),
};
await writeFile(
  resolve(webappDist, 'downloads/astrym-wallet-mv3.json'),
  JSON.stringify(releaseMetadata, null, 2) + '\n',
);
console.log(JSON.stringify({
  ok: true,
  landingAssets: staticAssets.map((asset) => asset.target),
  extensionManifestVersion: mv3Manifest.manifest_version,
  extensionZip: releaseMetadata.archive,
  extensionZipBytes: sizeBytes,
  extensionZipSha256: sha256,
  pwaStartUrl: pwaManifest.start_url,
  pwaDisplay: pwaManifest.display,
  sourceCommit,
}, null, 2));
