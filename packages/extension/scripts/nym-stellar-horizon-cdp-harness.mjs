#!/usr/bin/env node
/**
 * Real Stellar Horizon root GET via FailClosedTransportRouter → MixFetch.
 * No Friendbot, no signing, no vault.
 *
 * Usage: node scripts/nym-stellar-horizon-cdp-harness.mjs
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  cpSync,
  rmSync,
  openSync,
  writeSync,
  closeSync,
} from 'node:fs';
import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_ROOT = path.resolve(__dirname, '..');
const SOURCE_DIST = path.join(EXTENSION_ROOT, 'dist');
const DEFAULT_CHROME =
  process.env.CHROME_PATH ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const GATEWAY_WSS = 'wss://nym-node-cli.devrel.nymte.ch:9001';
const GATEWAY_IDENTITY = 'q2A2cbooyC16YJzvdYaSMH9X3cSiieZNtfBr8cE8Fi1';
const GATEWAY_HOST_PATTERN = 'https://nym-node-cli.devrel.nymte.ch:9001/*';
const STORAGE_KEY = 'solanym_nym_gateway_config_v1';
const CONNECT_TIMEOUT_MS = Number(process.env.NYM_CONNECT_TIMEOUT_MS || 180_000);
const PROBE_TIMEOUT_MS = Number(process.env.NYM_STELLAR_PROBE_TIMEOUT_MS || 180_000);

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return (
    d.getFullYear() +
    p(d.getMonth() + 1) +
    p(d.getDate()) +
    p(d.getHours()) +
    p(d.getMinutes()) +
    p(d.getSeconds())
  );
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = createConnection({ host: '127.0.0.1', port }, () => {
      srv.end();
      resolve(false);
    });
    srv.on('error', () => resolve(true));
  });
}

async function pickFreePort(start = 9500, attempts = 40) {
  for (let i = 0; i < attempts; i++) {
    const port = start + i;
    if (await isPortFree(port)) return port;
  }
  throw new Error('No free CDP port');
}

async function waitForCdp(port, timeoutMs) {
  const start = Date.now();
  let lastErr;
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return await res.json();
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`CDP not ready: ${lastErr?.message || lastErr}`);
}

async function killProcessTree(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      const proc = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      proc.on('exit', () => resolve());
      proc.on('error', () => resolve());
      setTimeout(resolve, 8000);
    });
    return;
  }
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      /* ignore */
    }
  }
}

class SimpleCdp {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.nextId = 0;
    this.pending = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('WS connect timeout')), 15000);
      this.ws.addEventListener('open', () => {
        clearTimeout(t);
        resolve();
      });
      this.ws.addEventListener('error', (e) => {
        clearTimeout(t);
        reject(e.error || new Error('WS error'));
      });
    });
    this.ws.addEventListener('message', (ev) => this.onMessage(String(ev.data)));
  }

  onMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.id == null) {
      if (msg.method === 'Target.attachedToTarget') {
        const sid = msg.params?.sessionId;
        if (sid && msg.params?.waitingForDebugger) {
          void this.send('Runtime.runIfWaitingForDebugger', {}, sid).catch(() => {});
        }
        if (sid) void this.send('Runtime.enable', {}, sid).catch(() => {});
      }
      return;
    }
    const key = `${msg.sessionId || ''}#${msg.id}`;
    const pending = this.pending.get(key) || this.pending.get(`#${msg.id}`);
    if (!pending) return;
    this.pending.delete(pending.key);
    if (msg.error) {
      pending.reject(
        Object.assign(new Error(msg.error.message || 'CDP error'), { cdp: msg.error }),
      );
    } else pending.resolve(msg.result);
  }

  send(method, params = {}, sessionId = null, timeoutMs = 30_000) {
    const id = ++this.nextId;
    const key = `${sessionId || ''}#${id}`;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(key);
        reject(new Error(`CDP timeout ${method}`));
      }, timeoutMs);
      this.pending.set(key, {
        key,
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.ws.send(JSON.stringify(payload));
    });
  }

  close() {
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
  }
}

