#!/usr/bin/env node
/**
 * Prepare REAL Account.registerPublicKeys() transactions for BOTH disposable
 * Testnet wallets WITHOUT broadcasting.
 *
 * Patterns reused from spp-groth16-local-prove.mjs / spp-dual-account-write-ready.mjs:
 *   - Playwright Chromium + static spp asset overlay server
 *   - Keypair WalletSigner via Node exposeFunction (S… never enters page source)
 *   - fetch interceptor: allow get* and simulateTransaction; BLOCK sendTransaction
 *
 * Writes (no secrets):
 *   /opt/cursor/artifacts/registration/register-prepare-evidence.json
 *   /opt/cursor/artifacts/registration/registration-approval-packet.json
 *
 * Usage (from packages/extension):
 *   node scripts/spp-register-prepare.mjs
 *   SPP_REGISTER_TIMEOUT_MS=900000 node scripts/spp-register-prepare.mjs
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
} = require('@stellar/stellar-sdk');

/** SEP-0053 prefix + SHA-256 (matches Freighter / SppWalletSignerAdapter). */
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

/**
 * Prefer SPP_REGISTER_SDK_ROOT when set (KeyOwnership-capable overlay matching
 * Nethermind circuits-v0.7). Published npm@0.2.1 WASM lacks keyOwnership and
 * builds register(account) without proof → MismatchingParameterLen on-chain.
 */
const SPP_ROOT_CANDIDATES = [
  process.env.SPP_REGISTER_SDK_ROOT,
  join(EXTENSION_ROOT, 'dist', 'spp'),
  join(EXTENSION_ROOT, 'public', 'spp'),
].filter(Boolean);
const SPP_ROOT = SPP_ROOT_CANDIDATES.find((p) => existsSync(join(p, 'js', 'index.js')));
const CIRCUITS_DIR = SPP_ROOT ? join(SPP_ROOT, 'dist', 'circuits') : null;
const ARTIFACTS_DIR =
  process.env.SPP_REGISTER_ARTIFACTS_DIR || '/opt/cursor/artifacts/registration';
const EVIDENCE_PATH = join(ARTIFACTS_DIR, 'register-prepare-evidence.json');
const PACKET_PATH = join(ARTIFACTS_DIR, 'registration-approval-packet.json');
const WALLETS_PATH = process.env.SPP_E2E_WALLETS_PATH || '/tmp/spp-e2e-test-wallets.json';
const RPC_URL = process.env.SPP_RPC_URL || 'https://soroban-testnet.stellar.org';
const HORIZON_URL = process.env.SPP_HORIZON_URL || 'https://horizon-testnet.stellar.org';
const POOL = 'CAMWBUWHYXEGBM3Q7M5DBGW7LLJL3I4QGANQEZFEWLRNTOJMTT2WG24U';
const REGISTRY = 'CARXHKOPSGMUMFRDI72KNCRENVOTCJIGXPCPYOW42APDY2NEYF7CLKIL';
const EXPECTED_SENDER = 'GDH76ERJT7WSYBV7A3VDZ4UTK7QFXWSBIS7ZRR6DNYTUHIRFRXBR5R7F';
const EXPECTED_RECIPIENT = 'GDJ7V7FI7K6CRWM6XOLHZML6WIHCD3XTW7LRBAQZJCI4FDCDCHUYYY37';
const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
const KDF_DOMAIN = 'Nethermind';
/** Policy ceiling per register_public_keys (SPP_PROPOSED_MAX_FEE_STROOPS). */
const MAX_FEE_STROOPS = 5_000_000;
const TOTAL_MAX_FEE_EXPOSURE = 10_000_000;
const PACKET_VERSION = '2026-11-04-register-v1';
const TIMEOUT_MS = Number(process.env.SPP_REGISTER_TIMEOUT_MS || 900_000);
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
  console.error(`[spp-register-prepare] FAIL: ${message}`);
  process.exit(1);
}

function log(msg) {
  console.log(`[spp-register-prepare] ${msg}`);
}

