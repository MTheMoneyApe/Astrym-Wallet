/**
 * Minimal same-origin static server for the SPP browser harness.
 * Serves packages/wallet-core so /node_modules/stellar-private-payments resolves.
 * Mounts synthetic mock RPC at POST /rpc (loopback only, no forwarding).
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMockRpcHttpHandler, getMockRpcLog, clearMockRpcLog } from './mock-rpc.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../../../..'); // packages/wallet-core
const PORT = Number(process.env.SPP_HARNESS_PORT || 8765);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.bin': 'application/octet-stream',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

function safeJoin(root, reqPath) {
  const decoded = decodeURIComponent(reqPath.split('?')[0]);
  const cleaned = path.normalize(decoded).replace(/^([/\\])+/, '');
  const full = path.resolve(root, cleaned);
  if (!full.startsWith(root)) return null;
  return full;
}

const mockHandler = createMockRpcHttpHandler();
const mockRo1Handler = createMockRpcHttpHandler({ mode: 'ro1' });

const server = http.createServer((req, res) => {
  const host = req.headers.host || '';
  // Refuse non-loopback Host headers as a belt-and-suspenders check.
  if (host && !/^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(host)) {
    res.writeHead(403);
    res.end('loopback only');
    return;
  }

  const reqUrl = new URL(req.url || '/', `http://${host || '127.0.0.1'}`);
  const urlPath = reqUrl.pathname || '/';
  const noWorkerCsp = reqUrl.searchParams.get('nocsp') === '1';

  if (urlPath === '/rpc' || urlPath === '/rpc/') {
    return mockHandler(req, res);
  }

  // Fase 2.27 — RO-1 allowlist: getLedgerEntries only
  if (urlPath === '/rpc-ro1' || urlPath === '/rpc-ro1/') {
    return mockRo1Handler(req, res);
  }

  if (urlPath === '/mock-rpc-log') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ synthetic: true, log: getMockRpcLog() }));
    return;
  }

  if (urlPath === '/mock-rpc-log/clear' && req.method === 'POST') {
    clearMockRpcLog();
    res.writeHead(204);
    res.end();
    return;
  }

  const pagePath = urlPath === '/' ? '/tests/stellar/spp/harness/browser/index.html' : urlPath;
  const filePath = safeJoin(ROOT, pagePath);
  if (!filePath) {
    res.writeHead(403);
    res.end('forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(err.code === 'ENOENT' ? 404 : 500);
      res.end(err.code === 'ENOENT' ? 'not found' : 'error');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const headers = {
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Resource-Policy': 'same-origin',
    };

    // Fase 2.31/2.32 — HTTP CSP.
    // Dedicated workers (http/https scripts) use CSP from *this response*, not the
    // creating document (HTML policy container / Chromium). blob:/data: still inherit.
    const docIsolationCsp =
      "default-src 'none'; base-uri 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; connect-src 'self'; worker-src 'self' blob:; img-src 'none'; font-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'";
    const workerConnectSelfCsp =
      "default-src 'none'; script-src 'self'; connect-src 'self'; worker-src 'self'; object-src 'none'";
    const sppWorkerCsp =
      "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; worker-src 'self'; object-src 'none'";

    // Fase 2.35 — MV3-aligned CSP twin (proposed extension_pages + harness isolation)
    const mv3LikeCsp =
      "default-src 'none'; base-uri 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; connect-src 'self'; worker-src 'self' blob:; object-src 'self'; img-src 'none'; font-src 'none'; frame-src 'none'; form-action 'none'";

    if (urlPath.includes('mv3-csp-ro1-host.html')) {
      headers['Content-Security-Policy'] = mv3LikeCsp;
    } else if (
      urlPath.includes('ro1-isolation-host.html') ||
      urlPath.includes('worker-csp-lifecycle.html') ||
      urlPath.includes('spp-real-worker-audit.html') ||
      urlPath.includes('host-worker-containment.html')
    ) {
      headers['Content-Security-Policy'] = docIsolationCsp;
    } else if (urlPath.includes('csp-wasm-requirement.html')) {
      headers['Content-Security-Policy'] =
        "default-src 'none'; script-src 'self'; connect-src 'self'; worker-src 'self'; style-src 'self'; object-src 'none'";
    } else if (
      urlPath.includes('worker-network-probe.html') ||
      urlPath.includes('ro1-broker-host.html')
    ) {
      headers['Content-Security-Policy'] =
        "default-src 'none'; base-uri 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; worker-src 'self'; img-src 'none'; font-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'";
    }

    // Worker script CSP (Fase 2.32). Skip when ?nocsp=1 (negative control).
    if (!noWorkerCsp) {
      if (
        urlPath.includes('worker-csp-probe.classic.js') ||
        urlPath.includes('worker-csp-probe.module.js') ||
        urlPath.includes('csp-negative-probe.worker.js')
      ) {
        headers['Content-Security-Policy'] = workerConnectSelfCsp;
      }
      // Real SPP workers served by harness — enable connect-src 'self' + wasm-unsafe-eval
      if (
        urlPath.includes('/stellar-private-payments/dist/workers/storage-worker') ||
        urlPath.includes('/stellar-private-payments/dist/workers/prover-worker')
      ) {
        headers['Content-Security-Policy'] = sppWorkerCsp;
      }
    }

    res.writeHead(200, headers);
    res.end(data);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  const page = `http://127.0.0.1:${PORT}/tests/stellar/spp/harness/browser/index.html`;
  const ro1 = `http://127.0.0.1:${PORT}/tests/stellar/spp/harness/browser/ro1-host.html`;
  const broker = `http://127.0.0.1:${PORT}/tests/stellar/spp/harness/browser/ro1-broker-host.html`;
  const probe = `http://127.0.0.1:${PORT}/tests/stellar/spp/harness/browser/worker-network-probe.html`;
  const isolation = `http://127.0.0.1:${PORT}/tests/stellar/spp/harness/browser/ro1-isolation-host.html`;
  const wasmCsp = `http://127.0.0.1:${PORT}/tests/stellar/spp/harness/browser/csp-wasm-requirement.html`;
  const lifecycle = `http://127.0.0.1:${PORT}/tests/stellar/spp/harness/browser/worker-csp-lifecycle.html`;
  const realWorkers = `http://127.0.0.1:${PORT}/tests/stellar/spp/harness/browser/spp-real-worker-audit.html`;
  const containment = `http://127.0.0.1:${PORT}/tests/stellar/spp/harness/browser/host-worker-containment.html`;
  const mv3Twin = `http://127.0.0.1:${PORT}/tests/stellar/spp/harness/browser/mv3-csp-ro1-host.html`;
  console.log(`SPP browser harness serving ${ROOT}`);
  console.log(`Open: ${page}`);
  console.log(`RO-1 spike (Fase 2.27): ${ro1}`);
  console.log(`Typed broker host (Fase 2.30): ${broker}`);
  console.log(`Worker+CSP probe (Fase 2.30): ${probe}`);
  console.log(`Real SDK isolation (Fase 2.31): ${isolation}`);
  console.log(`CSP wasm requirement (Fase 2.31): ${wasmCsp}`);
  console.log(`Worker CSP lifecycle (Fase 2.32): ${lifecycle}`);
  console.log(`Real SPP worker audit (Fase 2.33): ${realWorkers}`);
  console.log(`Host worker containment (Fase 2.34): ${containment}`);
  console.log(`MV3 CSP RO-1 twin (Fase 2.35): ${mv3Twin}`);
  console.log(`Mock RPC (synthetic): http://127.0.0.1:${PORT}/rpc`);
  console.log(`Mock RPC RO-1 (getLedgerEntries only): http://127.0.0.1:${PORT}/rpc-ro1`);
});

const shutdown = () => {
  server.close(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
