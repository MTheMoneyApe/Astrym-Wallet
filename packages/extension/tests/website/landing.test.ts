import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');

const localFonts = [
  'public/fonts/instrument-sans/instrument-sans-latin.woff2',
  'public/fonts/instrument-sans/OFL.txt',
  'public/fonts/jetbrains-mono/jetbrains-mono-latin-500.woff2',
  'public/fonts/jetbrains-mono/OFL.txt',
  'public/fonts/orbitron/orbitron-latin.woff2',
  'public/fonts/orbitron/OFL.txt',
];

describe('Astrym landing page', () => {
  const html = readFileSync(resolve(root, 'index.html'), 'utf8');
  const css = readFileSync(resolve(root, 'public/website.css'), 'utf8');
  const i18n = readFileSync(resolve(root, 'public/site-language.js'), 'utf8');
  const vercel = readFileSync(resolve(root, '../../vercel.json'), 'utf8');

  it('uses the official brand and honest bilingual product copy', () => {
    for (const marker of ['brand/astrym-logo.png','Tu dinero. Tus claves. Tu privacidad.','Abrir Astrym Webapp','href="./webapp.html"','Instalar PWA (Android / iOS)','Stellar Private Payments','No afirma anonimato','data-language="en"','data-language="es"']) expect(html).toContain(marker);
    expect(i18n).toContain('astrym-site-language');
    for (const page of ['wallet','privacy','payments','learn','security','download','docs','about','roadmap','faq']) {
      expect(html).toContain('/' + page + '.html');
      const body = readFileSync(resolve(root, 'public', page + '.html'), 'utf8');
      expect(body).toContain('data-en');
      expect(body).toContain('Testnet');
    }
    expect(readFileSync(resolve(root,'public/about.html'),'utf8')).toContain('HACKMERIDIAN 2026');
    expect(readFileSync(resolve(root,'public/docs.html'),'utf8')).toContain('spp-host.html');
  });

  it('uses the Astrym palette and local font fallbacks', () => {
    expect(css).toContain('#191a1c');
    expect(css).toContain('#141416');
    expect(css).toContain('#3ce894');
    expect(css).toContain('#f7cb08');
    expect(css).toContain('.cards');
    expect(html).not.toContain('fonts.googleapis.com');
    expect(html).not.toContain('fonts.gstatic.com');
    expect(css).not.toContain('fonts.googleapis.com');
    expect(css).not.toContain('fonts.gstatic.com');
    expect(css).toContain('@font-face');
    expect(css).toContain('./fonts/instrument-sans/instrument-sans-latin.woff2');
    expect(css).toContain('./fonts/jetbrains-mono/jetbrains-mono-latin-500.woff2');
    expect(css).toContain('./fonts/orbitron/orbitron-latin.woff2');
    expect(css).toContain('"Instrument Sans", sans-serif');
    expect(css).toContain('"JetBrains Mono", ui-monospace, monospace');
    expect(css).toContain('Orbitron, sans-serif');
    for (const file of localFonts) {
      expect(existsSync(resolve(root, file)), file).toBe(true);
    }
  });

  it('points Vercel at the webapp build', () => {
    expect(vercel).toContain('pnpm build:webapp');
    expect(vercel).toContain('packages/extension/dist-webapp');
    expect(vercel).toContain('application/wasm');
  });
});
