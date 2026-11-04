import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const walletCss = readFileSync(resolve(root, 'src/popup/wallet.css'), 'utf8');
const websiteCss = readFileSync(resolve(root, 'public/website.css'), 'utf8');
const webappHtml = readFileSync(resolve(root, 'webapp.html'), 'utf8');
const landingHtml = readFileSync(resolve(root, 'index.html'), 'utf8');

describe('responsive shared CSS contracts', () => {
  it('keeps the extension popup at a fixed 400×600 shell', () => {
    expect(walletCss).toContain('html:not(.astrym-webapp)');
    expect(walletCss).toMatch(/width:\s*400px/);
    expect(walletCss).toMatch(/height:\s*600px/);
  });

  it('uses Astrym webapp tokens, dvh, and safe-area insets', () => {
    expect(walletCss).toContain('html.astrym-webapp');
    expect(walletCss).toContain('#191A1C');
    expect(walletCss).toContain('#141416');
    expect(walletCss).toContain('#3CE894');
    expect(walletCss).toContain('#F7CB08');
    expect(walletCss).toContain('100dvh');
    expect(walletCss).toContain('env(safe-area-inset-top');
    expect(walletCss).toContain('--tap-min: 44px');
    expect(walletCss).toContain('font-size: 16px');
    expect(walletCss).toContain('.wallet-shell');
    expect(walletCss).toContain('.address-wrap');
    expect(walletCss).toContain('@media (orientation: landscape)');
  });

  it('keeps the webapp shell logo compact against the global img rule', () => {
    expect(walletCss).toContain('html.astrym-webapp .android-webapp-bar img');
    const overrideIdx = walletCss.indexOf('html.astrym-webapp .android-webapp-bar img');
    const globalImgIdx = walletCss.indexOf('html.astrym-webapp img');
    expect(overrideIdx).toBeGreaterThan(globalImgIdx);
    const block = walletCss.slice(overrideIdx, overrideIdx + 220);
    expect(block).toMatch(/height:\s*22px/);
    expect(block).toMatch(/max-width:\s*min\(42%,\s*140px\)/);
  });

  it('gives the desktop popup a single scrollable view-container', () => {
    expect(walletCss).toContain('html:not(.astrym-webapp) .wallet-shell');
    expect(walletCss).toContain('html:not(.astrym-webapp) .view-container');
    expect(walletCss).toContain('html:not(.astrym-webapp) .android-webapp-bar');
    expect(walletCss).toMatch(/html:not\(\.astrym-webapp\) \.view-container[\s\S]*?overflow-y:\s*auto/);
  });

  it('keeps unlock/corner logos compact on desktop', () => {
    expect(walletCss).toMatch(/html:not\(\.astrym-webapp\) \.unlock-logo[\s\S]*?width:\s*64px/);
    expect(walletCss).toMatch(/\.unlock-logo\s*\{[\s\S]*?width:\s*72px/);
  });

  it('covers the audited breakpoints', () => {
    for (const bp of ['429px', '768px', '1024px', '1280px']) {
      expect(walletCss).toContain(bp);
    }
  });

  it('makes the landing page mobile-safe', () => {
    expect(websiteCss).toContain('100dvh');
    expect(websiteCss).toContain('safe-area-inset');
    expect(websiteCss).toContain('--tap-min');
    expect(websiteCss).toContain('overflow-x: hidden');
    expect(landingHtml).toContain('viewport-fit=cover');
    expect(webappHtml).toContain('viewport-fit=cover');
  });
});
