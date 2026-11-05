#!/usr/bin/env node
/**
 * Chromium-host revalidation of frozen registration XDRs against live Soroban RPC.
 * Uses rebuilt packages/extension/dist/spp (KeyOwnership-capable runtime).
 * Does NOT broadcast. Does NOT re-prove (fingerprints must stay unchanged).
 */
import { createServer } from 'node:http';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { dirname, join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXTENSION_ROOT = resolve(__dirname, '..');
const require = createRequire(join(EXTENSION_ROOT, 'package.json'));
const { chromium } = require('@playwright/test');

const SPP_ROOT = join(EXTENSION_ROOT, 'dist', 'spp');
const PACKET_PATH =
  process.env.SPP_REGISTER_PACKET ||
  '/opt/cursor/artifacts/registration/registration-approval-packet.json';
const OUT_PATH =
  process.env.SPP_COMPAT_OUT ||
  '/opt/cursor/artifacts/registration/compat/chromium-host-resimulate.json';
const RPC_URL = process.env.SPP_RPC_URL || 'https://soroban-testnet.stellar.org';
const CHROME_PATH =
  process.env.CHROME_PATH ||
  '/home/ubuntu/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome';
const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
const REGISTRY = 'CARXHKOPSGMUMFRDI72KNCRENVOTCJIGXPCPYOW42APDY2NEYF7CLKIL';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.bin': 'application/octet-stream',
  '.r1cs': 'application/octet-stream',
};

function fail(msg) {
  console.error(`[compat-resim] FAIL: ${msg}`);
  process.exit(1);
}

function fingerprintXdr(xdrB64) {
  return createHash('sha256').update(Buffer.from(String(xdrB64), 'base64')).digest('hex');
}

function writeHarnessHtml(root) {
  writeFileSync(
    join(root, 'index.html'),
    `<!doctype html><html><body><pre id="out">boot</pre>
<script type="module">
window.__COMPAT__={ready:false};
document.getElementById('out').textContent='ready';
window.__COMPAT__.ready=true;
</script></body></html>`,
  );
}

