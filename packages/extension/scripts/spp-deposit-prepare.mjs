#!/usr/bin/env node
/**
 * Prepare a REAL PrivatePool.deposit(2.0 XLM) for the disposable Testnet sender
 * WITHOUT broadcasting.
 *
 * Patterns from spp-register-prepare.mjs / spp-groth16-local-prove.mjs:
 *   - Playwright Chromium + static spp asset overlay (circuits-v0.7 + keyOwnership)
 *   - Keypair WalletSigner via Node exposeFunction (S… never enters page source)
 *   - fetch interceptor: allow get* and simulateTransaction; BLOCK sendTransaction
 *   - Encrypted Storage.open({ keyProvider, createNew: true })
 *
 * Writes (no secrets):
 *   /opt/cursor/artifacts/deposit/deposit-prepare-evidence.json
 *   /opt/cursor/artifacts/deposit/deposit-approval-packet.json
 *   /opt/cursor/artifacts/deposit/DEPOSIT-APPROVAL-PACKET.md
 *
 * Usage (from packages/extension):
 *   node scripts/spp-deposit-prepare.mjs
 *   SPP_DEPOSIT_TIMEOUT_MS=900000 node scripts/spp-deposit-prepare.mjs
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
const WORKSPACE_ROOT = resolve(EXTENSION_ROOT, '../..');
const require = createRequire(join(EXTENSION_ROOT, 'package.json'));
const { chromium } = require('@playwright/test');
const {
  Keypair,
  TransactionBuilder,
  hash,
  xdr,
  Contract,
  rpc,
  Networks,
  Account,
  Address,
  scValToNative,
} = require('@stellar/stellar-sdk');

const SEP53_PREFIX = 'Stellar Signed Message:\n';
function hashSep53Message(message) {
  const enc = new TextEncoder();
  const prefix = enc.encode(SEP53_PREFIX);
  const body = enc.encode(message);
  const joined = Buffer.concat([Buffer.from(prefix), Buffer.from(body)]);
  return createHash('sha256').update(joined).digest();
}
function toBase64(u8) {
  return Buffer.from(u8).toString('base64');
}

const SPP_ROOT_CANDIDATES = [
  process.env.SPP_DEPOSIT_SDK_ROOT,
  join(EXTENSION_ROOT, 'dist', 'spp'),
  join(EXTENSION_ROOT, 'public', 'spp'),
].filter(Boolean);
const SPP_ROOT = SPP_ROOT_CANDIDATES.find((p) => existsSync(join(p, 'js', 'index.js')));
const CIRCUITS_DIR = SPP_ROOT ? join(SPP_ROOT, 'dist', 'circuits') : null;
const ARTIFACTS_DIR =
  process.env.SPP_DEPOSIT_ARTIFACTS_DIR || '/opt/cursor/artifacts/deposit';
const EVIDENCE_PATH = join(ARTIFACTS_DIR, 'deposit-prepare-evidence.json');
const PACKET_PATH = join(ARTIFACTS_DIR, 'deposit-approval-packet.json');
const PACKET_MD_PATH = join(ARTIFACTS_DIR, 'DEPOSIT-APPROVAL-PACKET.md');
const WALLETS_PATH = process.env.SPP_E2E_WALLETS_PATH || '/tmp/spp-e2e-test-wallets.json';
const RPC_URL = process.env.SPP_RPC_URL || 'https://soroban-testnet.stellar.org';
const HORIZON_URL = process.env.SPP_HORIZON_URL || 'https://horizon-testnet.stellar.org';
const POOL = 'CAMWBUWHYXEGBM3Q7M5DBGW7LLJL3I4QGANQEZFEWLRNTOJMTT2WG24U';
const REGISTRY = 'CARXHKOPSGMUMFRDI72KNCRENVOTCJIGXPCPYOW42APDY2NEYF7CLKIL';
const EXPECTED_SENDER = 'GDH76ERJT7WSYBV7A3VDZ4UTK7QFXWSBIS7ZRR6DNYTUHIRFRXBR5R7F';
const EXPECTED_RECIPIENT = 'GDJ7V7FI7K6CRWM6XOLHZML6WIHCD3XTW7LRBAQZJCI4FDCDCHUYYY37';
const SENDER_REG_TX =
  '8c5ea2eead8d277b33b641e7036335d732a4e24a33305536cd440c750f54292b';
const RECIPIENT_REG_TX =
  '28de82632ba752c91aee531cebaab782ef972f678a1120dc682b088e939a1872';
const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
const KDF_DOMAIN = 'Nethermind';
/** Exactly 2.0 XLM note amount (pool protocol fee is charged on top). */
const DEPOSIT_STROOPS = BigInt(process.env.SPP_DEPOSIT_STROOPS || '20000000');
const DEPOSIT_XLM = (Number(DEPOSIT_STROOPS) / 10_000_000).toFixed(7);
/** Policy ceiling for deposit (SPP_PROPOSED_MAX_FEE_STROOPS.deposit) — do not raise. */
const POLICY_MAX_FEE_STROOPS = 8_000_000;
const PACKET_VERSION = '2026-11-05-deposit-v1';
const TIMEOUT_MS = Number(process.env.SPP_DEPOSIT_TIMEOUT_MS || 900_000);
const CHROME_PATH =
  process.env.CHROME_PATH ||
  '/home/ubuntu/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.bin': 'application/octet-stream',
  '.r1cs': 'application/octet-stream',
  '.txt': 'text/plain; charset=utf-8',
};

function fail(message) {
  console.error(`[spp-deposit-prepare] FAIL: ${message}`);
  process.exit(1);
}

function log(msg) {
  console.log(`[spp-deposit-prepare] ${msg}`);
}

function loadDeployments() {
  const path = join(
    WORKSPACE_ROOT,
    'packages/wallet-core/src/stellar/spp/nethermind/testnet-deployments.json',
  );
  return JSON.parse(readFileSync(path, 'utf8'));
}

function loadWallets() {
  if (!existsSync(WALLETS_PATH)) fail(`Missing wallets file at ${WALLETS_PATH}`);
  const raw = JSON.parse(readFileSync(WALLETS_PATH, 'utf8'));
  if (typeof raw.senderSecret !== 'string' || typeof raw.recipientSecret !== 'string') {
    fail('wallets file missing senderSecret/recipientSecret');
  }
  const senderKp = Keypair.fromSecret(raw.senderSecret);
  const recipientKp = Keypair.fromSecret(raw.recipientSecret);
  if (senderKp.publicKey() !== EXPECTED_SENDER) {
    fail('sender secret does not derive expected public address');
  }
  if (recipientKp.publicKey() !== EXPECTED_RECIPIENT) {
    fail('recipient secret does not derive expected public address');
  }
  return { senderKp, recipientKp };
}

