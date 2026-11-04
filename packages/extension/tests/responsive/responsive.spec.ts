import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildScreenDocument, SCREEN_IDS, type ScreenId } from './screenFixtures.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(__dirname, '../..');
const artifactsRoot = resolve('/opt/cursor/artifacts/responsive');
const shotsDir = resolve(artifactsRoot, 'screenshots');

const WIDTHS = [320, 375, 430, 768, 1024, 1280, 1440] as const;
const LANDSCAPE = { width: 844, height: 390 } as const;

const walletCss = readFileSync(resolve(extensionRoot, 'src/popup/wallet.css'), 'utf8');

async function assertNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    const scrollWidth = Math.max(doc.scrollWidth, body.scrollWidth);
    const clientWidth = window.innerWidth;
    return { scrollWidth, clientWidth, overflowPx: scrollWidth - clientWidth };
  });
  expect(
    overflow.overflowPx,
    `horizontal overflow ${overflow.overflowPx}px (scrollWidth=${overflow.scrollWidth}, innerWidth=${overflow.clientWidth})`,
  ).toBeLessThanOrEqual(1);
}

async function capture(page: Page, name: string, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(40);
  await assertNoHorizontalOverflow(page);
  const file = resolve(shotsDir, `${name}-w${width}.png`);
  await page.screenshot({ path: file, fullPage: true });
  return file;
}

test.beforeAll(() => {
  mkdirSync(shotsDir, { recursive: true });
  expect(existsSync(resolve(extensionRoot, 'dist-webapp/index.html'))).toBe(true);
});

test.describe('Astrym landing responsive', () => {
  test('landing has no horizontal overflow across breakpoints', async ({ page }) => {
    await page.goto('./index.html');
    for (const width of WIDTHS) {
      await capture(page, 'landing', width, Math.max(720, Math.round(width * 1.8)));
    }
    await page.setViewportSize(LANDSCAPE);
    await page.waitForTimeout(40);
    await assertNoHorizontalOverflow(page);
    await page.screenshot({
      path: resolve(shotsDir, `landing-landscape-${LANDSCAPE.width}x${LANDSCAPE.height}.png`),
      fullPage: true,
    });
  });
});

test.describe('Astrym webapp shell screens', () => {
  for (const screenId of SCREEN_IDS) {
    test(`${screenId} adapts without horizontal overflow`, async ({ page }) => {
      await page.setContent(buildScreenDocument(walletCss, screenId as ScreenId), {
        waitUntil: 'domcontentloaded',
      });
      for (const width of WIDTHS) {
        await capture(page, screenId, width, Math.max(640, Math.round(width * 1.6)));
      }
      await page.setViewportSize(LANDSCAPE);
      await page.waitForTimeout(40);
      await assertNoHorizontalOverflow(page);
      await page.screenshot({
        path: resolve(shotsDir, `${screenId}-landscape-${LANDSCAPE.width}x${LANDSCAPE.height}.png`),
        fullPage: true,
      });
    });
  }
});

test.describe('popup shell still fixed', () => {
  test('popup body remains 400×600 without astrym-webapp class', async ({ page }) => {
    const popupHtml = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8" /><style>${walletCss}</style></head>
<body><div id="root"><div class="view-container"><h2>Popup</h2><button class="btn-primary">OK</button></div></div></body></html>`;
    await page.setContent(popupHtml);
    const box = await page.evaluate(() => {
      const body = document.body.getBoundingClientRect();
      return { width: Math.round(body.width), height: Math.round(body.height) };
    });
    expect(box.width).toBe(400);
    expect(box.height).toBe(600);
  });
});

test('build contact sheet artifact', async ({ page }) => {
  const pngs = readdirSync(shotsDir)
    .filter((f) => f.endsWith('.png') && !f.includes('contact-sheet'))
    .sort();
  expect(pngs.length).toBeGreaterThan(20);

  const cells = pngs
    .map((f) => {
      const buf = readFileSync(resolve(shotsDir, f));
      const b64 = buf.toString('base64');
      return `<figure style="margin:0;border:1px solid #2a323c;background:#141416;padding:8px">
        <figcaption style="font:11px monospace;color:#D0D5DD;margin-bottom:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${f}</figcaption>
        <img src="data:image/png;base64,${b64}" style="width:100%;height:auto;display:block;background:#191A1C" />
      </figure>`;
    })
    .join('\n');

  await page.setViewportSize({ width: 1800, height: 1200 });
  await page.setContent(`<!DOCTYPE html><html><head><meta charset="UTF-8" />
    <title>Astrym responsive contact sheet</title>
    <style>
      body{margin:0;padding:16px;background:#191A1C;color:#fff;font-family:sans-serif}
      h1{font-size:20px;color:#3CE894;margin:0 0 16px}
      .grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
    </style></head>
    <body><h1>Astrym responsive audit contact sheet</h1><div class="grid">${cells}</div></body></html>`, {
    waitUntil: 'domcontentloaded',
  });

  const contactPath = resolve(artifactsRoot, 'astrym-responsive-contact-sheet.png');
  await page.screenshot({ path: contactPath, fullPage: true });
  writeFileSync(
    resolve(artifactsRoot, 'manifest.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        widths: [...WIDTHS],
        landscape: LANDSCAPE,
        screens: ['landing', ...SCREEN_IDS],
        screenshotCount: pngs.length,
        contactSheet: contactPath,
      },
      null,
      2,
    ),
  );
  expect(existsSync(contactPath)).toBe(true);
});
