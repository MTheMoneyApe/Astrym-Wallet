/**
 * Loopback-only JSON-RPC mock for SPP harness (Fase 2.1).
 * No proxy, no forwarding, no external DNS/HTTP.
 *
 * Can run standalone (`node mock-rpc.mjs`) or be mounted by serve.mjs at POST /rpc.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, 'fixtures');

const DEFAULT_PORT = Number(process.env.SPP_MOCK_RPC_PORT || 8766);

/** @type {{ at: string, method: string, id: unknown, outcome: string, synthetic: boolean }[]} */
const requestLog = [];

function loadFixture(name) {
  const raw = JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));
  // Drop human-only metadata keys before serving as JSON-RPC result.
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const { _comment, ...rest } = raw;
    return rest;
  }
  return raw;
}

function jsonRpcError(id, code, message) {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code, message },
  };
}

function jsonRpcResult(id, result) {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    result,
  };
}

/**
 * Handle a single JSON-RPC body (object). Returns response object.
 * Never forwards. Labels outcomes for harness logs (not embedded in RPC result).
 */
export function handleJsonRpcRequest(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    const resp = jsonRpcError(null, -32600, 'Invalid Request (batch/non-object not supported by synthetic mock)');
    requestLog.push({
      at: new Date().toISOString(),
      method: '(invalid)',
      id: null,
      outcome: 'reject_invalid',
      synthetic: true,
    });
    return resp;
  }

  const id = body.id;
  const method = body.method;

  if (typeof method !== 'string') {
    requestLog.push({
      at: new Date().toISOString(),
      method: '(missing)',
      id,
      outcome: 'reject_invalid',
      synthetic: true,
    });
    return jsonRpcError(id, -32600, 'Invalid Request');
  }

  // Hard deny writes
  if (method === 'sendTransaction') {
    requestLog.push({
      at: new Date().toISOString(),
      method,
      id,
      outcome: 'reject_sendTransaction',
      synthetic: true,
    });
    return jsonRpcError(id, -32000, 'synthetic mock: sendTransaction is always rejected');
  }

  if (method === 'getLatestLedger') {
    const result = loadFixture('getLatestLedger.result.json');
    requestLog.push({
      at: new Date().toISOString(),
      method,
      id,
      outcome: 'synthetic_getLatestLedger',
      synthetic: true,
    });
    return jsonRpcResult(id, result);
  }

  if (method === 'getLedgerEntries') {
    // Fase 2.12: synthetic pool Admin/State (+ instance) + ASP for allContractsData().
    // Still synthetic; not a real deployment. aspMinimal / empty retained as archives.
    const result = loadFixture('getLedgerEntries.allContractsMinimal.result.json');
    requestLog.push({
      at: new Date().toISOString(),
      method,
      id,
      outcome: 'synthetic_getLedgerEntries_allContractsMinimal',
      synthetic: true,
    });
    return jsonRpcResult(id, result);
  }

  // Methods seen in WASM but not faithfully fixture-modeled yet.
  requestLog.push({
    at: new Date().toISOString(),
    method,
    id,
    outcome: 'reject_unmodeled',
    synthetic: true,
  });
  return jsonRpcError(
    id,
    -32601,
    `synthetic mock: method not modeled (${method}) — refusing to invent response shape`,
  );
}

/**
 * Fase 2.27 — RO-1-only JSON-RPC: allow solely getLedgerEntries (aspState / allContractsData).
 * Rejects getLatestLedger, getEvents, simulate, send, and all unmodeled methods.
 */
export function handleRo1JsonRpcRequest(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    requestLog.push({
      at: new Date().toISOString(),
      method: '(invalid)',
      id: null,
      outcome: 'reject_invalid_ro1',
      synthetic: true,
    });
    return jsonRpcError(null, -32600, 'Invalid Request');
  }
  const id = body.id;
  const method = body.method;
  if (typeof method !== 'string') {
    requestLog.push({
      at: new Date().toISOString(),
      method: '(missing)',
      id,
      outcome: 'reject_invalid_ro1',
      synthetic: true,
    });
    return jsonRpcError(id, -32600, 'Invalid Request');
  }
  if (method === 'getLedgerEntries') {
    const result = loadFixture('getLedgerEntries.allContractsMinimal.result.json');
    requestLog.push({
      at: new Date().toISOString(),
      method,
      id,
      outcome: 'synthetic_getLedgerEntries_allContractsMinimal_ro1',
      synthetic: true,
    });
    return jsonRpcResult(id, result);
  }
  requestLog.push({
    at: new Date().toISOString(),
    method,
    id,
    outcome: 'reject_ro1_not_allowlisted',
    synthetic: true,
  });
  return jsonRpcError(
    id,
    -32601,
    `RO-1 mock: method not allowlisted (${method}) — only getLedgerEntries permitted`,
  );
}

export function getMockRpcLog() {
  return requestLog.slice();
}

export function clearMockRpcLog() {
  requestLog.length = 0;
}

/**
 * HTTP request handler (POST JSON only). Bind exclusively to 127.0.0.1 by caller.
 */
/**
 * @param {{ mode?: 'default' | 'ro1' }} [options]
 */
export function createMockRpcHttpHandler(options = {}) {
  const mode = options.mode === 'ro1' ? 'ro1' : 'default';
  const handle = mode === 'ro1' ? handleRo1JsonRpcRequest : handleJsonRpcRequest;
  return (req, res) => {
    // CORS only for loopback harness origins (when mounted cross-port); same-origin /rpc needs no CORS.
    const origin = req.headers.origin;
    if (origin && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'content-type');
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method === 'GET' && (req.url === '/' || req.url === '/health')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          synthetic: true,
          bind: '127.0.0.1',
          mode,
          note:
            mode === 'ro1'
              ? 'SPP RO-1 mock — only getLedgerEntries; no external forwarding'
              : 'SPP mock RPC — no external forwarding',
        }),
      );
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405);
      res.end('POST only');
      return;
    }

    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null');
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(jsonRpcError(null, -32700, 'Parse error')));
        return;
      }
      const response = handle(body);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(response));
    });
  };
}

/**
 * @returns {Promise<http.Server>}
 */
export function startMockRpcServer(port = DEFAULT_PORT) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(createMockRpcHttpHandler());
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      resolve(server);
    });
  });
}

export function closeServer(server) {
  return new Promise((resolve, reject) => {
    if (!server) {
      resolve();
      return;
    }
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = DEFAULT_PORT;
  const server = await startMockRpcServer(port);
  console.log(`SPP mock RPC on http://127.0.0.1:${port}/ (synthetic, no forwarding)`);
  const shutdown = async () => {
    await closeServer(server);
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