function writeHarnessHtml(root) {
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>SPP deposit prepare</title></head>
<body>
<h1>SPP PrivatePool.deposit prepare (no broadcast)</h1>
<pre id="out">boot</pre>
<script type="module">
window.__SPP_DEPOSIT__ = { ready: false, result: null, errors: [] };
document.getElementById('out').textContent = 'module-ready';
window.__SPP_DEPOSIT__.ready = true;
</script>
</body></html>`;
  writeFileSync(join(root, 'index.html'), html);
}

function scrubSecrets(value) {
  return JSON.stringify(value, null, 2).replace(/\bS[A-Z0-9]{55}\b/g, '<REDACTED_SECRET_SHAPE>');
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, scrubSecrets(value));
}

function fingerprintXdr(xdrB64) {
  const bytes = Buffer.from(String(xdrB64), 'base64');
  return createHash('sha256').update(bytes).digest('hex');
}

async function refreshHorizonAccount(address) {
  const res = await fetch(`${HORIZON_URL}/accounts/${address}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    return {
      ok: false,
      address,
      httpStatus: res.status,
      error: (await res.text()).slice(0, 400),
      sequence: null,
      balanceXlm: null,
    };
  }
  const data = await res.json();
  const native = Array.isArray(data.balances)
    ? data.balances.find((b) => b.asset_type === 'native')
    : null;
  return {
    ok: true,
    address,
    sequence: String(data.sequence ?? ''),
    balanceXlm: native?.balance ?? null,
    subentryCount: typeof data.subentry_count === 'number' ? data.subentry_count : null,
    lastModifiedLedger: data.last_modified_ledger ?? null,
    horizonUrl: HORIZON_URL,
    transportNote:
      'Clearnet Horizon READ used for prepare evidence only; approval packet transport remains nym',
  };
}

async function refreshHorizonTx(hashHex) {
  const res = await fetch(`${HORIZON_URL}/transactions/${hashHex}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    return { ok: false, hash: hashHex, httpStatus: res.status };
  }
  const data = await res.json();
  return {
    ok: true,
    hash: data.hash,
    successful: data.successful === true,
    ledger: data.ledger,
    feeCharged: data.fee_charged,
    sourceAccount: data.source_account,
  };
}

async function readPoolAndRegistry() {
  const server = new rpc.Server(RPC_URL, { allowHttp: false });
  const dummy = Keypair.random();

  async function simCall(contractId, fn, args = []) {
    const account = new Account(dummy.publicKey(), '0');
    const c = new Contract(contractId);
    const tx = new TransactionBuilder(account, {
      fee: '100000',
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(c.call(fn, ...args))
      .setTimeout(30)
      .build();
    const sim = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) {
      return { ok: false, error: String(sim.error).slice(0, 500) };
    }
    if (rpc.Api.isSimulationSuccess(sim) && sim.result) {
      try {
        const v = scValToNative(sim.result.retval);
        return {
          ok: true,
          value: typeof v === 'bigint' ? v.toString() : v,
          minResourceFee: sim.minResourceFee,
        };
      } catch (e) {
        return { ok: true, raw: String(sim.result.retval), minResourceFee: sim.minResourceFee };
      }
    }
    return { ok: false, kind: 'other' };
  }

  const pool = {};
  for (const fn of [
    'get_fee',
    'get_kdf_domain',
    'get_policy_flags',
    'deposits_paused',
    'get_root',
    'get_asp_membership_root',
    'get_asp_non_membership_root',
  ]) {
    pool[fn] = await simCall(POOL, fn);
  }
  const registry = {
    get_kdf_domain: await simCall(REGISTRY, 'get_kdf_domain'),
    get_verifier: await simCall(REGISTRY, 'get_verifier'),
  };

  // Registry has no is_registered export — confirm via known SUCCESS txs + events.
  const latest = await server.getLatestLedger();
  let registryEvents = { ok: false, events: [] };
  try {
    const start = 5563280 - 2;
    const end = Math.min(5563298 + 20, latest.sequence);
    const res = await server.getEvents({
      startLedger: start,
      endLedger: end,
      filters: [{ type: 'contract', contractIds: [REGISTRY] }],
      limit: 20,
    });
    const decoded = [];
    for (const e of res.events || []) {
      try {
        const topicB64 = Array.isArray(e.topic) ? e.topic[1] : null;
        let account = null;
        if (typeof topicB64 === 'string') {
          account = Address.fromScVal(xdr.ScVal.fromXDR(topicB64, 'base64')).toString();
        } else if (e.topic?.[1]) {
          account = Address.fromScVal(e.topic[1]).toString();
        }
        decoded.push({ ledger: e.ledger, account, id: e.id });
      } catch {
        decoded.push({ ledger: e.ledger, account: null, id: e.id });
      }
    }
    registryEvents = {
      ok: true,
      latestLedger: latest.sequence,
      events: decoded,
      senderEvent: decoded.some((d) => d.account === EXPECTED_SENDER),
      recipientEvent: decoded.some((d) => d.account === EXPECTED_RECIPIENT),
    };
  } catch (e) {
    registryEvents = { ok: false, error: String(e?.message || e).slice(0, 400) };
  }

  return { pool, registry, registryEvents };
}

function startOverlayServer(harnessRoot, sppRoot) {
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
        const st = statSync(full);
        const headers = {
          'Content-Type': MIME[extname(full)] || 'application/octet-stream',
          'Cache-Control': 'no-store',
        };
        if (req.method === 'HEAD') {
          headers['Content-Length'] = String(st.size);
          res.writeHead(200, headers);
          res.end();
          return;
        }
        res.writeHead(200, headers);
        createReadStream(full).pipe(res);
      } catch (e) {
        res.writeHead(500);
        res.end(String(e));
      }
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolveServer({ server, port: addr.port, origin: `http://127.0.0.1:${addr.port}` });
    });
  });
}

