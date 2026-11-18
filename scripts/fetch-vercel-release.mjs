import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const output = resolve(root, 'packages/extension/dist-webapp');
const commit = process.env.VERCEL_GIT_COMMIT_SHA ?? '';
if (!/^[0-9a-f]{40}$/i.test(commit)) {
  throw new Error('VERCEL_GIT_COMMIT_SHA must be a full 40-character commit SHA');
}

const tag = `astrym-products-${commit}`;
const base = `https://github.com/MTheMoneyApe/Astrym-Wallet/releases/download/${tag}`;
const archiveName = 'astrym-vercel-products.tar.gz';
const metadataName = 'astrym-vercel-products.json';
const temporaryArchive = resolve('/tmp', `astrym-vercel-products-${commit}.tar.gz`);

function fail(message) {
  throw new Error(`fetch-vercel-release: ${message}`);
}
async function fetchResponse(url, label) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'Astrym-Vercel-Release-Assembler' },
  });
  if (!response.ok) fail(`${label} download returned HTTP ${response.status}`);
  if (!response.body) fail(`${label} response has no body`);
  return response;
}
async function sha256File(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
function gitBlobSha1(data) {
  return createHash('sha1')
    .update(Buffer.from(`blob ${data.length}`))
    .update(Buffer.from([0]))
    .update(data)
    .digest('hex');
}
async function requireFile(relative) {
  const path = resolve(output, relative);
  if (!path.startsWith(output + '/') || path === output) fail(`unsafe expected path: ${relative}`);
  try { await access(path); } catch { fail(`release bundle is missing ${relative}`); }
  return path;
}

const metadataResponse = await fetchResponse(`${base}/${metadataName}`, 'release metadata');
const bundleMetadata = await metadataResponse.json();
if (bundleMetadata.sourceCommit !== commit) fail('release metadata commit does not match the Vercel source commit');
if (bundleMetadata.archiveName !== archiveName) fail('unexpected release archive name');
if (!Number.isSafeInteger(bundleMetadata.sizeBytes) || bundleMetadata.sizeBytes <= 0) fail('invalid archive size metadata');
if (!/^[0-9a-f]{64}$/i.test(bundleMetadata.sha256 ?? '')) fail('invalid archive SHA-256 metadata');

const archiveResponse = await fetchResponse(`${base}/${archiveName}`, 'release bundle');
await rm(temporaryArchive, { force: true });
await pipeline(Readable.fromWeb(archiveResponse.body), createWriteStream(temporaryArchive));
const archiveStat = await stat(temporaryArchive);
if (archiveStat.size !== bundleMetadata.sizeBytes) {
  fail(`archive size mismatch: expected ${bundleMetadata.sizeBytes}, got ${archiveStat.size}`);
}
const archiveSha = await sha256File(temporaryArchive);
if (archiveSha !== bundleMetadata.sha256) {
  fail(`archive SHA-256 mismatch: expected ${bundleMetadata.sha256}, got ${archiveSha}`);
}

const listing = spawnSync('tar', ['-tzf', temporaryArchive], {
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
});
if (listing.status !== 0) fail(`cannot inspect release archive: ${listing.stderr || listing.error || listing.status}`);
for (const entry of listing.stdout.split(/\r?\n/).filter(Boolean)) {
  const normalized = entry.replace(/^\.\//, '');
  if (entry.startsWith('/') || normalized.split('/').includes('..') || normalized.includes('\\')) {
    fail(`unsafe path in release archive: ${entry}`);
  }
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const extraction = spawnSync('tar', [
  '--no-same-owner',
  '--no-same-permissions',
  '-xzf', temporaryArchive,
  '-C', output,
], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
if (extraction.status !== 0) fail(`cannot extract release archive: ${extraction.stderr || extraction.error || extraction.status}`);

const required = [
  'index.html',
  'site.js',
  'styles.css',
  'brand/astrym-logo.png',
  'brand/astrym-symbol.png',
  'webapp.html',
  'manifest.webmanifest',
  'webapp-sw.js',
  'downloads/astrym-wallet-mv3.zip',
  'downloads/astrym-wallet-mv3.json',
];
for (const path of required) await requireFile(path);

const pinnedLanding = [
  ['index.html', 'a4a5e009fa13234cc84623e9675737673732a50d'],
  ['site.js', '9b8dcb174ad6aba7001b3d539345ff2117d59aab'],
  ['styles.css', 'ae311d35f80ad636b6fff9751b408494b6403053'],
  ['brand/astrym-logo.png', 'acbf1050407dc9bb549e9f34968610458f11d568'],
  ['brand/astrym-symbol.png', 'acbf1050407dc9bb549e9f34968610458f11d568'],
];
for (const [path, expected] of pinnedLanding) {
  const data = await readFile(await requireFile(path));
  const actual = gitBlobSha1(data);
  if (actual !== expected) fail(`landing asset changed: ${path} (expected ${expected}, got ${actual})`);
}
const pwa = JSON.parse(await readFile(await requireFile('manifest.webmanifest'), 'utf8'));
if (pwa.start_url !== './webapp.html' || pwa.display !== 'standalone') {
  fail('PWA manifest does not point to the wallet in standalone mode');
}
const extensionMetadata = JSON.parse(await readFile(await requireFile('downloads/astrym-wallet-mv3.json'), 'utf8'));
if (extensionMetadata.sourceCommit !== commit) fail('extension package commit does not match release commit');
if (extensionMetadata.archive !== '/downloads/astrym-wallet-mv3.zip') fail('unexpected extension archive path');
if (!/^[0-9a-f]{64}$/i.test(extensionMetadata.sha256 ?? '')) fail('invalid extension archive SHA-256');
const extensionArchive = await requireFile('downloads/astrym-wallet-mv3.zip');
const extensionStat = await stat(extensionArchive);
if (extensionStat.size !== extensionMetadata.sizeBytes) fail('extension archive size does not match its metadata');
if (await sha256File(extensionArchive) !== extensionMetadata.sha256) fail('extension archive SHA-256 does not match its metadata');

console.log(JSON.stringify({
  ok: true,
  sourceCommit: commit,
  releaseTag: tag,
  archiveBytes: archiveStat.size,
  archiveSha256: archiveSha,
  verifiedLandingAssets: pinnedLanding.length,
  webapp: '/webapp.html',
  pwa: '/manifest.webmanifest',
  extension: '/downloads/astrym-wallet-mv3.zip',
  extensionBytes: extensionStat.size,
  extensionSha256: extensionMetadata.sha256,
  outputDirectory: output,
}, null, 2));
