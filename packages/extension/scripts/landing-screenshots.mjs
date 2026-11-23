import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const dist = resolve(root, 'dist-webapp');
const out = resolve(root, '../../docs/landing-screens');
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
};

const shots = [
  [360, 800],
  [390, 844],
  [430, 932],
  [768, 1024],
  [1280, 800],
];

if (!existsSync(resolve(dist, 'index.html'))) {
  throw new Error('landing-screenshots: build dist-webapp first');
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const file = join(dist, rel);
  if (!file.startsWith(dist) || !existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});

await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
const { port } = server.address();
const browser = await chromium.launch();
mkdirSync(out, { recursive: true });

try {
  for (const language of ['es', 'en']) {
    for (const [width, height] of shots) {
      const page = await browser.newPage({ viewport: { width, height }, locale: language === 'en' ? 'en-US' : 'es-ES' });
      await page.addInitScript((lang) => localStorage.setItem('astrym-site-language', lang), language);
      await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
      const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
      if (overflow > 1) throw new Error(`${language} ${width}x${height} overflows by ${overflow}px`);
      const small = await page.evaluate(() => [...document.querySelectorAll('a, button')].filter((el) => {
        const box = el.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && (box.width < 44 || box.height < 44);
      }).map((el) => `${el.tagName}.${el.className}:${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`));
      if (small.length) throw new Error(`${language} ${width}x${height} tap targets <44px: ${small.join(', ')}`);
      await page.screenshot({ path: resolve(out, `${language}-${width}x${height}.png`), fullPage: true });
      if (language === 'es' && width === 390) {
        await page.click('[data-nav-toggle]');
        await page.screenshot({ path: resolve(out, 'es-390x844-menu.png'), fullPage: true });
      }
      await page.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}