function classifySimulationHonesty(simulateCaptures) {
  if (!simulateCaptures || simulateCaptures.length === 0) {
    return {
      status: 'incomplete',
      label: 'incomplete_no_simulateTransaction_captured',
      minResourceFee: null,
      cost: null,
      error: null,
      note: 'No simulateTransaction request was observed — cannot invent fees',
    };
  }
  const last = simulateCaptures[simulateCaptures.length - 1];
  const minResourceFee =
    last.response?.minResourceFee != null ? String(last.response.minResourceFee) : null;
  const cost = last.response?.cost ?? null;
  const error = last.response?.error ? String(last.response.error).slice(0, 1200) : null;
  const rpcError = last.response?.rpcError ? String(last.response.rpcError).slice(0, 400) : null;
  const contractErrorMatch = (error || rpcError || '').match(/Error\(Contract,\s*#(\d+)\)/);
  const contractError = contractErrorMatch ? Number(contractErrorMatch[1]) : null;

  if (last.response?.parseError && !last.response?.rawStatus) {
    return {
      status: 'incomplete',
      label: 'incomplete_simulate_response_unparsed',
      minResourceFee,
      cost,
      error: last.response.parseError,
      contractError,
      note: 'Simulate response could not be parsed; fees not invented',
    };
  }
  if (error || rpcError) {
    return {
      status: 'failed',
      label: 'simulate_failed',
      minResourceFee,
      cost,
      error: error || rpcError,
      contractError,
      contractErrorName:
        contractError === 6
          ? 'WrongExtAmount'
          : contractError != null
            ? `Contract#${contractError}`
            : null,
      note: minResourceFee
        ? 'Simulate returned error but still reported minResourceFee — recorded as simulationEvidence only; NOT a successful simulation'
        : 'Simulate failed without usable success fee — policy ceiling remains 8_000_000 stroops',
    };
  }
  if (minResourceFee != null) {
    return {
      status: 'succeeded',
      label: 'simulate_succeeded_with_minResourceFee',
      minResourceFee,
      cost,
      error: null,
      contractError: null,
      note: 'minResourceFee from RPC simulate response; policy ceiling still 8_000_000 stroops',
    };
  }
  return {
    status: 'incomplete',
    label: 'incomplete_simulate_no_minResourceFee',
    minResourceFee: null,
    cost,
    error: null,
    contractError: null,
    note: 'Simulate response lacked minResourceFee — fees not invented',
  };
}

function readGateDefaults() {
  const broadcast = readFileSync(
    join(WORKSPACE_ROOT, 'packages/wallet-core/src/stellar/spp/sppBroadcastGate.ts'),
    'utf8',
  );
  const registration = readFileSync(
    join(WORKSPACE_ROOT, 'packages/wallet-core/src/stellar/spp/sppRegistrationAuthorization.ts'),
    'utf8',
  );
  const deposit = readFileSync(
    join(WORKSPACE_ROOT, 'packages/wallet-core/src/stellar/spp/sppDepositAuthorization.ts'),
    'utf8',
  );
  return {
    globalMutatorGateDefaultOff: /let authorized = false/.test(broadcast),
    registrationGateDefaultOff: /let registrationAuthorized = false/.test(registration),
    depositGateDefaultOff: /let depositAuthorized = false/.test(deposit),
    runtimeNotFlippedByThisScript: true,
  };
}

function parseTxMeta(xdrB64) {
  try {
    const tx = TransactionBuilder.fromXDR(xdrB64, NETWORK_PASSPHRASE);
    const ops = tx.operations || [];
    return {
      ok: true,
      source: tx.source,
      sequence: String(tx.sequence),
      fee: String(tx.fee),
      operationCount: ops.length,
      operationTypes: ops.map((o) => o.type || o.name || typeof o),
      networkPassphrase: NETWORK_PASSPHRASE,
    };
  } catch (e) {
    return { ok: false, error: String(e?.message || e).slice(0, 300) };
  }
}

async function prepareDeposit({ origin, contractConfig, circuitLock, horizon, senderKp }) {
  const out = {
    step: 1,
    role: 'sender',
    operation: 'deposit',
    sourceAddress: EXPECTED_SENDER,
    poolContract: POOL,
    amountStroops: String(DEPOSIT_STROOPS),
    amountXlm: DEPOSIT_XLM,
    addressMatched: false,
    observedAddress: null,
    horizon,
    sequenceAtApproval: horizon?.sequence ?? null,
    wasmOk: false,
    proverOk: false,
    opfsOk: false,
    clientOk: false,
    derivePrivacyKeysOk: false,
    isRegistered: null,
    writePoolReady: false,
    poolBoundOk: false,
    syncOk: null,
    depositStatus: null,
    depositError: null,
    depositMs: null,
    progressEvents: [],
    rpcMethodsSeen: [],
    blockedSendTransactionCount: 0,
    simulateCaptures: [],
    capturedXdrs: [],
    unsignedOrPreparedTxXdr: null,
    transactionFingerprint: null,
    fingerprintOf: null,
    fingerprintAlgorithm:
      'sha256(base64decode(xdr_bytes)).digest("hex") — last successful-or-attempted simulate XDR when present',
    simulationHonesty: null,
    simulationEvidence: null,
    maxFeeStroops: String(POLICY_MAX_FEE_STROOPS),
    maxFeeSource: 'SPP_PROPOSED_MAX_FEE_STROOPS.deposit (policy cap; not raised)',
    broadcastAttempted: false,
    onChainSubmit: false,
    secretsIncluded: false,
    errors: [],
    blockers: [],
  };

  const userDataDir = join(tmpdir(), `spp-deposit-sender-${randomBytes(4).toString('hex')}`);
  mkdirSync(userDataDir, { recursive: true });
  out.userDataDir = userDataDir;

  const kp = senderKp;
  let context;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      executablePath: CHROME_PATH,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--enable-features=FileSystemAccessAPI',
      ],
    });
    const page = context.pages()[0] || (await context.newPage());
    page.setDefaultTimeout(TIMEOUT_MS);

    page.on('console', (msg) => {
      const text = msg.text();
      if (/^S[A-Z0-9]{55}$/.test(text) || /secret|mnemonic|seed/i.test(text)) return;
    });
    page.on('pageerror', (err) => {
      out.errors.push(`pageerror: ${err.message}`.slice(0, 400));
    });

    await page.exposeFunction('__sppNodeSignMessage', async (message) => {
      if (typeof message !== 'string') throw new Error('signMessage requires string');
      const digest = hashSep53Message(message);
      const sig = kp.sign(digest);
      return { signedMessage: toBase64(sig), signerAddress: kp.publicKey() };
    });
    await page.exposeFunction('__sppNodeSignTransaction', async (xdrInput) => {
      const tx = TransactionBuilder.fromXDR(xdrInput, NETWORK_PASSPHRASE);
      if (typeof tx.sign !== 'function') throw new Error('Fee-bump / unsupported envelope');
      tx.sign(kp);
      return { signedTxXdr: tx.toXDR(), signerAddress: kp.publicKey() };
    });
    await page.exposeFunction('__sppNodeSignAuthEntry', async (xdrInput) => {
      const preimage = xdr.HashIdPreimage.fromXDR(xdrInput, 'base64');
      const payload = hash(preimage.toXDR());
      const digest = payload instanceof Uint8Array ? payload : Buffer.from(payload);
      const sig = kp.sign(digest);
      return { signedAuthEntry: toBase64(sig), signerAddress: kp.publicKey() };
    });
    await page.exposeFunction('__sppNodePublicKey', async () => kp.publicKey());

    await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__SPP_DEPOSIT__?.ready === true);

    log(`sender: starting page evaluate (timeout ${TIMEOUT_MS}ms, amount=${DEPOSIT_STROOPS})`);

    const pageResult = await page.evaluate(
      async (input) => {
        const result = {
          addressMatched: false,
          observedAddress: null,
          wasmOk: false,
          proverOk: false,
          opfsOk: false,
          clientOk: false,
          derivePrivacyKeysOk: false,
          isRegistered: null,
          writePoolReady: false,
          poolBoundOk: false,
          syncOk: null,
          depositStatus: null,
          depositError: null,
          depositMs: null,
          progressEvents: [],
          rpcMethodsSeen: [],
          blockedSendTransactionCount: 0,
          simulateCaptures: [],
          errors: [],
          blockers: [],
          noteCount: null,
          balanceStroops: null,
          poolFee: null,
        };

        const progress = [];
        window.addEventListener('stellar-private-payments:tx-progress', (ev) => {
          const detail = ev?.detail ?? {};
          progress.push({
            flow: detail.flow ?? null,
            stage: detail.stage ?? null,
            message: detail.message ?? null,
            current: detail.current ?? null,
            total: detail.total ?? null,
            atMs: Date.now(),
          });
        });

        const originalFetch = globalThis.fetch.bind(globalThis);

        async function readFetchBodyText(fetchInput, init) {
          try {
            if (init && typeof init.body === 'string') return init.body;
            if (
              init &&
              init.body &&
              (ArrayBuffer.isView(init.body) || init.body instanceof ArrayBuffer)
            ) {
              return new TextDecoder().decode(init.body);
            }
            if (typeof Request !== 'undefined' && fetchInput instanceof Request) {
              return await fetchInput.clone().text();
            }
          } catch {
            return null;
          }
          return null;
        }

        function extractTransactionXdrs(rpcBody) {
          const found = [];
          if (!rpcBody || typeof rpcBody !== 'object') return found;
          const params = rpcBody.params;
          if (typeof params === 'string' && params.length > 20) found.push(params);
          else if (params && typeof params === 'object') {
            if (typeof params.transaction === 'string') found.push(params.transaction);
            if (typeof params.xdr === 'string') found.push(params.xdr);
            if (Array.isArray(params) && typeof params[0] === 'string') found.push(params[0]);
            if (Array.isArray(params?.transactions)) {
              for (const t of params.transactions) {
                if (typeof t === 'string') found.push(t);
                else if (t && typeof t.transaction === 'string') found.push(t.transaction);
              }
            }
          }
          return found;
        }

        function summarizeSimulateResponse(json) {
          if (!json || typeof json !== 'object') return { parseError: 'non-object response' };
          if (json.error) {
            return {
              rpcError:
                typeof json.error === 'string'
                  ? json.error
                  : JSON.stringify(json.error).slice(0, 600),
              minResourceFee: null,
              cost: null,
              error: null,
            };
          }
          const r = json.result;
          if (!r || typeof r !== 'object') {
            return { parseError: 'missing result', rawKeys: Object.keys(json).slice(0, 12) };
          }
          return {
            minResourceFee: r.minResourceFee ?? r.min_resource_fee ?? null,
            cost: r.cost ?? null,
            error: r.error ? String(r.error).slice(0, 2000) : null,
            latestLedger: r.latestLedger ?? r.latest_ledger ?? null,
            hasResults: Array.isArray(r.results) ? r.results.length : null,
            hasTransactionData: Boolean(r.transactionData || r.transaction_data),
          };
        }

        globalThis.fetch = async (fetchInput, init = {}) => {
          const bodyText = await readFetchBodyText(fetchInput, init);
          let method = null;
          let rpcBody = null;
          if (bodyText && bodyText.trim().startsWith('{')) {
            try {
              rpcBody = JSON.parse(bodyText);
              method = rpcBody?.method ?? null;
            } catch {
              method = null;
            }
          }
          if (method) result.rpcMethodsSeen.push(method);

          if (method === 'sendTransaction') {
            result.blockedSendTransactionCount += 1;
            throw new Error(
              'BROADCAST_BLOCKED: sendTransaction denied by spp-deposit-prepare harness',
            );
          }

          if (method === 'simulateTransaction') {
            const xdrs = extractTransactionXdrs(rpcBody);
            const capture = {
              atMs: Date.now(),
              requestId: rpcBody?.id ?? null,
              transactionXdrs: xdrs.map((x) => String(x)),
              transactionXdrLengths: xdrs.map((x) => String(x).length),
              response: null,
            };
            try {
              const resp = await originalFetch(fetchInput, init);
              const cloned = resp.clone();
              let respJson = null;
              try {
                respJson = await cloned.json();
              } catch (e) {
                capture.response = {
                  parseError: `json: ${String(e?.message || e).slice(0, 200)}`,
                  rawStatus: resp.status,
                };
                result.simulateCaptures.push(capture);
                return resp;
              }
              capture.response = summarizeSimulateResponse(respJson);
              result.simulateCaptures.push(capture);
              return resp;
            } catch (e) {
              capture.response = {
                parseError: `fetch: ${String(e?.message || e).slice(0, 300)}`,
              };
              result.simulateCaptures.push(capture);
              throw e;
            }
          }

          return originalFetch(fetchInput, init);
        };

        let client = null;
        try {
          const circuitsBaseUrl = new URL('./dist/circuits/', location.href).href;
          const spp = await import(new URL('./js/index.js', location.href).href);
          await spp.default();
          result.wasmOk = true;

          if (!input.circuitLock?.keyOwnership) {
            throw new Error('circuitLock.keyOwnership missing — deposit circuits incomplete');
          }
          if (String(input.circuitLock.version) !== '0.7') {
            result.errors.push(
              `unexpected circuit lock version ${input.circuitLock.version} (expected 0.7)`,
            );
          }

          const proverWorkerUrl = new URL('./dist/workers/prover-worker.js', location.href).href;
          const prover = spp.ProverBridge.spawn(proverWorkerUrl);
          await prover.configureCircuitsBase(circuitsBaseUrl, JSON.stringify(input.circuitLock));
          await prover.ping();
          result.proverOk = true;

          const storageKeyBytes = new Uint8Array(32);
          crypto.getRandomValues(storageKeyBytes);
          const storage = await spp.Storage.open({
            keyProvider: async () => new Uint8Array(storageKeyBytes),
            createNew: true,
          });
          result.opfsOk = true;

          client = await spp.Client.new({
            rpcUrl: input.rpcUrl,
            storage,
            contractConfig: input.contractConfig,
            circuitsBaseUrl,
            circuitLock: input.circuitLock,
            prover,
          });
          result.clientOk = true;

          const signer = {
            getPublicKey: () => window.__sppNodePublicKey(),
            signMessage: async (message) => window.__sppNodeSignMessage(String(message)),
            signTransaction: async (xdrInput) =>
              window.__sppNodeSignTransaction(String(xdrInput)),
            signAuthEntry: async (authEntryXdr) =>
              window.__sppNodeSignAuthEntry(String(authEntryXdr)),
          };

          const pub = await signer.getPublicKey();
          result.observedAddress = typeof pub === 'string' ? pub : null;
          result.addressMatched = pub === input.expectedAddress;
          if (!result.addressMatched) {
            result.blockers.push('signer public key does not match expected sender address');
            result.progressEvents = progress;
            return result;
          }

          const accountHandle = await client.account(
            { networkPassphrase: input.networkPassphrase, userAddress: pub },
            signer,
          );
          await accountHandle.derivePrivacyKeys();
          result.derivePrivacyKeysOk = true;

          try {
            await Promise.race([
              client.sync(),
              new Promise((_, rej) =>
                setTimeout(
                  () => rej(new Error('client.sync timeout')),
                  Math.min(input.timeoutMs * 0.35, 300_000),
                ),
              ),
            ]);
            result.syncOk = true;
          } catch (e) {
            result.syncOk = false;
            result.errors.push(`sync_nonfatal: ${String(e?.message || e).slice(0, 300)}`);
          }

          try {
            result.isRegistered = await accountHandle.isRegistered();
          } catch (e) {
            result.errors.push(`isRegistered: ${String(e?.message || e).slice(0, 300)}`);
            result.isRegistered = null;
          }

          const pool = await accountHandle.pool({ poolContract: input.poolContract });
          result.poolBoundOk = true;
          result.writePoolReady =
            result.wasmOk &&
            result.proverOk &&
            result.opfsOk &&
            result.clientOk &&
            result.derivePrivacyKeysOk &&
            result.poolBoundOk &&
            result.addressMatched === true;

          try {
            result.poolFee = String(await pool.fee());
          } catch (e) {
            result.errors.push(`pool.fee: ${String(e?.message || e).slice(0, 200)}`);
          }
          try {
            const notes = await pool.notes();
            result.noteCount = Array.isArray(notes) ? notes.length : null;
          } catch {
            result.noteCount = null;
          }
          try {
            const bal = await pool.balance();
            result.balanceStroops =
              bal == null ? null : typeof bal === 'bigint' ? bal.toString() : String(bal);
          } catch {
            result.balanceStroops = null;
          }

          if (result.isRegistered !== true) {
            result.blockers.push(
              `sender isRegistered=${result.isRegistered} — deposit requires registered account`,
            );
          }

          const started = Date.now();
          try {
            const depositOutcome = await Promise.race([
              pool.deposit(BigInt(input.depositStroops)),
              new Promise((_, rej) =>
                setTimeout(
                  () => rej(new Error('deposit timeout')),
                  Math.min(input.timeoutMs * 0.55, 800_000),
                ),
              ),
            ]);
            result.depositStatus =
              typeof depositOutcome === 'string'
                ? { type: 'string', length: depositOutcome.length, preview: depositOutcome.slice(0, 64) }
                : {
                    type: typeof depositOutcome,
                    status: depositOutcome?.status ?? null,
                    code: depositOutcome?.code ?? null,
                    message:
                      typeof depositOutcome?.message === 'string'
                        ? depositOutcome.message.slice(0, 500)
                        : null,
                    json: depositOutcome?.toJSON
                      ? (() => {
                          try {
                            return depositOutcome.toJSON();
                          } catch {
                            return null;
                          }
                        })()
                      : null,
                  };
          } catch (e) {
            const msg = String(e?.message || e);
            result.depositError = msg.slice(0, 2000);
            if (/BROADCAST_BLOCKED/.test(msg)) {
              result.blockers.push('sendTransaction blocked as designed (no broadcast)');
            }
          }
          result.depositMs = Date.now() - started;
          result.progressEvents = progress.slice();

          try {
            client.dispose();
          } catch {
            /* ignore */
          }
          return result;
        } catch (e) {
          result.errors.push(String(e?.message || e).slice(0, 800));
          result.progressEvents = progress.slice();
          try {
            client?.dispose?.();
          } catch {
            /* ignore */
          }
          return result;
        } finally {
          globalThis.fetch = originalFetch;
        }
      },
      {
        rpcUrl: RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        expectedAddress: EXPECTED_SENDER,
        poolContract: POOL,
        depositStroops: String(DEPOSIT_STROOPS),
        contractConfig,
        circuitLock,
        timeoutMs: TIMEOUT_MS,
      },
    );

    Object.assign(out, {
      addressMatched: pageResult.addressMatched === true,
      observedAddress: pageResult.observedAddress,
      wasmOk: pageResult.wasmOk === true,
      proverOk: pageResult.proverOk === true,
      opfsOk: pageResult.opfsOk === true,
      clientOk: pageResult.clientOk === true,
      derivePrivacyKeysOk: pageResult.derivePrivacyKeysOk === true,
      syncOk: pageResult.syncOk ?? null,
      isRegistered: pageResult.isRegistered,
      writePoolReady: pageResult.writePoolReady === true,
      poolBoundOk: pageResult.poolBoundOk === true,
      poolFee: pageResult.poolFee ?? null,
      noteCount: pageResult.noteCount,
      balanceStroops: pageResult.balanceStroops,
      depositStatus: pageResult.depositStatus,
      depositError: pageResult.depositError,
      depositMs: pageResult.depositMs,
      progressEvents: pageResult.progressEvents || [],
      rpcMethodsSeen: [...new Set(pageResult.rpcMethodsSeen || [])],
      blockedSendTransactionCount: pageResult.blockedSendTransactionCount || 0,
      simulateCaptures: (pageResult.simulateCaptures || []).map((c) => ({
        atMs: c.atMs,
        requestId: c.requestId,
        transactionXdrCount: Array.isArray(c.transactionXdrs) ? c.transactionXdrs.length : 0,
        transactionXdrLengths: c.transactionXdrLengths || [],
        transactionXdrs: c.transactionXdrs || [],
        response: c.response,
      })),
      errors: [...out.errors, ...(pageResult.errors || [])],
      blockers: [...out.blockers, ...(pageResult.blockers || [])],
    });

    out.broadcastAttempted = out.blockedSendTransactionCount > 0;
    out.onChainSubmit = false;

    const stages = (out.progressEvents || []).map((p) => String(p.stage || ''));
    const messages = (out.progressEvents || []).map((p) => String(p.message || ''));
    const proved =
      stages.some((s) => /prov/i.test(s)) || messages.some((m) => /proof|Proving/i.test(m));
    const simulated = stages.some((s) => /simul/i.test(s));
    out.proofGenerated = {
      ok: proved,
      path: 'PrivatePool.deposit → prove_next (TX_PROGRESS stage=prove)',
      stages,
      messages: messages.slice(0, 12),
    };

    const allXdrs = [];
    for (const cap of out.simulateCaptures) {
      for (const x of cap.transactionXdrs || []) {
        if (typeof x === 'string' && x.length > 0) allXdrs.push(x);
      }
    }
    out.capturedXdrs = allXdrs;
    out.capturedXdrCount = allXdrs.length;

    if (allXdrs.length >= 1) {
      const last = allXdrs[allXdrs.length - 1];
      out.unsignedOrPreparedTxXdr = last;
      out.transactionFingerprint = fingerprintXdr(last);
      out.fingerprintOf =
        allXdrs.length === 1
          ? 'last_successful_or_attempted_simulate_xdr (only one captured)'
          : 'last_successful_or_attempted_simulate_xdr (multiple captures; using LAST as canonical)';
      out.txMeta = parseTxMeta(last);
    } else {
      out.unsignedOrPreparedTxXdr = null;
      out.transactionFingerprint = null;
      out.fingerprintOf = 'none — no simulateTransaction XDR captured';
      out.blockers.push('No simulateTransaction XDR captured for fingerprint');
    }

    const honesty = classifySimulationHonesty(out.simulateCaptures);
    out.simulationHonesty = honesty;
    out.simulationEvidence =
      honesty.minResourceFee != null
        ? {
            minResourceFee: honesty.minResourceFee,
            cost: honesty.cost,
            source: 'simulateTransaction RPC response (not invented)',
            status: honesty.status,
            contractError: honesty.contractError ?? null,
            contractErrorName: honesty.contractErrorName ?? null,
            simulatedStageObserved: simulated,
          }
        : {
            minResourceFee: null,
            cost: honesty.cost,
            source: 'unavailable — fees not invented',
            status: honesty.status,
            error: honesty.error,
            contractError: honesty.contractError ?? null,
            contractErrorName: honesty.contractErrorName ?? null,
            simulatedStageObserved: simulated,
          };

    if (honesty.status !== 'succeeded') {
      out.blockers.push(
        `Simulation not successful (${honesty.label}) — do not treat as ready-to-broadcast`,
      );
    }
  } finally {
    try {
      await context?.close();
    } catch {
      /* ignore */
    }
  }

  return out;
}

