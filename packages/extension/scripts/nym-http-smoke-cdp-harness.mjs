#!/usr/bin/env node
/**
 * Real MixFetch HTTP round-trip via CDP (nym-dev dist).
 *
 * Path under test:
 *   nymRuntime.runHttpSmoke → MixFetchNymTransport.fetch → OffscreenMixFetchBridge.mixFetch
 *   → offscreen performProtectedRequest → instance.mixFetch
 *
 * Never uses clearnet fetch for the probe. Temp elevates only the verified
 * gateway host pattern into host_permissions (same as live connect harness).
 *
 * Usage: node scripts/nym-http-smoke-cdp-harness.mjs
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
const ECHO_URL = process.env.NYM_HTTP_SMOKE_URL || 'https://postman-echo.com/post';
const CONNECT_TIMEOUT_MS = Number(process.env.NYM_CONNECT_TIMEOUT_MS || 180_000);
const HTTP_SMOKE_TIMEOUT_MS = Number(process.env.NYM_HTTP_SMOKE_TIMEOUT_MS || 120_000);

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

async function pickFreePort(start = 9480, attempts = 40) {
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
    } else {
      pending.resolve(msg.result);
    }
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
  const tempDist = path.join(tmpdir(), `solanym-nym-http-dist-${runId}`);
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
        return { sessionId: sid, targetId: info.targetId, url };
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
    const desc =
      r.exceptionDetails.exception?.description ||
      r.exceptionDetails.text ||
      JSON.stringify(r.exceptionDetails);
    throw new Error(desc);
  }
  return r.result?.value;
}

async function main() {
  if (!existsSync(path.join(SOURCE_DIST, 'manifest.json'))) {
    throw new Error('Missing dist — run build:nym-dev first');
  }
  if (!existsSync(path.join(SOURCE_DIST, 'nym-mixfetch', 'index.js'))) {
    throw new Error('Missing nym-mixfetch assets');
  }
  if (!existsSync(path.join(SOURCE_DIST, 'background.js'))) {
    throw new Error('Missing background.js');
  }
  const bg = readFileSync(path.join(SOURCE_DIST, 'background.js'), 'utf8');
  if (!bg.includes('postman-echo') && !bg.includes('runHttpSmoke') && !bg.includes('HttpSmoke')) {
    console.warn('WARN: background.js may lack HTTP smoke symbols (minified names vary)');
  }

  const runId = stamp();
  const tempDist = prepareTempDist(runId);
  const logPath = path.join(tmpdir(), `solanym-nym-http-${runId}.ndjson`);
  const logFd = openSync(logPath, 'w');
  const log = (obj) => {
    writeSync(logFd, JSON.stringify({ t: new Date().toISOString(), ...obj }) + '\n');
  };

  let chromeChild = null;
  let labProfile = null;
  let cdp = null;
  const report = {
    ok: false,
    phase: 'init',
    mixFetchConnected: false,
    httpSmoke: null,
    utcNow: new Date().toISOString(),
    echoUrl: ECHO_URL,
    logPath,
  };

  try {
    if (!existsSync(DEFAULT_CHROME)) throw new Error(`Chrome not found: ${DEFAULT_CHROME}`);
    const port = await pickFreePort(9480);
    labProfile = path.join(tmpdir(), `solanym-nym-http-lab-${runId}`);
    mkdirSync(labProfile, { recursive: true });
    console.log('UTC_NOW', report.utcNow);
    console.log('ECHO_URL', ECHO_URL);
    console.log('CDP_PORT', port);
    console.log('TEMP_DIST', tempDist);

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
    if (!extensionId) throw new Error('Extensions.loadUnpacked returned no id');
    report.extensionId = extensionId;
    console.log('EXTENSION_ID', extensionId);
    log({ kind: 'extension-loaded', extensionId });

    await new Promise((r) => setTimeout(r, 800));
    const sw = await findServiceWorkerSession(cdp, extensionId);
    console.log('SW', sw.url);

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

    const perm = await evalJson(
      cdp,
      sw.sessionId,
      `(() => new Promise((resolve, reject) => {
        chrome.permissions.contains({ origins: [${JSON.stringify(GATEWAY_HOST_PATTERN)}] }, (granted) => {
          const err = chrome.runtime.lastError;
          if (err) reject(new Error(err.message));
          else resolve({ granted: !!granted });
        });
      }))()`,
      15_000,
    );
    console.log('PERMISSION_CONTAINS', JSON.stringify(perm));
    if (!perm?.granted) throw new Error('Gateway host permission not granted in temp profile');

    report.phase = 'connect';
    console.log('MIXFETCH_CONNECT_START');
    const connectResult = await evalJson(
      cdp,
      sw.sessionId,
      `(async () => {
        const ctrl = globalThis.nymRuntime;
        if (!ctrl || typeof ctrl.connect !== 'function') {
          throw new Error('globalThis.nymRuntime missing');
        }
        try {
          const snap = await ctrl.connect({ preferredGateway: ${JSON.stringify(GATEWAY_IDENTITY)} });
          return {
            ok: Boolean(snap && snap.connected),
            state: snap?.state ?? null,
            connected: Boolean(snap?.connected),
            diagnosticCode: snap?.diagnosticCode ?? null,
            lastError: snap?.lastError ?? null,
            implementation: snap?.implementation ?? null,
          };
        } catch (e) {
          let status = null;
          try { status = ctrl.getSnapshot ? ctrl.getSnapshot() : null; } catch (_) {}
          return {
            ok: false,
            state: status?.state ?? 'error',
            connected: false,
            diagnosticCode: (e && e.code) || status?.diagnosticCode || 'CONNECT_FAILED',
            lastError: e && e.message ? e.message : String(e),
            implementation: status?.implementation ?? null,
          };
        }
      })()`,
      CONNECT_TIMEOUT_MS,
    );
    console.log('MIXFETCH_CONNECT_RESULT', JSON.stringify(connectResult, null, 2));
    log({ kind: 'connect', connectResult });
    report.connect = connectResult;
    report.mixFetchConnected = Boolean(connectResult?.ok && connectResult?.connected);

    if (!report.mixFetchConnected) {
      report.phase = 'connect-failed';
      throw new Error(
        connectResult?.lastError ||
          `MixFetch connect failed (${connectResult?.diagnosticCode})`,
      );
    }

    report.phase = 'http-smoke';
    console.log('HTTP_SMOKE_START', ECHO_URL);
    const smoke = await evalJson(
      cdp,
      sw.sessionId,
      `(async () => {
        const ctrl = globalThis.nymRuntime;
        if (!ctrl || typeof ctrl.runHttpSmoke !== 'function') {
          throw new Error('nymRuntime.runHttpSmoke missing');
        }
        const snap = ctrl.getSnapshot ? ctrl.getSnapshot() : null;
        if (!snap || !snap.connected) {
          return {
            state: 'error',
            message: 'Not connected before HTTP smoke',
            mixFetchInvoked: false,
            precheckConnected: false,
          };
        }
        const result = await ctrl.runHttpSmoke({
          url: ${JSON.stringify(ECHO_URL)},
          timeoutMs: ${HTTP_SMOKE_TIMEOUT_MS},
        });
        return { ...result, precheckConnected: true };
      })()`,
      HTTP_SMOKE_TIMEOUT_MS + 30_000,
    );
    console.log('HTTP_SMOKE_RESULT', JSON.stringify(smoke, null, 2));
    log({ kind: 'http-smoke', smoke });
    report.httpSmoke = smoke;
    report.ok = smoke?.state === 'success' && smoke?.probeMatched === true && smoke?.mixFetchInvoked === true;

    if (!report.ok) {
      report.phase = 'http-smoke-failed';
      throw new Error(smoke?.message || `HTTP smoke state=${smoke?.state}`);
    }

    report.phase = 'done';
    console.log('HTTP_SMOKE_OK');
  } catch (e) {
    report.ok = false;
    report.lastError = String(e.message || e);
    console.error('NYM_HTTP_REAL_FAIL', report.lastError);
    log({ kind: 'fail', error: report.lastError });
  } finally {
    try {
      cdp?.close();
    } catch {
      /* ignore */
    }
    await killProcessTree(chromeChild);
    if (labProfile && String(labProfile).includes('solanym-nym-http-lab-')) {
      try {
        rmSync(labProfile, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
    if (tempDist && String(tempDist).includes('solanym-nym-http-dist-')) {
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
    const summaryPath = path.join(tmpdir(), `solanym-nym-http-${runId}-summary.json`);
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