function startServer(harnessRoot, sppRoot) {
  return new Promise((resolveServer) => {
    const server = createServer((req, res) => {
      try {
        const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
        let full;
        if (urlPath === '/' || urlPath === '/index.html') {
          full = join(harnessRoot, 'index.html');
        } else {
          full = join(sppRoot, urlPath.replace(/^\//, ''));
          if (!full.startsWith(sppRoot)) {
            res.writeHead(403);
            res.end('forbidden');
            return;
          }
        }
        if (!existsSync(full) || !statSync(full).isFile()) {
          res.writeHead(404);
          res.end('not found');
          return;
        }
        const headers = {
          'Content-Type': MIME[extname(full)] || 'application/octet-stream',
          'Cache-Control': 'no-store',
        };
        res.writeHead(200, headers);
        createReadStream(full).pipe(res);
      } catch (e) {
        res.writeHead(500);
        res.end(String(e));
      }
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolveServer({ server, origin: `http://127.0.0.1:${addr.port}` });
    });
  });
}

async function main() {
  if (!existsSync(join(SPP_ROOT, 'js', 'index.js'))) fail(`Missing runtime SPP at ${SPP_ROOT}`);
  if (!existsSync(CHROME_PATH)) fail(`Missing Chromium at ${CHROME_PATH}`);
  const packet = JSON.parse(readFileSync(PACKET_PATH, 'utf8'));
  const circuitLock = JSON.parse(
    readFileSync(join(SPP_ROOT, 'dist', 'circuits', 'circuits.json'), 'utf8'),
  );
  if (!circuitLock.keyOwnership) fail('runtime circuits.json missing keyOwnership');
  if (String(circuitLock.version) !== '0.7') fail(`expected circuits 0.7, got ${circuitLock.version}`);

  const runNonce = randomBytes(8).toString('hex');
  const serveRoot = join(tmpdir(), `spp-compat-${runNonce}`);
  mkdirSync(serveRoot, { recursive: true });
  writeHarnessHtml(serveRoot);
  const { server, origin } = await startServer(serveRoot, SPP_ROOT);

  const userDataDir = join(tmpdir(), `spp-compat-chrome-${runNonce}`);
  mkdirSync(userDataDir, { recursive: true });

  let context;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      executablePath: CHROME_PATH,
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    const page = context.pages()[0] || (await context.newPage());
    await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__COMPAT__?.ready === true);

    const pageResult = await page.evaluate(
      async (input) => {
        const out = {
          wasmOk: false,
          circuitLockVersion: null,
          keyOwnershipPresent: false,
          rpcUrlReached: [],
          ops: [],
          errors: [],
        };
        try {
          const spp = await import(new URL('./js/index.js', location.href).href);
          await spp.default();
          out.wasmOk = true;
          const lockResp = await fetch(new URL('./dist/circuits/circuits.json', location.href));
          const lock = await lockResp.json();
          out.circuitLockVersion = lock.version;
          out.keyOwnershipPresent = Boolean(lock.keyOwnership);

          // Live ledger probe
          const ledgerProbe = await fetch(input.rpcUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: `ledger-${input.runNonce}`,
              method: 'getLatestLedger',
              params: null,
            }),
          }).then((r) => r.json());
          out.latestLedgerBefore = ledgerProbe?.result?.sequence ?? null;

          for (const op of input.operations) {
            const reqId = `sim-${input.runNonce}-${op.role}-${Date.now()}`;
            const body = {
              jsonrpc: '2.0',
              id: reqId,
              method: 'simulateTransaction',
              params: { transaction: op.xdr },
            };
            const started = Date.now();
            const resp = await fetch(input.rpcUrl, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body),
            });
            const json = await resp.json();
            const elapsedMs = Date.now() - started;
            out.rpcUrlReached.push(input.rpcUrl);
            const result = json.result || null;
            const error = json.error ? JSON.stringify(json.error).slice(0, 400) : result?.error || null;
            out.ops.push({
              role: op.role,
              sourceAddress: op.sourceAddress,
              requestId: reqId,
              expectedFingerprint: op.transactionFingerprint,
              elapsedMs,
              httpStatus: resp.status,
              minResourceFee: result?.minResourceFee ?? result?.min_resource_fee ?? null,
              latestLedger: result?.latestLedger ?? result?.latest_ledger ?? null,
              hasError: Boolean(error),
              error: error ? String(error).slice(0, 600) : null,
              success: Boolean(result) && !error && !json.error,
              // Never sendTransaction
              sendTransactionCalled: false,
            });
          }

          const ledgerAfter = await fetch(input.rpcUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: `ledger-after-${input.runNonce}`,
              method: 'getLatestLedger',
              params: null,
            }),
          }).then((r) => r.json());
          out.latestLedgerAfter = ledgerAfter?.result?.sequence ?? null;
        } catch (e) {
          out.errors.push(String(e?.message || e).slice(0, 800));
        }
        return out;
      },
      {
        rpcUrl: RPC_URL,
        runNonce,
        operations: packet.operations.map((op) => ({
          role: op.role,
          sourceAddress: op.sourceAddress,
          transactionFingerprint: op.transactionFingerprint,
          xdr: op.unsignedOrPreparedTxXdr,
        })),
      },
    );

    const ops = (pageResult.ops || []).map((o) => {
      const packetOp = packet.operations.find((p) => p.role === o.role);
      const fp = fingerprintXdr(packetOp.unsignedOrPreparedTxXdr);
      return {
        ...o,
        fingerprintRecomputed: fp,
        fingerprintUnchanged: fp === o.expectedFingerprint,
        feeMatchesPrior:
          String(o.minResourceFee) === String(packetOp.simulationHonesty?.minResourceFee),
        destinationRegistry: REGISTRY,
        networkPassphrase: NETWORK_PASSPHRASE,
      };
    });

    const report = {
      sampledAt: new Date().toISOString(),
      harness: 'spp-register-compat-resimulate.mjs',
      runNonce,
      sppRoot: SPP_ROOT,
      packetPath: PACKET_PATH,
      rpcUrl: RPC_URL,
      broadcastAttempted: false,
      sendTransactionCalled: false,
      chromiumHost: true,
      circuitLock: {
        version: pageResult.circuitLockVersion,
        keyOwnershipPresent: pageResult.keyOwnershipPresent,
        metaCommit: circuitLock.meta?.commit ?? null,
      },
      wasmOk: pageResult.wasmOk === true,
      latestLedgerBefore: pageResult.latestLedgerBefore,
      latestLedgerAfter: pageResult.latestLedgerAfter,
      ops,
      bothSimSuccess: ops.length === 2 && ops.every((o) => o.success === true),
      bothFingerprintsUnchanged: ops.every((o) => o.fingerprintUnchanged === true),
      bothFeesMatchPriorSuccessfulSim: ops.every((o) => o.feeMatchesPrior === true),
      errors: pageResult.errors || [],
      mockOrCacheIndicators: {
        usedLocalMockServer: false,
        usedRecordedFixtureReplay: false,
        uniqueRequestIds: ops.map((o) => o.requestId),
        liveRpc: RPC_URL,
      },
    };

    mkdirSync(dirname(OUT_PATH), { recursive: true });
    writeFileSync(OUT_PATH, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({
      outPath: OUT_PATH,
      bothSimSuccess: report.bothSimSuccess,
      bothFingerprintsUnchanged: report.bothFingerprintsUnchanged,
      bothFeesMatchPriorSuccessfulSim: report.bothFeesMatchPriorSuccessfulSim,
      circuitLockVersion: report.circuitLock.version,
      keyOwnershipPresent: report.circuitLock.keyOwnershipPresent,
      ops: ops.map((o) => ({
        role: o.role,
        success: o.success,
        minResourceFee: o.minResourceFee,
        fingerprintUnchanged: o.fingerprintUnchanged,
        requestId: o.requestId,
        latestLedger: o.latestLedger,
      })),
    }, null, 2));

    if (!report.bothSimSuccess || !report.bothFingerprintsUnchanged) process.exitCode = 2;
  } finally {
    try {
      await context?.close();
    } catch {
      /* ignore */
    }
    try {
      server.close();
    } catch {
      /* ignore */
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