function proposeFeeCeiling(honesty) {
  const policy = POLICY_MAX_FEE_STROOPS;
  if (honesty?.status === 'succeeded' && honesty.minResourceFee != null) {
    const min = Number(honesty.minResourceFee);
    // Defensible ask = minResourceFee + 200k inclusion headroom. NEVER auto-raise policy.
    const defensibleNeed = Math.ceil(min + 200_000);
    const exceedsPolicy = defensibleNeed > policy;
    return {
      policyCeilingStroops: policy,
      simulateMinResourceFee: min,
      defensibleNeedStroops: defensibleNeed,
      // Packet maxFee stays at policy — human must explicitly raise policy before broadcast.
      proposedMaxFeeStroops: policy,
      raisedPolicy: false,
      exceedsPolicy,
      policyGapStroops: exceedsPolicy ? defensibleNeed - policy : 0,
      basis: exceedsPolicy
        ? `simulate minResourceFee=${min} (+200k inclusion → ${defensibleNeed}) EXCEEDS policy ${policy}; cap NOT raised — broadcast under current policy would be FEE_CEILING-blocked`
        : `simulate minResourceFee=${min} (+200k inclusion → ${defensibleNeed}) within policy ${policy}`,
      withinPolicy: !exceedsPolicy,
    };
  }
  return {
    policyCeilingStroops: policy,
    proposedMaxFeeStroops: policy,
    raisedPolicy: false,
    exceedsPolicy: false,
    basis:
      'No successful deposit simulation fee — retain existing 8_000_000 stroop policy cap; do not raise',
    withinPolicy: true,
    simulationStatus: honesty?.status ?? 'unknown',
  };
}

