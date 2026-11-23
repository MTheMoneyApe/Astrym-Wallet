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
  const i18n = readFileSync(resolve(root, 'src/website/i18n.ts'), 'utf8');
  const vercel = readFileSync(resolve(root, '../../vercel.json'), 'utf8');

  it('uses the official brand, honest product copy, and HackMeridian badge', () => {
    expect(html).toContain('brand/astrym-logo.png');
    expect(html).toContain('>ASTRYM<');
    expect(html).toContain('HACKMERIDIAN 2026 · LISBON · STELLAR × NYM');
    expect(html).toContain('Abrir Astrym Webapp');
    expect(html).toContain('href="./webapp.html"');
    expect(html).toContain('Instalar PWA (Android / iOS)');
    expect(html).toContain('Qué hace Astrym hoy');
    expect(html).toContain('Stellar Private Payments');
    expect(html).toContain('Implementado');
    expect(html).toContain('En curso');
    expect(html).toContain('Futuro');
    expect(html).toContain('no afirma anonimato');
    expect(html).toContain('spp-host.html');
    expect(i18n).toContain('Technical workflow');
    expect(i18n).toContain('does not claim cryptographic anonymity');
  });

  it('uses the Astrym palette and self-hosted fonts', () => {
    expect(css).toContain('#191a1c');
    expect(css).toContain('#141416');
    expect(css).toContain('#3ce894');
    expect(css).toContain('#f7cb08');
    expect(css).toContain('.status-board');
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
