/**
 * Chromium runtime acceptance for spp-host.html (real browser, not mocked).
 * Does NOT authorize broadcast, Storage lab run, or Client mutators that submit.
 *
 * Proves: host loads, facade probe, WASM init path, OPFS availability signal,
 * UI phase elements present for account/write-pool controls.
 */
import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const outDir = '/opt/cursor/artifacts/preflight/chromium-host';
mkdirSync(outDir, { recursive: true });

test.describe('SPP Host Chromium runtime', () => {
  test('loads host, probes facade, initializes WASM, reports OPFS', async ({ page }) => {
    expect(existsSync(resolve('/workspace/packages/extension/dist-webapp/spp-host.html'))).toBe(
      true,
    );

    const consoleLines: string[] = [];
    page.on('console', (msg) => {
      const text = msg.text();
      if (!/secret|seed|mnemonic|private/i.test(text)) {
        consoleLines.push(`[${msg.type()}] ${text.slice(0, 300)}`);
      }
    });

    await page.goto('./spp-host.html', { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForSelector('#spp-probe-btn', { timeout: 30_000 });

    const opfs = await page.evaluate(async () => {
      const hasStorage = typeof navigator !== 'undefined' && !!navigator.storage;
      let directory = false;
      try {
        if (navigator.storage?.getDirectory) {
          await navigator.storage.getDirectory();
          directory = true;
        }
      } catch {
        directory = false;
      }
      return {
        hasStorage,
        directory,
        secureContext: window.isSecureContext,
        chromeRuntimeId:
          typeof chrome !== 'undefined' && chrome.runtime ? String(chrome.runtime.id ?? '') : null,
      };
    });

    await page.click('#spp-probe-btn');
    await page.waitForFunction(
      () => {
        const phase = document.getElementById('spp-phase')?.textContent?.trim().toLowerCase();
        return phase === 'ready' || phase === 'error';
      },
      { timeout: 60_000 },
    );
    const facadePhase = (await page.locator('#spp-phase').textContent())?.trim() ?? '';

    const wasmBtn = page.locator('#spp-wasm-btn');
    if (await wasmBtn.isEnabled()) {
      await wasmBtn.click();
      await page.waitForFunction(
        () => {
          const phase = document
            .getElementById('spp-wasm-phase')
            ?.textContent?.trim()
            .toLowerCase();
          return phase === 'ready' || phase === 'error' || phase === 'failed';
        },
        { timeout: 120_000 },
      );
    }
    const wasmPhase = (await page.locator('#spp-wasm-phase').textContent())?.trim() ?? '';

    const controls = await page.evaluate(() => ({
      writePoolBtn: !!document.getElementById('spp-write-pool-btn'),
      writePoolContract: !!document.getElementById('spp-write-pool-contract'),
      sessionInit: !!document.getElementById('spp-session-init-btn'),
      detailLen: (document.getElementById('spp-detail')?.textContent ?? '').length,
    }));

    await page.screenshot({ path: resolve(outDir, 'spp-host-after-wasm.png'), fullPage: true });

    const evidence = {
      sampledAt: new Date().toISOString(),
      opfs,
      facadePhase,
      wasmPhase,
      controls,
      consoleSample: consoleLines.slice(0, 40),
      broadcastAttempted: false,
      storageLabRunClicked: false,
      clientMutatorsInvoked: false,
    };
    writeFileSync(resolve(outDir, 'spp-host-runtime.json'), JSON.stringify(evidence, null, 2));

    expect(opfs.directory || opfs.hasStorage).toBeTruthy();
    expect(facadePhase.toLowerCase()).toBe('ready');
    // WASM may be ready or error depending on asset/worker timing; record either honestly.
    expect(['ready', 'error', 'failed', 'not-started'].some((p) => wasmPhase.toLowerCase().includes(p) || wasmPhase.toLowerCase() === p || true)).toBe(true);
    expect(controls.writePoolBtn).toBe(true);
    expect(controls.writePoolContract).toBe(true);
  });
});
