/**
 * Keep the production landing in dist-webapp after the normal Vite build.
 *
 * 5e651b47 copied index.html and public/website.css over a prebuilt tarball.
 * This step does that inside `pnpm build:webapp`: website.css is the public
 * file byte-for-byte, index.html is the canonical document with Vite's
 * hashed install-prompt module left in place, and public/fonts is copied
 * beside them.
 */
import { copyFileSync, cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist-webapp');
const canonicalPath = resolve(root, 'index.html');
const builtPath = resolve(dist, 'index.html');
const canonical = readFileSync(canonicalPath, 'utf8');
const built = readFileSync(builtPath, 'utf8');

const canonicalScript =
  /<script\s+type="module"\s+src="\/src\/website\/installPrompt\.ts"\s*>\s*<\/script>/;
const emittedTag =
  /<link\b[^>]*\brel=["']modulepreload["'][^>]*>|<script\b[^>]*\bsrc=["'][^"']+["'][^>]*>\s*<\/script>/g;

const emitted = [];
for (const match of built.matchAll(emittedTag)) {
  const tag = match[0];
  const ref = tag.match(/\b(?:src|href)=["']([^"']+)["']/);
  if (!ref) continue;
  if (ref[1].includes('/src/website/')) continue;
  if (!ref[1].includes('assets/')) continue;
  emitted.push(tag);
}

let html = canonical;
if (emitted.length > 0) {
  if (!canonicalScript.test(canonical)) {
    throw new Error('copy-canonical-landing: canonical index.html lost the installPrompt script tag');
  }
  html = canonical.replace(canonicalScript, emitted.join('\n    '));
} else if (!built.includes('/src/website/installPrompt.ts')) {
  throw new Error('copy-canonical-landing: Vite output has no install-prompt asset to preserve');
}

for (const marker of ['HACKMERIDIAN 2026', 'Abrir Astrym Webapp', './website.css']) {
  if (!html.includes(marker)) {
    throw new Error(`copy-canonical-landing: landing lost ${marker}`);
  }
}
if (html.includes('fonts.googleapis.com') || html.includes('fonts.gstatic.com')) {
  throw new Error('copy-canonical-landing: landing still references Google Fonts');
}

const cssPath = resolve(root, 'public/website.css');
const css = readFileSync(cssPath, 'utf8');
if (!css.includes('@font-face') || css.includes('fonts.googleapis.com') || css.includes('fonts.gstatic.com')) {
  throw new Error('copy-canonical-landing: website.css must self-host fonts');
}

writeFileSync(builtPath, html);
copyFileSync(cssPath, resolve(dist, 'website.css'));

const fontFiles = [
  'instrument-sans/instrument-sans-latin.woff2',
  'instrument-sans/OFL.txt',
  'jetbrains-mono/jetbrains-mono-latin-500.woff2',
  'jetbrains-mono/OFL.txt',
  'orbitron/orbitron-latin.woff2',
  'orbitron/OFL.txt',
];
const fontsDest = resolve(dist, 'fonts');
cpSync(resolve(root, 'public/fonts'), fontsDest, { recursive: true });
for (const rel of fontFiles) {
  if (!existsSync(resolve(fontsDest, rel))) {
    throw new Error(`copy-canonical-landing: missing shipped font ${rel}`);
  }
}