function buildPacketMd(packet, evidence) {
  const op = packet.operations[0];
  const honesty = evidence.prepare?.simulationHonesty;
  const fee = evidence.feeProposal;
  const lines = [
    '# ASTRYM — Deposit-only approval packet',
    '',
    `Prepared (UTC): ${packet.preparedAt}`,
    `Version: \`${packet.version}\``,
    '',
    '## Verdict',
    '',
    `- Broadcast gates: **ALL OFF** (global mutator, registration, deposit)`,
    `- Simulation: **${honesty?.status ?? 'unknown'}** (${honesty?.label ?? 'n/a'})`,
    `- Proof generated: **${evidence.prepare?.proofGenerated?.ok === true}**`,
    `- Sender isRegistered (SDK): **${evidence.prepare?.isRegistered}**`,
    `- write_pool_ready: **${evidence.prepare?.writePoolReady}**`,
    `- On-chain submit: **false** (sendTransaction blocked)`,
    '',
    '## Approved operation (deposit only)',
    '',
    `| Field | Value |`,
    `| --- | --- |`,
    `| operation | deposit |`,
    `| sender | \`${op.sourceAddress}\` |`,
    `| pool | \`${op.poolContract}\` |`,
    `| amount | ${op.amountXlm} XLM (${op.amountStroops} stroops) |`,
    `| sequenceAtApproval | \`${op.sequenceAtApproval}\` |`,
    `| network | testnet / \`${packet.networkPassphrase}\` |`,
    `| kdf_domain | ${packet.kdf_domain} |`,
    `| transport | ${packet.transport} |`,
    `| maxFeeStroops | ${op.maxFeeStroops} |`,
    `| fingerprint | \`${op.transactionFingerprint}\` |`,
    '',
    '## Unsigned transaction',
    '',
    `- Fingerprint algorithm: sha256(base64decode(xdr)).hex`,
    `- Exact XDR length: ${evidence.prepare?.unsignedOrPreparedTxXdr?.length ?? 0}`,
    `- XDR file field: \`deposit-approval-packet.json\` → \`operations[0]\` companion evidence \`unsignedOrPreparedTxXdr\``,
    '',
    '```',
    evidence.prepare?.unsignedOrPreparedTxXdr
      ? evidence.prepare.unsignedOrPreparedTxXdr.slice(0, 120) + '…'
      : '(no XDR captured)',
    '```',
    '',
    '## Fee / exposure',
    '',
    `- Policy deposit ceiling: ${fee.policyCeilingStroops} stroops (NOT raised)`,
    `- Proposed max fee: ${fee.proposedMaxFeeStroops} stroops`,
    `- Basis: ${fee.basis}`,
    `- Pool protocol fee (application, not gas): ${evidence.pool?.get_fee?.value ?? '?'} stroops`,
    `- Note amount: ${op.amountStroops} stroops`,
    `- Approx native exposure if broadcast: note + pool fee + maxFee ≤ ${Number(op.amountStroops) + Number(evidence.pool?.get_fee?.value || 0) + Number(fee.proposedMaxFeeStroops)} stroops`,
    '',
    '## Simulation evidence',
    '',
    '```json',
    JSON.stringify(evidence.prepare?.simulationEvidence ?? null, null, 2),
    '```',
    '',
    '## Authorization scope',
    '',
    '- Deposit-scoped gate only; does **not** authorize register_public_keys, transfer, or withdraw.',
    '- Global mutator gate remains OFF.',
    '- Registration gate remains OFF.',
    '',
    '## Risks',
    '',
    ...(evidence.risks || []).map((r) => `- ${r}`),
    '',
    '## Gates (must stay OFF until explicit human approval)',
    '',
    '```json',
    JSON.stringify(evidence.gates, null, 2),
    '```',
    '',
  ];
  return lines.join('\n');
}