function loadDeployments() {
  const path = join(
    WORKSPACE_ROOT,
    'packages/wallet-core/src/stellar/spp/nethermind/testnet-deployments.json',
  );
  return JSON.parse(readFileSync(path, 'utf8'));
}

function loadWallets() {
  if (!existsSync(WALLETS_PATH)) {
    fail(`Missing wallets file at ${WALLETS_PATH}`);
  }
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
  return {
    accounts: [
      {
        step: 1,
        role: 'sender',
        kp: senderKp,
        expectedAddress: EXPECTED_SENDER,
      },
      {
        step: 2,
        role: 'recipient',
        kp: recipientKp,
        expectedAddress: EXPECTED_RECIPIENT,
      },
    ],
  };
}

function writeHarnessHtml(root) {
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>SPP register prepare</title></head>
<body>
<h1>SPP registerPublicKeys prepare (no broadcast)</h1>
<pre id="out">boot</pre>
<script type="module">
window.__SPP_REGISTER__ = { ready: false, result: null, errors: [] };
document.getElementById('out').textContent = 'module-ready';
window.__SPP_REGISTER__.ready = true;
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

/**
 * Fingerprint = sha256 of decoded XDR bytes, digest as hex.
 * Documented in evidence as fingerprintAlgorithm.
 */
function fingerprintXdr(xdrB64) {
  const bytes = Buffer.from(String(xdrB64), 'base64');
  return createHash('sha256').update(bytes).digest('hex');
}

function fingerprintConcatenatedXdrs(xdrList) {
  const joined = Buffer.concat(xdrList.map((x) => Buffer.from(String(x), 'base64')));
  return createHash('sha256').update(joined).digest('hex');
}

async function refreshHorizonAccount(address) {
  const url = `${HORIZON_URL}/accounts/${address}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 400);
    return {
      ok: false,
      address,
      httpStatus: res.status,
      error: body,
      sequence: null,
      balanceXlm: null,
      subentryCount: null,
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
  const error = last.response?.error ? String(last.response.error).slice(0, 800) : null;
  const rpcError = last.response?.rpcError ? String(last.response.rpcError).slice(0, 400) : null;

  if (last.response?.parseError && !last.response?.rawStatus) {
    return {
      status: 'incomplete',
      label: 'incomplete_simulate_response_unparsed',
      minResourceFee,
      cost,
      error: last.response.parseError,
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
      note: minResourceFee
        ? 'Simulate returned error but still reported minResourceFee — recorded as simulationEvidence only'
        : 'Simulate failed without minResourceFee — ceiling remains policy 5_000_000 stroops',
    };
  }
  if (minResourceFee != null) {
    return {
      status: 'succeeded',
      label: 'simulate_succeeded_with_minResourceFee',
      minResourceFee,
      cost,
      error: null,
      note: 'minResourceFee from RPC simulate response; policy ceiling still 5_000_000 stroops',
    };
  }
  return {
    status: 'incomplete',
    label: 'incomplete_simulate_no_minResourceFee',
    minResourceFee: null,
    cost,
    error: null,
    note: 'Simulate response lacked minResourceFee — fees not invented',
  };
}

async function prepareOneAccount({ account, origin, contractConfig, circuitLock, horizon }) {
  const role = account.role;
  const expectedAddress = account.expectedAddress;
  const out = {
    step: account.step,
    role,
    sourceAddress: expectedAddress,
    addressMatched: false,
    observedAddress: null,
    horizon,
    sequenceAtApproval: horizon?.sequence ?? null,
    wasmOk: false,
    proverOk: false,
    opfsOk: false,
    clientOk: false,
    derivePrivacyKeysOk: false,
    isRegisteredBefore: null,
    isRegisteredAfter: null,
    registerResult: null,
    registerError: null,
    registerMs: null,
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
    maxFeeStroops: String(MAX_FEE_STROOPS),
    maxFeeSource: 'SPP_PROPOSED_MAX_FEE_STROOPS.register_public_keys',
    broadcastAttempted: false,
    onChainSubmit: false,
    secretsIncluded: false,
    errors: [],
    blockers: [],
  };

  const userDataDir = join(
    tmpdir(),
    `spp-register-${role}-${randomBytes(4).toString('hex')}`,
  );
  mkdirSync(userDataDir, { recursive: true });
  out.userDataDir = userDataDir;

  /** @type {import('@stellar/stellar-sdk').Keypair} */
  const kp = account.kp;
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
      // Never retain lines that look like secrets
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
      if (typeof tx.sign !== 'function') {
        throw new Error('Fee-bump / unsupported envelope');
      }
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
    await page.waitForFunction(() => window.__SPP_REGISTER__?.ready === true);

    log(`${role}: starting page evaluate (timeout ${TIMEOUT_MS}ms)`);

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
          isRegisteredBefore: null,
          isRegisteredAfter: null,
          registerResult: null,
          registerError: null,
          registerMs: null,
          progressEvents: [],
          rpcMethodsSeen: [],
          blockedSendTransactionCount: 0,
          simulateCaptures: [],
          errors: [],
          blockers: [],
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
              const cloned = fetchInput.clone();
              return await cloned.text();
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
          if (typeof params === 'string' && params.length > 20) {
            found.push(params);
          } else if (params && typeof params === 'object') {
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
          if (!json || typeof json !== 'object') {
            return { parseError: 'non-object response' };
          }
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
            error: r.error ? String(r.error).slice(0, 1200) : null,
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
              'BROADCAST_BLOCKED: sendTransaction denied by spp-register-prepare harness',
            );
          }

          // Allow get* / simulateTransaction / everything else except send.
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
            throw new Error(
              'circuitLock.keyOwnership missing — cannot build KeyOwnershipProof for register',
            );
          }

          const proverWorkerUrl = new URL('./dist/workers/prover-worker.js', location.href).href;
          const prover = spp.ProverBridge.spawn(proverWorkerUrl);
          await prover.configureCircuitsBase(circuitsBaseUrl, JSON.stringify(input.circuitLock));
          await prover.ping();
          result.proverOk = true;

          // Encrypted OPFS storage (circuits-v0.7 / KeyOwnership SDK): keyProvider
          // returns a fresh ephemeral 32-byte key; createNew for clean harness DB.
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
            result.blockers.push('signer public key does not match expected address');
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
            result.isRegisteredBefore = await accountHandle.isRegistered();
          } catch (e) {
            result.errors.push(`isRegisteredBefore: ${String(e?.message || e).slice(0, 300)}`);
            result.isRegisteredBefore = null;
          }

          const started = Date.now();
          try {
            const regOutcome = await Promise.race([
              accountHandle.registerPublicKeys(),
              new Promise((_, rej) =>
                setTimeout(
                  () => rej(new Error('registerPublicKeys timeout')),
                  Math.min(input.timeoutMs * 0.55, 800_000),
                ),
              ),
            ]);
            result.registerResult =
              typeof regOutcome === 'string'
                ? { type: 'string', length: regOutcome.length, preview: regOutcome.slice(0, 64) }
                : { type: typeof regOutcome, value: String(regOutcome).slice(0, 200) };
          } catch (e) {
            const msg = String(e?.message || e);
            result.registerError = msg.slice(0, 1200);
            if (/BROADCAST_BLOCKED/.test(msg)) {
              result.blockers.push('sendTransaction blocked as designed (no broadcast)');
            }
          }
          result.registerMs = Date.now() - started;

          try {
            result.isRegisteredAfter = await accountHandle.isRegistered();
          } catch (e) {
            result.errors.push(`isRegisteredAfter: ${String(e?.message || e).slice(0, 300)}`);
            result.isRegisteredAfter = null;
          }

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
        expectedAddress,
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
      isRegisteredBefore: pageResult.isRegisteredBefore,
      isRegisteredAfter: pageResult.isRegisteredAfter,
      registerResult: pageResult.registerResult,
      registerError: pageResult.registerError,
      registerMs: pageResult.registerMs,
      progressEvents: pageResult.progressEvents || [],
      rpcMethodsSeen: [...new Set(pageResult.rpcMethodsSeen || [])],
      blockedSendTransactionCount: pageResult.blockedSendTransactionCount || 0,
      simulateCaptures: (pageResult.simulateCaptures || []).map((c) => ({
        atMs: c.atMs,
        requestId: c.requestId,
        transactionXdrCount: Array.isArray(c.transactionXdrs) ? c.transactionXdrs.length : 0,
        transactionXdrLengths: c.transactionXdrLengths || [],
        // Keep full XDR(s) for prepared-tx artifact; secrets scrubbed on write.
        transactionXdrs: c.transactionXdrs || [],
        response: c.response,
      })),
      errors: [...out.errors, ...(pageResult.errors || [])],
      blockers: [...out.blockers, ...(pageResult.blockers || [])],
    });

    out.broadcastAttempted = out.blockedSendTransactionCount > 0;
    out.onChainSubmit = false;

    // Flatten captured XDRs in order
    const allXdrs = [];
    for (const cap of out.simulateCaptures) {
      for (const x of cap.transactionXdrs || []) {
        if (typeof x === 'string' && x.length > 0) allXdrs.push(x);
      }
    }
    out.capturedXdrs = allXdrs;
    out.capturedXdrCount = allXdrs.length;

    if (allXdrs.length === 1) {
      out.unsignedOrPreparedTxXdr = allXdrs[0];
      out.transactionFingerprint = fingerprintXdr(allXdrs[0]);
      out.fingerprintOf = 'last_successful_or_attempted_simulate_xdr (only one captured)';
      out.allCapturedXdrs = allXdrs;
    } else if (allXdrs.length > 1) {
      // Prefer last simulate XDR for fingerprint + approval (earlier captures may be
      // probe/deployer reads). Canonical approved XDR is the LAST string, not an array.
      const last = allXdrs[allXdrs.length - 1];
      out.unsignedOrPreparedTxXdr = last;
      out.transactionFingerprint = fingerprintXdr(last);
      out.fingerprintOf =
        'last_successful_or_attempted_simulate_xdr (multiple captures; using LAST as canonical)';
      out.allCapturedXdrs = allXdrs;
      out.transactionFingerprintConcatAlternative = fingerprintConcatenatedXdrs(allXdrs);
      out.fingerprintConcatNote =
        'Alternative sha256 of concatenated base64-decoded XDR bytes across all captures';
    } else {
      out.unsignedOrPreparedTxXdr = null;
      out.transactionFingerprint = null;
      out.fingerprintOf = 'none — no simulateTransaction XDR captured';
      out.allCapturedXdrs = [];
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
          }
        : {
            minResourceFee: null,
            cost: honesty.cost,
            source: 'unavailable — fees not invented',
            status: honesty.status,
            error: honesty.error,
          };

    if (out.isRegisteredBefore === true) {
      out.blockers.push('isRegisteredBefore unexpectedly true');
    }
    if (out.isRegisteredAfter === true) {
      out.blockers.push('isRegisteredAfter true after prepare — possible unintended broadcast');
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

async function main() {
  if (!SPP_ROOT) fail('Missing packaged SPP root (dist/spp or public/spp)');
  if (!CIRCUITS_DIR || !existsSync(CIRCUITS_DIR)) fail(`Missing circuits dir under ${SPP_ROOT}`);
  if (!existsSync(CHROME_PATH)) fail(`Missing Chromium at ${CHROME_PATH}`);

  const contractConfig = loadDeployments();
  if (contractConfig.kdf_domain !== KDF_DOMAIN) {
    fail(`expected kdf_domain ${KDF_DOMAIN}, got ${contractConfig.kdf_domain}`);
  }
  if (contractConfig.network !== 'testnet') {
    fail(`expected network testnet, got ${contractConfig.network}`);
  }
  if (contractConfig.public_key_registry !== REGISTRY) {
    fail(`registry mismatch: ${contractConfig.public_key_registry}`);
  }
  const poolOk = Array.isArray(contractConfig.pools)
    ? contractConfig.pools.some((p) => p.poolContractId === POOL)
    : false;
  if (!poolOk) fail(`pool ${POOL} not found in deployments`);

  const circuitLock = JSON.parse(readFileSync(join(CIRCUITS_DIR, 'circuits.json'), 'utf8'));
  if (!circuitLock.keyOwnership || typeof circuitLock.keyOwnership !== 'object') {
    fail(
      'circuitLock missing keyOwnership — Nethermind registry requires KeyOwnershipProof; use SPP_REGISTER_SDK_ROOT with circuits-v0.7 SDK',
    );
  }
  if (String(circuitLock.version) !== '0.7') {
    fail(`expected circuits lock version 0.7 for Nethermind registry, got ${circuitLock.version}`);
  }
  log(`SPP_ROOT=${SPP_ROOT}`);
  log(
    `circuitLock version=${circuitLock.version} commit=${circuitLock.meta?.commit ?? 'n/a'} keyOwnership=present`,
  );
  const { accounts } = loadWallets();

  log('Refreshing Horizon sequences/balances (clearnet READ for prep evidence)…');
  const horizonByAddress = {};
  for (const acct of accounts) {
    const h = await refreshHorizonAccount(acct.expectedAddress);
    horizonByAddress[acct.expectedAddress] = h;
    log(
      `${acct.role}: horizon ok=${h.ok} sequence=${h.sequence ?? 'n/a'} balanceXlm=${h.balanceXlm ?? 'n/a'}`,
    );
  }

  const serveRoot = join(tmpdir(), `spp-register-${randomBytes(4).toString('hex')}`);
  mkdirSync(serveRoot, { recursive: true });
  writeHarnessHtml(serveRoot);
  const { server, origin } = await startOverlayServer(serveRoot, SPP_ROOT);
  log(`Serving SPP assets at ${origin}`);

  const accountResults = [];
  try {
    for (const account of accounts) {
      log(`=== Preparing registerPublicKeys for ${account.role} (${account.expectedAddress}) ===`);
      const result = await prepareOneAccount({
        account,
        origin,
        contractConfig,
        circuitLock,
        horizon: horizonByAddress[account.expectedAddress],
      });
      accountResults.push(result);
      log(
        `${account.role}: xdrs=${result.capturedXdrCount || 0} fingerprint=${
          result.transactionFingerprint ? result.transactionFingerprint.slice(0, 16) + '…' : 'NONE'
        } sim=${result.simulationHonesty?.status ?? 'n/a'} blockedSend=${
          result.blockedSendTransactionCount
        } isRegisteredBefore=${result.isRegisteredBefore} after=${result.isRegisteredAfter}`,
      );
    }
  } finally {
    try {
      server.close();
    } catch {
      /* ignore */
    }
  }

  const preparedAt = new Date().toISOString();
  const bothHaveXdr = accountResults.every(
    (a) => a.transactionFingerprint && a.capturedXdrCount > 0,
  );

  const evidence = {
    sampledAt: preparedAt,
    sdkVersion: '0.2.1',
    harness: 'spp-register-prepare.mjs',
    network: 'testnet',
    networkPassphrase: NETWORK_PASSPHRASE,
    kdf_domain: KDF_DOMAIN,
    poolContract: POOL,
    registryContract: REGISTRY,
    rpcUrl: RPC_URL,
    horizonUrl: HORIZON_URL,
    transportPolicy: {
      prepareEvidenceReads: 'clearnet_horizon_and_soroban_rpc',
      approvalPacketTransport: 'nym',
      note: 'Horizon/RPC clearnet used only to refresh sequences and capture simulate XDR; broadcast remains blocked; packet transport field is nym',
    },
    feePolicy: {
      perRegisterMaxFeeStroops: MAX_FEE_STROOPS,
      totalMaxFeeExposureStroops: TOTAL_MAX_FEE_EXPOSURE,
      source: 'SPP_PROPOSED_MAX_FEE_STROOPS.register_public_keys',
      inventedFees: false,
    },
    broadcastAuthorized: false,
    globalMutatorGate: false,
    registrationScopedGate: false,
    secretsIncluded: false,
    secretsLogged: false,
    bothPreparesCapturedXdrAndFingerprint: bothHaveXdr,
    accounts: accountResults.map((a) => ({
      step: a.step,
      role: a.role,
      sourceAddress: a.sourceAddress,
      addressMatched: a.addressMatched,
      sequenceAtApproval: a.sequenceAtApproval,
      horizon: {
        ok: a.horizon?.ok ?? false,
        sequence: a.horizon?.sequence ?? null,
        balanceXlm: a.horizon?.balanceXlm ?? null,
        subentryCount: a.horizon?.subentryCount ?? null,
        transportNote: a.horizon?.transportNote ?? null,
      },
      wasmOk: a.wasmOk,
      proverOk: a.proverOk,
      opfsOk: a.opfsOk,
      clientOk: a.clientOk,
      derivePrivacyKeysOk: a.derivePrivacyKeysOk,
      syncOk: a.syncOk ?? null,
      isRegisteredBefore: a.isRegisteredBefore,
      isRegisteredAfter: a.isRegisteredAfter,
      registerError: a.registerError,
      registerResult: a.registerResult,
      registerMs: a.registerMs,
      progressEvents: a.progressEvents,
      rpcMethodsSeen: a.rpcMethodsSeen,
      blockedSendTransactionCount: a.blockedSendTransactionCount,
      broadcastAttempted: a.broadcastAttempted,
      onChainSubmit: a.onChainSubmit,
      capturedXdrCount: a.capturedXdrCount,
      unsignedOrPreparedTxXdr: a.unsignedOrPreparedTxXdr,
      transactionFingerprint: a.transactionFingerprint,
      fingerprintOf: a.fingerprintOf,
      fingerprintAlgorithm: a.fingerprintAlgorithm,
      transactionFingerprintConcatAlternative: a.transactionFingerprintConcatAlternative ?? null,
      fingerprintConcatNote: a.fingerprintConcatNote ?? null,
      simulateCaptures: a.simulateCaptures,
      simulationHonesty: a.simulationHonesty,
      simulationEvidence: a.simulationEvidence,
      maxFeeStroops: a.maxFeeStroops,
      errors: a.errors,
      blockers: a.blockers,
    })),
    blockers: accountResults.flatMap((a) =>
      (a.blockers || []).map((b) => `${a.role}: ${b}`),
    ),
  };

  writeJson(EVIDENCE_PATH, evidence);

  const operations = accountResults.map((a) => {
    const canonicalXdr =
      typeof a.unsignedOrPreparedTxXdr === 'string'
        ? a.unsignedOrPreparedTxXdr
        : Array.isArray(a.unsignedOrPreparedTxXdr)
          ? a.unsignedOrPreparedTxXdr[a.unsignedOrPreparedTxXdr.length - 1]
          : null;
    return {
      step: a.step,
      role: a.role,
      operation: 'register_public_keys',
      sourceAddress: a.sourceAddress,
      sequenceAtApproval: a.sequenceAtApproval ?? '',
      registryContract: REGISTRY,
      networkPassphrase: NETWORK_PASSPHRASE,
      maxFeeStroops: String(MAX_FEE_STROOPS),
      transactionFingerprint: a.transactionFingerprint ?? '',
      unsignedOrPreparedTxXdr: canonicalXdr,
      simulationHonesty: {
        status: a.simulationHonesty?.status ?? 'incomplete',
        label: a.simulationHonesty?.label ?? 'incomplete',
        minResourceFee: a.simulationHonesty?.minResourceFee ?? null,
        note: a.simulationHonesty?.note ?? null,
        error: a.simulationHonesty?.error
          ? String(a.simulationHonesty.error).slice(0, 400)
          : null,
      },
      simulationEvidence: a.simulationEvidence,
    };
  });

  const bothSimSucceeded = operations.every(
    (op) => op.simulationHonesty?.status === 'succeeded' && op.simulationHonesty?.minResourceFee,
  );

  const packet = {
    version: PACKET_VERSION,
    network: 'testnet',
    networkPassphrase: NETWORK_PASSPHRASE,
    kdf_domain: KDF_DOMAIN,
    poolContract: POOL,
    registryContract: REGISTRY,
    pool: POOL,
    registry: REGISTRY,
    transport: 'nym',
    operationScope: 'register_public_keys_only',
    approvedAccounts: [EXPECTED_SENDER, EXPECTED_RECIPIENT],
    operations,
    unsignedOrPreparedTxXdr: operations.map((op) => ({
      step: op.step,
      role: op.role,
      sourceAddress: op.sourceAddress,
      xdr: op.unsignedOrPreparedTxXdr,
      transactionFingerprint: op.transactionFingerprint,
    })),
    feePolicy: {
      perTransactionMaxFeeStroops: String(MAX_FEE_STROOPS),
      totalMaxFeeExposureStroops: String(TOTAL_MAX_FEE_EXPOSURE),
      source: 'SPP_PROPOSED_MAX_FEE_STROOPS.register_public_keys',
      inventedFees: false,
      strongestMethod: 'soroban_rpc_simulateTransaction.minResourceFee',
      note:
        'maxFee ceilings are policy caps. Successful simulate minResourceFee is recorded per op as evidence, not as invented estimates.',
    },
    totalMaxFeeExposureStroops: String(TOTAL_MAX_FEE_EXPOSURE),
    broadcastAuthorized: false,
    globalMutatorGate: false,
    registrationScopedGate: false,
    depositsAuthorized: false,
    privateTransfersAuthorized: false,
    withdrawalsAuthorized: false,
    simulationHonesty: Object.fromEntries(
      operations.map((op) => [op.role, op.simulationHonesty]),
    ),
    bothSimulationsSucceeded: bothSimSucceeded,
    secretsIncluded: false,
    preparedAt,
    fingerprintAlgorithm:
      'sha256(base64decode(last_simulate_xdr_bytes)).digest("hex")',
    prepareEvidencePath: EVIDENCE_PATH,
    bothPreparesCapturedXdrAndFingerprint: bothHaveXdr,
    sdkOverlay: {
      sppRoot: SPP_ROOT,
      circuitLockVersion: circuitLock.version ?? null,
      circuitLockCommit: circuitLock.meta?.commit ?? null,
      keyOwnershipPresent: Boolean(circuitLock.keyOwnership),
      note:
        'Published npm@0.2.1 WASM lacks keyOwnership; prepare used KeyOwnership-capable overlay matching Nethermind circuits-v0.7 / registry register(account, proof).',
    },
  };

  writeJson(PACKET_PATH, packet);

  const summary = {
    evidencePath: EVIDENCE_PATH,
    packetPath: PACKET_PATH,
    bothPreparesCapturedXdrAndFingerprint: bothHaveXdr,
    accounts: accountResults.map((a) => ({
      role: a.role,
      sourceAddress: a.sourceAddress,
      sequenceAtApproval: a.sequenceAtApproval,
      capturedXdrCount: a.capturedXdrCount || 0,
      transactionFingerprint: a.transactionFingerprint,
      fingerprintOf: a.fingerprintOf,
      simulationHonestyStatus: a.simulationHonesty?.status ?? null,
      simulationMinResourceFee: a.simulationEvidence?.minResourceFee ?? null,
      isRegisteredBefore: a.isRegisteredBefore,
      isRegisteredAfter: a.isRegisteredAfter,
      blockedSendTransactionCount: a.blockedSendTransactionCount,
      registerErrorPreview: a.registerError
        ? String(a.registerError).slice(0, 160)
        : null,
      blockers: a.blockers,
    })),
  };
  console.log(JSON.stringify(summary, null, 2));

  if (!bothHaveXdr) {
    process.exitCode = 2;
  }
}

main().catch((err) => {
  try {
    writeJson(EVIDENCE_PATH, {
      sampledAt: new Date().toISOString(),
      errors: [String(err?.stack || err).slice(0, 2000)],
      blockers: ['harness crashed before completion'],
      secretsIncluded: false,
      broadcastAuthorized: false,
    });
  } catch {
    /* ignore */
  }
  fail(err instanceof Error ? err.stack || err.message : String(err));
});
