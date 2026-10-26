#!/usr/bin/env node
/**
 * Authorized Nym MixFetch live-smoke via CDP (no vault / no Stellar traffic).
 *
 * Prerequisites: `pnpm build:nym-live-smoke` already ran (auth flag in dist).
 *
 * Disposable Chrome only. Elevates the exact verified gateway host pattern into
 * host_permissions in a TEMP copy of dist so WSS can open without a UI gesture.
 * Does not modify packages/extension/dist or source manifests.
 *
 * Usage:
 *   node scripts/nym-live-cdp-harness.mjs
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  cpSync,
  rmSync,
  readdirSync,
  statSync,
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
const CONNECT_TIMEOUT_MS = Number(process.env.NYM_LIVE_CDP_TIMEOUT_MS || 180_000);

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

async function pickFreePort(start = 9470, attempts = 40) {
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
    this.sessions = new Map();
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
    if (msg.id != null) {
      const key = `${msg.sessionId || ''}#${msg.id}`;
      const pending = this.pending.get(key) || this.pending.get(`#${msg.id}`);
      if (pending) {
        this.pending.delete(pending.key);
        if (msg.error) {
          pending.reject(
            Object.assign(new Error(msg.error.message || 'CDP error'), { cdp: msg.error }),
          );
        } else {
          pending.resolve(msg.result);
        }
      }
      return;
    }
    if (msg.method === 'Target.attachedToTarget') {
      const sid = msg.params?.sessionId;
      const info = msg.params?.targetInfo || {};
      if (sid) {
        this.sessions.set(sid, {
          targetId: info.targetId,
          type: info.type,
          url: info.url,
        });
        if (msg.params?.waitingForDebugger) {
          void this.send('Runtime.runIfWaitingForDebugger', {}, sid).catch(() => {});
        }
        void this.send('Runtime.enable', {}, sid).catch(() => {});
      }
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

function walkJsFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === 'nym-mixfetch' || name === 'spp') continue;
      walkJsFiles(p, out);
    } else if (name.endsWith('.js')) {
      out.push(p);
    }
  }
  return out;
}

function verifyLiveAuthInDist(dist) {
  const files = walkJsFiles(dist);
  let authorizedTrue = false;
  let authorizedFalse = false;
  let hasLiveSmokeStep = false;
  let hasUnauthorizedMessage = false;
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    if (text.includes('live-smoke-authorized')) hasLiveSmokeStep = true;
    if (text.includes('NYM_LIVE_SMOKE_EXECUTION_AUTHORIZED=false')) {
      hasUnauthorizedMessage = true;
    }
    if (
      /NYM_LIVE_SMOKE_EXECUTION_AUTHORIZED\s*=\s*!0/.test(text) ||
      /NYM_LIVE_SMOKE_EXECUTION_AUTHORIZED\s*=\s*true\b/.test(text)
    ) {
      authorizedTrue = true;
    }
    if (
      /NYM_LIVE_SMOKE_EXECUTION_AUTHORIZED\s*=\s*!1/.test(text) ||
      /NYM_LIVE_SMOKE_EXECUTION_AUTHORIZED\s*=\s*false\b/.test(text)
    ) {
      authorizedFalse = true;
    }
  }
  // Vite DCE: when authorized, the unauthorized throw string is removed and
  // the live-smoke-authorized step string remains.
  if (hasLiveSmokeStep && !hasUnauthorizedMessage) authorizedTrue = true;
  if (hasUnauthorizedMessage && !hasLiveSmokeStep) authorizedFalse = true;
  return {
    authorizedTrue,
    authorizedFalse,
    hasLiveSmokeStep,
    hasUnauthorizedMessage,
    scanned: files.length,
  };
}

function prepareTempDist(runId) {
  const tempDist = path.join(tmpdir(), `solanym-nym-live-dist-${runId}`);
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

async function main() {
  if (!existsSync(path.join(SOURCE_DIST, 'manifest.json'))) {
    throw new Error(`Missing dist — run build:nym-live-smoke first (${SOURCE_DIST})`);
  }
  if (!existsSync(path.join(SOURCE_DIST, 'nym-mixfetch', 'index.js'))) {
    throw new Error('Missing nym-mixfetch assets in dist');
  }

  const runId = stamp();
  const authCheck = verifyLiveAuthInDist(SOURCE_DIST);
  console.log('AUTH_CHECK', JSON.stringify(authCheck));
  if (authCheck.authorizedFalse && !authCheck.authorizedTrue) {
    throw new Error(
      'dist is not live-smoke authorized. Run: pnpm --filter @solanym/extension build:nym-live-smoke',
    );
  }

  const tempDist = prepareTempDist(runId);
  console.log('TEMP_DIST', tempDist);

  const logPath = path.join(tmpdir(), `solanym-nym-live-${runId}.ndjson`);
  const logFd = openSync(logPath, 'w');
  const log = (obj) => {
    writeSync(logFd, JSON.stringify({ t: new Date().toISOString(), ...obj }) + '\n');
  };

  let chromeChild = null;
  let labProfile = null;
  let cdp = null;
  const report = {
    ok: false,
    createMixFetchSucceeded: false,
    executedCreateMixFetch: false,
    diagnosticCode: null,
    lastError: null,
    steps: [],
    logPath,
  };

  try {
    if (!existsSync(DEFAULT_CHROME)) throw new Error(`Chrome not found: ${DEFAULT_CHROME}`);
    const port = await pickFreePort(9470);
    labProfile = path.join(tmpdir(), `solanym-nym-live-lab-${runId}`);
    mkdirSync(labProfile, { recursive: true });
    console.log('CDP_PORT', port);
    console.log('LAB_PROFILE', labProfile);

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
    console.log('EXTENSION_ID', extensionId);
    log({ kind: 'extension-loaded', extensionId });
    report.extensionId = extensionId;

    await new Promise((r) => setTimeout(r, 800));
    const sw = await findServiceWorkerSession(cdp, extensionId);
    console.log('SW', sw.url);
    log({ kind: 'sw-attached', ...sw });

    const seedExpr = `(() => new Promise((resolve, reject) => {
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
    }))()`;
    const seed = await cdp.send(
      'Runtime.evaluate',
      { expression: seedExpr, awaitPromise: true, returnByValue: true },
      sw.sessionId,
      30_000,
    );
    if (seed.exceptionDetails) {
      throw new Error('seed storage failed: ' + JSON.stringify(seed.exceptionDetails));
    }
    console.log('GATEWAY_SEEDED', seed.result?.value?.selectedGateway);
    log({ kind: 'gateway-seeded', value: seed.result?.value });

    const permExpr = `(() => new Promise((resolve, reject) => {
      chrome.permissions.contains({ origins: [${JSON.stringify(GATEWAY_HOST_PATTERN)}] }, (granted) => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message));
        else resolve({ granted: !!granted, pattern: ${JSON.stringify(GATEWAY_HOST_PATTERN)} });
      });
    }))()`;
    const perm = await cdp.send(
      'Runtime.evaluate',
      { expression: permExpr, awaitPromise: true, returnByValue: true },
      sw.sessionId,
      15_000,
    );
    if (perm.exceptionDetails) {
      throw new Error('permission contains failed: ' + JSON.stringify(perm.exceptionDetails));
    }
    console.log('PERMISSION_CONTAINS', JSON.stringify(perm.result?.value));
    log({ kind: 'permission-contains', value: perm.result?.value });
    if (!perm.result?.value?.granted) {
      throw new Error(
        `chrome.permissions.contains=false for ${GATEWAY_HOST_PATTERN}`,
      );
    }

    // SW cannot chrome.runtime.sendMessage to itself — call nymRuntime directly
    // (exposed on globalThis for this harness; mirrors NYM_LIVE_SMOKE connect→disconnect).
    const smokeExpr = `(async () => {
      const ctrl = globalThis.nymRuntime;
      if (!ctrl || typeof ctrl.connect !== 'function') {
        throw new Error('globalThis.nymRuntime missing — background did not expose controller');
      }
      const steps = ['harness-direct-connect'];
      let snap;
      try {
        snap = await ctrl.connect({ preferredGateway: ${JSON.stringify(GATEWAY_IDENTITY)} });
        steps.push('createMixFetch-connect');
        if (!snap || !snap.connected) {
          throw new Error(snap?.lastError || 'createMixFetch did not report connected');
        }
        steps.push('createMixFetch-connected');
        const after = await ctrl.disconnect();
        steps.push('disconnect');
        return {
          executedCreateMixFetch: true,
          connectedAfterConnect: true,
          finalConnected: Boolean(after?.connected),
          diagnosticCode: after?.diagnosticCode ?? snap?.diagnosticCode ?? null,
          lastError: after?.lastError ?? null,
          assetsReady: snap?.assetsReady === true,
          hostPermissionGranted: snap?.gatewayHostPermissionGranted === true,
          stateAfterConnect: snap?.state ?? null,
          implementation: snap?.implementation ?? null,
          steps,
        };
      } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        const code = e && e.code ? e.code : null;
        let status = null;
        try { status = ctrl.getSnapshot ? ctrl.getSnapshot() : null; } catch (_) {}
        return {
          executedCreateMixFetch: steps.includes('createMixFetch-connect'),
          connectedAfterConnect: false,
          finalConnected: false,
          diagnosticCode: code || status?.diagnosticCode || 'CONNECT_FAILED',
          lastError: msg,
          assetsReady: status?.assetsReady === true,
          hostPermissionGranted: status?.gatewayHostPermissionGranted,
          stateAfterConnect: status?.state ?? null,
          steps: [...steps, 'createMixFetch-failed'],
          error: true,
        };
      }
    })()`;

    console.log('CREATE_MIXFETCH_START', `timeoutMs=${CONNECT_TIMEOUT_MS}`);
    log({ kind: 'createMixFetch-start', timeoutMs: CONNECT_TIMEOUT_MS });
    const smoke = await cdp.send(
      'Runtime.evaluate',
      { expression: smokeExpr, awaitPromise: true, returnByValue: true },
      sw.sessionId,
      CONNECT_TIMEOUT_MS,
    );
    if (smoke.exceptionDetails) {
      const desc =
        smoke.exceptionDetails.exception?.description ||
        smoke.exceptionDetails.text ||
        JSON.stringify(smoke.exceptionDetails);
      report.lastError = desc;
      log({ kind: 'createMixFetch-exception', error: desc });
      throw new Error('createMixFetch evaluate exception: ' + desc);
    }

    const payload = smoke.result?.value;
    log({ kind: 'live-smoke-response', payload });
    console.log('LIVE_SMOKE_RESPONSE', JSON.stringify(payload, null, 2));

    report.executedCreateMixFetch = Boolean(payload?.executedCreateMixFetch);
    report.steps = payload?.steps || [];
    report.diagnosticCode = payload?.diagnosticCode ?? null;
    report.lastError = payload?.lastError ?? null;
    report.createMixFetchSucceeded = Boolean(
      payload?.executedCreateMixFetch &&
        Array.isArray(payload?.steps) &&
        payload.steps.includes('createMixFetch-connected') &&
        !payload?.error,
    );
    report.finalConnected = Boolean(payload?.finalConnected);
    report.assetsReady = payload?.assetsReady;
    report.hostPermissionGranted = payload?.hostPermissionGranted;
    report.implementation = payload?.implementation;
    report.ok = report.createMixFetchSucceeded === true;

    if (!report.ok) {
      throw new Error(
        report.lastError ||
          `Live smoke did not confirm createMixFetch (steps=${JSON.stringify(report.steps)})`,
      );
    }

    console.log('CREATE_MIXFETCH_OK');
    console.log('STEPS', report.steps.join(' → '));
  } catch (e) {
    report.ok = false;
    report.lastError = report.lastError || String(e.message || e);
    console.error('NYM_LIVE_FAIL', report.lastError);
    log({ kind: 'fail', error: report.lastError });
  } finally {
    try {
      cdp?.close();
    } catch {
      /* ignore */
    }
    await killProcessTree(chromeChild);
    if (labProfile && String(labProfile).includes('solanym-nym-live-lab-')) {
      try {
        rmSync(labProfile, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
    if (tempDist && String(tempDist).includes('solanym-nym-live-dist-')) {
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
    const summaryPath = path.join(tmpdir(), `solanym-nym-live-${runId}-summary.json`);
    writeFileSync(summaryPath, JSON.stringify(report, null, 2));
    console.log('SUMMARY', summaryPath);
    console.log('LOG', logPath);
    console.log('REPORT', JSON.stringify(report, null, 2));
  }

  process.exit(report.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
