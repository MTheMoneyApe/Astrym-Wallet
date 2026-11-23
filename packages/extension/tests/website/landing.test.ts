import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { applyLanguage, initSiteLanguage, resolveInitialLanguage, translations } from '../../src/website/i18n.ts';

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
    expect(html).toContain('STELLAR · PRIVACY · SELF-CUSTODY');
    expect(html).toContain('Abrir Astrym Webapp');
    expect(html).toContain('href="./webapp.html"');
    expect(html).toContain('Instalar PWA (Android / iOS)');
    expect(html).toContain('Privacidad con ingeniería cuidadosa.');
    expect(html).toContain('no solicita claves');
    expect(html).toContain('data-language="es"');
    expect(html).toContain('data-language="en"');
    expect(html).not.toMatch(/<style[\s>]/i);
    expect(html).not.toMatch(/\sstyle=/i);
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)/i);
    expect(i18n).toContain('Privacy, engineered with care.');
    expect(i18n).toContain('does not request keys or enable transactions');
    expect(i18n).toContain("localStorage.setItem('astrym-site-language'");
    expect(i18n).toContain('navigator.language');
    expect(i18n).toContain('document.documentElement.lang');
  });

  it('uses the Astrym palette and local font fallbacks', () => {
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

  it('ships both languages and toggles the persisted document language', () => {
    expect(resolveInitialLanguage(null, 'en-US')).toBe('en');
    expect(resolveInitialLanguage(null, 'es-MX')).toBe('es');
    expect(resolveInitialLanguage('es', 'en-GB')).toBe('es');
    expect(resolveInitialLanguage('en', 'es')).toBe('en');
    expect(resolveInitialLanguage(null, '')).toBe('es');

    const keys = new Set([...html.matchAll(/data-i18n(?:-aria)?="([^"]+)"/g)].map((match) => match[1]));
    expect(keys.size).toBeGreaterThan(10);
    for (const key of keys) {
      expect(translations.es[key], `es:${key}`).toBeTruthy();
      expect(translations.en[key], `en:${key}`).toBeTruthy();
    }
    expect(translations.es.hero_title).not.toBe(translations.en.hero_title);

    const dom = new JSDOM(html, { url: 'http://127.0.0.1/index.html' });
    const scope = globalThis as unknown as { document: Document; localStorage: Storage };
    const previous = { document: scope.document, localStorage: scope.localStorage };
    scope.document = dom.window.document as unknown as Document;
    scope.localStorage = dom.window.localStorage;
    try {
      localStorage.setItem('astrym-site-language', 'es');
      initSiteLanguage();
      expect(document.documentElement.lang).toBe('es');
      expect(document.querySelector('h1')?.textContent).toBe(translations.es.hero_title);
      const english = document.querySelector<HTMLButtonElement>('[data-language="en"]');
      english?.click();
      expect(document.documentElement.lang).toBe('en');
      expect(document.querySelector('h1')?.textContent).toBe('Privacy, engineered with care.');
      expect(localStorage.getItem('astrym-site-language')).toBe('en');
      expect(english?.getAttribute('aria-pressed')).toBe('true');
      expect(document.querySelector('[data-i18n="extension_step2"]')?.innerHTML).toContain('<code>pnpm install</code>');
      expect(document.querySelector('#site-nav')?.getAttribute('aria-label')).toBe('Main');
      applyLanguage('es');
      expect(document.documentElement.lang).toBe('es');
      expect(localStorage.getItem('astrym-site-language')).toBe('es');
      expect(document.querySelector('[data-language="es"]')?.classList.contains('is-active')).toBe(true);
    } finally {
      scope.document = previous.document;
      scope.localStorage = previous.localStorage;
    }
  });
});