async function main() {
  if (!SPP_ROOT) fail('Missing packaged SPP root (dist/spp)');
  if (!CIRCUITS_DIR || !existsSync(CIRCUITS_DIR)) fail(`Missing circuits dir: ${CIRCUITS_DIR}`);
  if (!existsSync(CHROME_PATH)) fail(`Missing Chromium at ${CHROME_PATH}`);

  mkdirSync(ARTIFACTS_DIR, { recursive: true });

  const circuitLock = JSON.parse(readFileSync(join(CIRCUITS_DIR, 'circuits.json'), 'utf8'));
  const contractConfig = loadDeployments();
  if (contractConfig.kdf_domain !== KDF_DOMAIN) {
    fail(`expected kdf_domain ${KDF_DOMAIN}, got ${contractConfig.kdf_domain}`);
  }
  const { senderKp } = loadWallets();
  const gates = readGateDefaults();

  log('Refreshing Horizon + pool/registry…');
  const [senderHorizon, recipientHorizon, senderTx, recipientTx, onchain] = await Promise.all([
    refreshHorizonAccount(EXPECTED_SENDER),
    refreshHorizonAccount(EXPECTED_RECIPIENT),
    refreshHorizonTx(SENDER_REG_TX),
    refreshHorizonTx(RECIPIENT_REG_TX),
    readPoolAndRegistry(),
  ]);

  const registrationVerified = {
    sender: {
      tx: senderTx,
      registryEvent: onchain.registryEvents?.senderEvent === true,
      stillSuccessful: senderTx.ok && senderTx.successful === true,
    },
    recipient: {
      tx: recipientTx,
      registryEvent: onchain.registryEvents?.recipientEvent === true,
      stillSuccessful: recipientTx.ok && recipientTx.successful === true,
    },
    note:
      'Registry contract has no is_registered export; verification = SUCCESS Horizon txs + public_key_event topics matching both accounts + SDK Account.isRegistered after sync',
  };

  if (!registrationVerified.sender.stillSuccessful || !registrationVerified.recipient.stillSuccessful) {
    fail('Registration txs no longer successful on Horizon — aborting deposit prepare');
  }

  const poolFee = onchain.pool?.get_fee?.value;
  const poolOk =
    onchain.pool?.get_kdf_domain?.value === KDF_DOMAIN &&
    onchain.pool?.deposits_paused?.value === false &&
    String(poolFee) === '1000000';

  if (!poolOk) {
    log(`WARNING: pool verification unexpected: ${JSON.stringify(onchain.pool)}`);
  }

  const serveRoot = join(tmpdir(), `spp-deposit-${randomBytes(4).toString('hex')}`);
  mkdirSync(serveRoot, { recursive: true });
  writeHarnessHtml(serveRoot);
  const { server, origin } = await startOverlayServer(serveRoot, SPP_ROOT);
  log(`overlay ${origin} → ${SPP_ROOT}`);

  let prepare;
  try {
    prepare = await prepareDeposit({
      origin,
      contractConfig,
      circuitLock,
      horizon: senderHorizon,
      senderKp,
    });
  } finally {
    await new Promise((r) => server.close(r));
  }

  const feeProposal = proposeFeeCeiling(prepare.simulationHonesty);
  // Packet maxFee uses proposed (≤ policy). Never above policy.
  const packetMaxFee = String(feeProposal.proposedMaxFeeStroops);

  const risks = [];
  if (prepare.simulationHonesty?.status !== 'succeeded') {
    risks.push(
      `Simulation status=${prepare.simulationHonesty?.status}: ${prepare.simulationHonesty?.note || prepare.simulationHonesty?.error || 'see evidence'}`,
    );
  }
  if (feeProposal.exceedsPolicy) {
    risks.push(
      `FEE POLICY CONFLICT: simulate minResourceFee=${feeProposal.simulateMinResourceFee} (defensible need ${feeProposal.defensibleNeedStroops}) exceeds deposit policy ceiling ${feeProposal.policyCeilingStroops} by ${feeProposal.policyGapStroops} stroops — policy NOT raised; deposit-scoped auth will FEE_CEILING-reject any maxFee above 8_000_000`,
    );
  }
  if (prepare.simulationHonesty?.contractError === 6) {
    risks.push(
      'Contract Error #6 WrongExtAmount: proof.public_amount must equal ext_amount − pool_fee; investigate SDK fee accounting if still failing post-registration',
    );
  }
  if (prepare.isRegistered !== true) {
    risks.push('SDK isRegistered was not true after sync — deposit may fail ASP/registry checks');
  }
  risks.push(
    `Native funds at risk if later approved: ${DEPOSIT_XLM} XLM note + ${Number(poolFee) / 1e7} XLM pool fee + up to ${feeProposal.proposedMaxFeeStroops / 1e7} XLM maxFee (gas); actual inclusion may require > policy if human raises ceiling`,
  );
  risks.push('Approval is deposit-only; must not unlock register/transfer/withdraw or global mutator gate');
  risks.push('Sequence drift after approval invalidates the packet (SEQUENCE_DRIFT)');
  risks.push(
    'Harness signed auth entries for simulate/assemble only; sendTransaction was blocked — unsigned XDR fingerprint is the approval binding, not a broadcast signature grant',
  );

  const packet = {
    version: PACKET_VERSION,
    network: 'testnet',
    networkPassphrase: NETWORK_PASSPHRASE,
    kdf_domain: KDF_DOMAIN,
    poolContract: POOL,
    registryContract: REGISTRY,
    transport: 'nym',
    operations: [
      {
        step: 1,
        role: 'sender',
        operation: 'deposit',
        sourceAddress: EXPECTED_SENDER,
        poolContract: POOL,
        amountStroops: String(DEPOSIT_STROOPS),
        amountXlm: DEPOSIT_XLM,
        sequenceAtApproval: prepare.sequenceAtApproval,
        networkPassphrase: NETWORK_PASSPHRASE,
        maxFeeStroops: packetMaxFee,
        transactionFingerprint: prepare.transactionFingerprint,
      },
    ],
    totalMaxFeeExposureStroops: packetMaxFee,
    preparedAt: new Date().toISOString(),
  };

  // Attach full XDR alongside packet for review (not inside operations to keep packet lean)
  const packetWithXdr = {
    ...packet,
    unsignedTransactionXdr: prepare.unsignedOrPreparedTxXdr,
    unsignedTransactionXdrLength: prepare.unsignedOrPreparedTxXdr?.length ?? 0,
    fingerprintAlgorithm: prepare.fingerprintAlgorithm,
    simulationHonesty: prepare.simulationHonesty,
    feeProposal,
    gatesRemainOff: true,
    authorizationScope: {
      deposit: 'packet-gated (currently OFF)',
      register_public_keys: 'NOT authorized by this packet',
      transfer: 'NOT authorized by this packet',
      withdraw: 'NOT authorized by this packet',
      globalMutatorGate: 'OFF — must stay OFF',
    },
  };

  const evidence = {
    sampledAt: new Date().toISOString(),
    sampledAtEuropeParis: new Date().toLocaleString('en-GB', { timeZone: 'Europe/Paris' }) + ' Europe/Paris',
    sdkRoot: SPP_ROOT,
    circuitLock: {
      version: circuitLock.version,
      commit: circuitLock.meta?.commit ?? null,
      hasKeyOwnership: Boolean(circuitLock.keyOwnership),
    },
    amount: { stroops: String(DEPOSIT_STROOPS), xlm: DEPOSIT_XLM },
    horizon: { sender: senderHorizon, recipient: recipientHorizon },
    registrationVerified,
    pool: onchain.pool,
    registry: onchain.registry,
    registryEvents: onchain.registryEvents,
    gates,
    nym: {
      packetTransport: 'nym',
      prepareRpcPath: 'clearnet_soroban_rpc_with_sendTransaction_blocked',
      note: 'Prepare uses clearnet RPC for prove/simulate evidence only; approved broadcast path remains Nym MixFetch when gates are later enabled',
      priorMixFetchProbe: '/opt/cursor/artifacts/nym-mixfetch-live-probe.json',
    },
    chromiumHost: {
      executablePath: CHROME_PATH,
      headless: true,
      opfsFeatureFlag: 'FileSystemAccessAPI',
      writePoolReady: prepare.writePoolReady,
      addressMatched: prepare.addressMatched,
      realAccountBinding: prepare.observedAddress === EXPECTED_SENDER,
    },
    prepare,
    feeProposal,
    risks,
    onChainSubmit: false,
    broadcastGatesFlipped: false,
  };

  writeJson(EVIDENCE_PATH, evidence);
  writeJson(PACKET_PATH, packetWithXdr);
  writeFileSync(PACKET_MD_PATH, buildPacketMd(packet, evidence));

  log(`evidence → ${EVIDENCE_PATH}`);
  log(`packet   → ${PACKET_PATH}`);
  log(`markdown → ${PACKET_MD_PATH}`);
  log(
    `sim=${prepare.simulationHonesty?.status} proof=${prepare.proofGenerated?.ok} isRegistered=${prepare.isRegistered} write_pool_ready=${prepare.writePoolReady} xdrLen=${prepare.unsignedOrPreparedTxXdr?.length ?? 0}`,
  );

  // Exit 0 even if simulate failed — packet is for human review; honesty is labeled.
  if (!prepare.transactionFingerprint) {
    process.exitCode = 2;
  }
}

main().catch((e) => {
  console.error('[spp-deposit-prepare] fatal', e);
  process.exit(1);
});
