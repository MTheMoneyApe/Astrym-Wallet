import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');

describe('Astrym landing page', () => {
  const html = readFileSync(resolve(root, 'index.html'), 'utf8');
  const css = readFileSync(resolve(root, 'public/website.css'), 'utf8');
  const vercel = readFileSync(resolve(root, '../../vercel.json'), 'utf8');

  it('uses the official brand, CTAs, and HackMeridian sections', () => {
    expect(html).toContain('brand/astrym-logo.png');
    expect(html).toContain('ASTRYM — Billetera de Privacidad en Stellar con Tecnología Nym');
    expect(html).toContain('HACKMERIDIAN 2026 · LISBON · STELLAR × NYM');
    expect(html).toContain('Abrir Astrym Webapp (Android / Navegador)');
    expect(html).toContain('href="./webapp.html"');
    expect(html).toContain('Instalar en Android (PWA)');
    expect(html).toContain('The Solution');
    expect(html).toContain('Stellar Private Payments');
    expect(html).toContain('Technical Workflow');
    expect(html).toContain('01 Local Wallet');
    expect(html).toContain('02 Nym Mixnet');
    expect(html).toContain('03 Stellar Data Access');
    expect(html).toContain('@MTheMoneyApe — Founder &amp; Vibecoder');
    expect(html).toContain('Pulsa el menú ⋮ del navegador → Añadir a pantalla de inicio / Instalar app');
  });

  it('uses the Astrym palette and the three typefaces', () => {
    expect(css).toContain('#191a1c');
    expect(css).toContain('#141416');
    expect(css).toContain('#3ce894');
    expect(css).toContain('#f7cb08');
    expect(html).toContain('Orbitron');
    expect(html).toContain('Instrument+Sans');
    expect(html).toContain('JetBrains+Mono');
  });

  it('points Vercel at the webapp build', () => {
    expect(vercel).toContain('pnpm build:webapp');
    expect(vercel).toContain('packages/extension/dist-webapp');
    expect(vercel).toContain('application/wasm');
  });
});