function prepareTempDist(runId) {
  const tempDist = path.join(tmpdir(), `solanym-nym-stellar-dist-${runId}`);
  if (existsSync(tempDist)) rmSync(tempDist, { recursive: true, force: true });
  cpSync(SOURCE_DIST, tempDist, { recursive: true });
  const manifestPath = path.join(tempDist, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const hosts = new Set(manifest.host_permissions || []);
  hosts.add(GATEWAY_HOST_PATTERN);
  manifest.host_permissions = [...hosts];
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return tempDist;
}

async function findServiceWorkerSession(cdp, extensionId, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const targets = await cdp.send('Target.getTargets');
    for (const info of targets.targetInfos || []) {
      const url = info.url || '';
      if (
        info.type === 'service_worker' &&
        url.includes(`chrome-extension://${extensionId}/`)
      ) {
        const attached = await cdp.send('Target.attachToTarget', {
          targetId: info.targetId,
          flatten: true,
        });
        const sid = attached.sessionId;
        await cdp.send('Runtime.enable', {}, sid);
        return { sessionId: sid, url };
      }
    }
    await cdp
      .send('Target.createTarget', {
        url: `chrome-extension://${extensionId}/popup.html`,
      })
      .catch(() => null);
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error('Service worker session not found');
}

async function evalJson(cdp, sessionId, expression, timeoutMs) {
  const r = await cdp.send(
    'Runtime.evaluate',
    { expression, awaitPromise: true, returnByValue: true },
    sessionId,
    timeoutMs,
  );
  if (r.exceptionDetails) {
    throw new Error(
      r.exceptionDetails.exception?.description ||
        r.exceptionDetails.text ||
        JSON.stringify(r.exceptionDetails),
    );
  }
  return r.result?.value;
}

async function main() {
  if (!existsSync(path.join(SOURCE_DIST, 'background.js'))) {
    throw new Error('Missing dist — run build:nym-dev first');
  }

  const runId = stamp();
  const tempDist = prepareTempDist(runId);
  const logPath = path.join(tmpdir(), `solanym-nym-stellar-${runId}.ndjson`);
  const logFd = openSync(logPath, 'w');
  const log = (obj) => {
    writeSync(logFd, JSON.stringify({ t: new Date().toISOString(), ...obj }) + '\n');
  };

  let chromeChild = null;
  let labProfile = null;
  let cdp = null;
  const report = { ok: false, phase: 'init', logPath, utcNow: new Date().toISOString() };

  try {
    const port = await pickFreePort(9500);
    labProfile = path.join(tmpdir(), `solanym-nym-stellar-lab-${runId}`);
    mkdirSync(labProfile, { recursive: true });
    console.log('UTC_NOW', report.utcNow);
    console.log('CDP_PORT', port);

    chromeChild = spawn(
      DEFAULT_CHROME,
      [
        `--user-data-dir=${labProfile}`,
        `--remote-debugging-port=${port}`,
        '--remote-allow-origins=*',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-sync',
        '--enable-unsafe-extension-debugging',
        'about:blank',
      ],
      { stdio: 'ignore', windowsHide: false },
    );

    const version = await waitForCdp(port, 30000);
    console.log('CDP_BROWSER', version.Browser);
    cdp = new SimpleCdp(version.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send('Target.setDiscoverTargets', { discover: true });
    await cdp.send('Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true,
    });

    const loaded = await cdp.send('Extensions.loadUnpacked', { path: tempDist });
    const extensionId = loaded?.id;
    if (!extensionId) throw new Error('loadUnpacked failed');
    report.extensionId = extensionId;
    console.log('EXTENSION_ID', extensionId);

    await new Promise((r) => setTimeout(r, 1500));
    let sw = await findServiceWorkerSession(cdp, extensionId, 40_000);
    console.log('SW', sw.url);

    // Confirm SW world has chrome APIs (retry attach if race with popup target).
    for (let attempt = 0; attempt < 8; attempt++) {
      const chromeOk = await evalJson(
        cdp,
        sw.sessionId,
        `typeof chrome !== 'undefined' && !!chrome.storage && !!chrome.runtime`,
        10_000,
      ).catch(() => false);
      if (chromeOk) break;
      await new Promise((r) => setTimeout(r, 500));
      sw = await findServiceWorkerSession(cdp, extensionId, 20_000);
      console.log('SW_RETRY', attempt + 1, sw.url);
      if (attempt === 7) throw new Error('Service worker session lacks chrome.* APIs');
    }

    await evalJson(
      cdp,
      sw.sessionId,
      `(() => new Promise((resolve, reject) => {
        const cfg = {
          gatewayOrigins: [${JSON.stringify(GATEWAY_WSS)}],
          selectedGateway: ${JSON.stringify(GATEWAY_WSS)},
          identityKey: ${JSON.stringify(GATEWAY_IDENTITY)},
          updatedAt: new Date().toISOString(),
        };
        chrome.storage.local.set({ ${JSON.stringify(STORAGE_KEY)}: cfg }, () => {
          const err = chrome.runtime.lastError;
          if (err) reject(new Error(err.message));
          else resolve(cfg);
        });
      }))()`,
      30_000,
    );

    report.phase = 'connect';
    const connectResult = await evalJson(
      cdp,
      sw.sessionId,
      `(async () => {
        const ctrl = globalThis.nymRuntime;
        if (!ctrl) throw new Error('nymRuntime missing');
        try {
          const snap = await ctrl.connect({ preferredGateway: ${JSON.stringify(GATEWAY_IDENTITY)} });
          return {
            ok: !!snap?.connected,
            mode: ctrl.mode,
            diagnosticCode: snap?.diagnosticCode,
            lastError: snap?.lastError,
          };
        } catch (e) {
          return { ok: false, lastError: e && e.message ? e.message : String(e) };
        }
      })()`,
      CONNECT_TIMEOUT_MS,
    );
    console.log('CONNECT', JSON.stringify(connectResult));
    report.connect = connectResult;
    if (!connectResult?.ok) throw new Error(connectResult?.lastError || 'connect failed');

    report.phase = 'horizon-probe';
    // Logical SDF fee_stats — adapter remaps to validated effective MixFetch Horizon.
    const LOGICAL_FEE_STATS = 'https://horizon-testnet.stellar.org/fee_stats';
    const probe = await evalJson(
      cdp,
      sw.sessionId,
      `(async () => {
        const ctrl = globalThis.nymRuntime;
        if (!ctrl || typeof ctrl.probeStellarHorizon !== 'function') {
          throw new Error('probeStellarHorizon missing');
        }
        if (typeof ctrl.getStellarFetch !== 'function') {
          throw new Error('getStellarFetch missing — Stellar adapter not wired');
        }
        const cfg = typeof ctrl.getStellarNymHorizonConfig === 'function'
          ? ctrl.getStellarNymHorizonConfig()
          : null;
        const result = await ctrl.probeStellarHorizon({
          transport: 'nym',
          timeoutMs: ${PROBE_TIMEOUT_MS},
          horizonUrl: ${JSON.stringify(LOGICAL_FEE_STATS)},
        });
        return { result, cfg };
      })()`,
      PROBE_TIMEOUT_MS + 45_000,
    );
    const probeResult = probe?.result ?? probe;
    console.log('HORIZON_PROBE', JSON.stringify(probeResult, null, 2));
    console.log('HORIZON_NYM_CONFIG', JSON.stringify(probe?.cfg ?? null, null, 2));
    log({ kind: 'horizon-probe', probe: probeResult, cfg: probe?.cfg });
    report.horizonProbe = probeResult;
    report.stellarNymHorizonConfig = probe?.cfg ?? null;
    report.ok =
      probeResult?.state === 'success' &&
      probeResult?.transport === 'nym' &&
      probeResult?.httpStatus === 200 &&
      probeResult?.transportFetchInvoked === true &&
      probeResult?.logicalUrl === LOGICAL_FEE_STATS &&
      typeof probeResult?.effectiveUrl === 'string' &&
      probeResult.effectiveUrl.includes('rpc.ankr.com') &&
      probeResult?.urlRewritten === true &&
      typeof probeResult?.lastLedger === 'string' &&
      probeResult.lastLedger.length > 0;

    if (!report.ok) throw new Error(probeResult?.message || `state=${probeResult?.state}`);
    report.phase = 'done';
    console.log('STELLAR_HORIZON_NYM_OK');
    console.log(
      'LOGICAL_VS_EFFECTIVE',
      probeResult.logicalUrl,
      '→',
      probeResult.effectiveUrl,
    );
  } catch (e) {
    report.ok = false;
    report.lastError = String(e.message || e);
    console.error('STELLAR_HORIZON_NYM_FAIL', report.lastError);
    log({ kind: 'fail', error: report.lastError });
  } finally {
    try {
      cdp?.close();
    } catch {
      /* ignore */
    }
    await killProcessTree(chromeChild);
    if (labProfile?.includes('solanym-nym-stellar-lab-')) {
      try {
        rmSync(labProfile, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
    if (tempDist?.includes('solanym-nym-stellar-dist-')) {
      try {
        rmSync(tempDist, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
    try {
      closeSync(logFd);
    } catch {
      /* ignore */
    }
    const summaryPath = path.join(tmpdir(), `solanym-nym-stellar-${runId}-summary.json`);
    writeFileSync(summaryPath, JSON.stringify(report, null, 2));
    console.log('SUMMARY', summaryPath);
    console.log('REPORT', JSON.stringify(report, null, 2));
  }

  process.exit(report.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
