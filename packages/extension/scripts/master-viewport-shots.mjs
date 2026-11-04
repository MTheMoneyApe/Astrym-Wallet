import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '/workspace/node_modules/.pnpm/playwright@1.64.1/node_modules/playwright/index.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = '/opt/cursor/artifacts/master-exec-screenshots';
mkdirSync(out, { recursive: true });
const walletCss = readFileSync(resolve(root, 'src/popup/wallet.css'), 'utf8');

const viewports = [
  [1440, 900],
  [1280, 800],
  [1024, 768],
  [768, 1024],
  [390, 844],
  [360, 800],
];

const browser = await chromium.launch();
const page = await browser.newPage();

async function shot(name, width, height) {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(80);
  await page.screenshot({ path: resolve(out, `${name}-${width}x${height}.png`), fullPage: true });
}

await page.goto('http://127.0.0.1:4173/index.html');
for (const [w, h] of viewports) await shot('landing', w, h);

await page.goto('http://127.0.0.1:4173/spp-host.html');
for (const [w, h] of viewports) await shot('spp-host', w, h);

const popupHtml = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><style>${walletCss}</style></head>
<body><div id="root"><div class="wallet-shell">
  <div class="android-webapp-bar" data-testid="should-be-hidden"><img alt="Astrym" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='22'%3E%3Crect width='120' height='22' fill='%233CE894'/%3E%3C/svg%3E"/><button>Modo Android</button></div>
  <div class="view-container">
    <div class="header"><h2>Settings / Menu</h2></div>
    ${Array.from({ length: 24 })
      .map(
        (_, i) =>
          `<div class="card" style="margin-bottom:10px"><strong>Section ${i + 1}</strong><p class="text-secondary">Reachable via normal scrolling in the desktop extension shell.</p></div>`,
      )
      .join('')}
  </div>
</div></div></body></html>`;
await page.setContent(popupHtml);
await page.setViewportSize({ width: 420, height: 640 });
const metrics = await page.evaluate(() => {
  const bar = document.querySelector('.android-webapp-bar');
  const vc = document.querySelector('.view-container');
  const cs = bar ? getComputedStyle(bar) : null;
  return {
    barDisplay: cs?.display ?? null,
    bodyW: Math.round(document.body.getBoundingClientRect().width),
    bodyH: Math.round(document.body.getBoundingClientRect().height),
    scrollHeight: vc?.scrollHeight ?? 0,
    clientHeight: vc?.clientHeight ?? 0,
    overflowY: vc ? getComputedStyle(vc).overflowY : null,
  };
});
writeFileSync(resolve(out, 'desktop-popup-scroll-metrics.json'), JSON.stringify(metrics, null, 2));
await page.screenshot({ path: resolve(out, 'desktop-popup-top.png') });
await page.evaluate(() => {
  const vc = document.querySelector('.view-container');
  if (vc) vc.scrollTop = vc.scrollHeight;
});
await page.waitForTimeout(50);
await page.screenshot({ path: resolve(out, 'desktop-popup-scrolled-bottom.png') });

const unlockHtml = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><style>${walletCss}</style></head>
<body><div id="root"><div class="wallet-shell"><div class="unlock-screen"><div class="unlock-brand"><div class="unlock-logo" style="background:#3CE894"></div><h2 class="unlock-title">Astrym</h2><span class="unlock-tagline">PRIVATE BY DESIGN</span></div></div></div></div></body></html>`;
await page.setContent(unlockHtml);
await page.setViewportSize({ width: 400, height: 600 });
const logo = await page.evaluate(() => {
  const el = document.querySelector('.unlock-logo');
  const r = el.getBoundingClientRect();
  return { w: Math.round(r.width), h: Math.round(r.height) };
});
writeFileSync(resolve(out, 'desktop-unlock-logo.json'), JSON.stringify(logo, null, 2));
await page.screenshot({ path: resolve(out, 'desktop-unlock-compact-logo.png') });

console.log(JSON.stringify({ metrics, logo, out }, null, 2));
await browser.close();
