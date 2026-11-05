#!/usr/bin/env node
/**
 * Dual-account SPP write-readiness (NO broadcast / NO mutators).
 *
 * For EACH disposable Testnet wallet, in a SEPARATE Chromium persistent context
 * (isolated OPFS / storage):
 *   1. Serve packaged stellar-private-payments@0.2.1 from dist/spp
 *   2. Init WASM, Storage.open (OPFS), ProverBridge, Client.new
 *      (Nethermind testnet-deployments.json + packaged circuits.json lock)
 *   3. WalletSigner via Node exposeFunction (S… secret never enters page source)
 *   4. client.account → derivePrivacyKeys → account.pool({poolContract})
 *      (= write_pool_ready equivalent)
 *   5. isRegistered / pool.balance / pool.notes (read-only)
 *   6. Optional recipientLookup of the OTHER address (no broadcast)
 *   7. Reload same context; re-open Storage + re-bind identity (OPFS recovery)
 *   8. Block sendTransaction; never call registerPublicKeys / deposit / transfer /
 *      withdraw / setSppTestnetBroadcastAuthorized
 *
 * Usage (from packages/extension):
 *   node scripts/spp-dual-account-write-ready.mjs
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
  join(EXTENSION_ROOT, 'dist', 'spp'),
  join(EXTENSION_ROOT, 'public', 'spp'),
];
const SPP_ROOT = SPP_ROOT_CANDIDATES.find((p) => existsSync(join(p, 'js', 'index.js')));
const CIRCUITS_DIR = SPP_ROOT ? join(SPP_ROOT, 'dist', 'circuits') : null;
const ARTIFACTS_DIR =
  process.env.SPP_DUAL_ARTIFACTS_DIR || '/opt/cursor/artifacts/crypto-runtime';
const EVIDENCE_PATH =
  process.env.SPP_DUAL_EVIDENCE_PATH ||
  join(ARTIFACTS_DIR, 'dual-account-write-ready.json');
const WALLETS_PATH = process.env.SPP_E2E_WALLETS_PATH || '/tmp/spp-e2e-test-wallets.json';
const RPC_URL = process.env.SPP_RPC_URL || 'https://soroban-testnet.stellar.org';
const POOL = 'CAMWBUWHYXEGBM3Q7M5DBGW7LLJL3I4QGANQEZFEWLRNTOJMTT2WG24U';
const EXPECTED_SENDER = 'GDH76ERJT7WSYBV7A3VDZ4UTK7QFXWSBIS7ZRR6DNYTUHIRFRXBR5R7F';
const EXPECTED_RECIPIENT = 'GDJ7V7FI7K6CRWM6XOLHZML6WIHCD3XTW7LRBAQZJCI4FDCDCHUYYY37';
const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
const TIMEOUT_MS = Number(process.env.SPP_DUAL_TIMEOUT_MS || 300_000);
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
  console.error(`[spp-dual-account-write-ready] FAIL: ${message}`);
  process.exit(1);
}

function loadDeployments() {
  const path = join(
    WORKSPACE_ROOT,
    'packages/wallet-core/src/stellar/spp/nethermind/testnet-deployments.json',
  );
  return JSON.parse(readFileSync(path, 'utf8'));
}

function loadCircuitLocks() {
  const packagedPath = join(CIRCUITS_DIR, 'circuits.json');
  const testnetPath = join(
    WORKSPACE_ROOT,
    'packages/wallet-core/src/stellar/spp/nethermind/testnet-circuits.json',
  );
  const packaged = JSON.parse(readFileSync(packagedPath, 'utf8'));
  let testnet = null;
  if (existsSync(testnetPath)) {
    testnet = JSON.parse(readFileSync(testnetPath, 'utf8'));
  }
  // Packaged lock must match on-disk proving keys (same pattern as spp-groth16-local-prove).
  return {
    circuitLock: packaged,
    packagedPath,
    testnetPath: existsSync(testnetPath) ? testnetPath : null,
    packagedVersion: packaged.version ?? null,
    testnetVersion: testnet?.version ?? null,
  };
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
  // Drop raw secrets from local scope as soon as Keypairs exist.
  return {
    accounts: [
      {
        role: 'sender',
        kp: senderKp,
        expectedAddress: EXPECTED_SENDER,
        otherAddress: EXPECTED_RECIPIENT,
      },
      {
        role: 'recipient',
        kp: recipientKp,
        expectedAddress: EXPECTED_RECIPIENT,
        otherAddress: EXPECTED_SENDER,
      },
    ],
  };
}

function writeHarnessHtml(root) {
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>SPP dual-account write-ready</title></head>
<body>
<h1>SPP dual-account write-ready</h1>
<pre id="out">boot</pre>
<script type="module">
window.__SPP_DUAL__ = { ready: false, result: null, errors: [] };
document.getElementById('out').textContent = 'module-ready';
window.__SPP_DUAL__.ready = true;
</script>
</body></html>`;
  writeFileSync(join(root, 'index.html'), html);
}

function emptyAccountEvidence(role, expectedAddress) {
  return {
    role,
    expectedAddress,
    addressMatched: false,
    opfsOk: false,
    wasmOk: false,
    proverOk: false,
    clientOk: false,
    derivePrivacyKeysOk: false,
    poolBoundOk: false,
    writePoolReady: false,
    isRegistered: null,
    noteCount: null,
    balanceStroops: null,
    recipientLookup: null,
    reloadRecovered: false,
    broadcastAttempted: false,
    blockedSendTransactionCount: 0,
    rpcMethodsSeen: [],
    userDataDir: null,
    errors: [],
    verdict: 'FAILED',
  };
}

function verdictFor(acct) {
  const core =
    acct.addressMatched &&
    acct.opfsOk &&
    acct.wasmOk &&
    acct.proverOk &&
    acct.clientOk &&
    acct.derivePrivacyKeysOk &&
    acct.poolBoundOk &&
    acct.writePoolReady &&
    acct.reloadRecovered &&
    acct.broadcastAttempted === false;
  if (core) return 'VERIFIED';
  const any =
    acct.wasmOk ||
    acct.opfsOk ||
    acct.proverOk ||
    acct.clientOk ||
    acct.derivePrivacyKeysOk ||
    acct.poolBoundOk;
  return any ? 'PARTIAL' : 'FAILED';
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

function scrubSecrets(value) {
  const json = JSON.stringify(value, null, 2).replace(/\bS[A-Z0-9]{55}\b/g, '<REDACTED_SECRET_SHAPE>');
  return json;
}

function writeEvidence(evidence) {
  mkdirSync(dirname(EVIDENCE_PATH), { recursive: true });
  writeFileSync(EVIDENCE_PATH, scrubSecrets(evidence));
}

/**
 * Page-side init path shared by first pass and reload recovery.
 * Secrets never appear here — signer is window.__sppNode* bridges.
 */
async function evaluateWriteReadyPass(page, args) {
  return page.evaluate(async (input) => {
    const out = {
      addressMatched: false,
      observedAddress: null,
      opfsOk: false,
      wasmOk: false,
      proverOk: false,
      clientOk: false,
      derivePrivacyKeysOk: false,
      poolBoundOk: false,
      writePoolReady: false,
      isRegistered: null,
      noteCount: null,
      balanceStroops: null,
      recipientLookup: null,
      broadcastAttempted: false,
      blockedSendTransactionCount: 0,
      rpcMethodsSeen: [],
      errors: [],
      pass: input.passName,
    };

    const originalFetch = globalThis.fetch.bind(globalThis);
    async function extractRpcMethod(fetchInput, init) {
      try {
        if (init && typeof init.body === 'string') {
          return JSON.parse(init.body)?.method ?? null;
        }
        if (init && init.body && (ArrayBuffer.isView(init.body) || init.body instanceof ArrayBuffer)) {
          const text = new TextDecoder().decode(init.body);
          return JSON.parse(text)?.method ?? null;
        }
        if (typeof Request !== 'undefined' && fetchInput instanceof Request) {
          const cloned = fetchInput.clone();
          const text = await cloned.text();
          if (text && text.trim().startsWith('{')) {
            return JSON.parse(text)?.method ?? null;
          }
        }
      } catch {
        return null;
      }
      return null;
    }
    globalThis.fetch = async (fetchInput, init = {}) => {
      const method = await extractRpcMethod(fetchInput, init);
      if (method) out.rpcMethodsSeen.push(method);
      if (method === 'sendTransaction') {
        out.blockedSendTransactionCount += 1;
        out.broadcastAttempted = true;
        throw new Error(
          'BROADCAST_BLOCKED: sendTransaction denied by spp-dual-account-write-ready harness',
        );
      }
      return originalFetch(fetchInput, init);
    };

    let client = null;
    try {
      const circuitsBaseUrl = new URL('./dist/circuits/', location.href).href;
      const spp = await import(new URL('./js/index.js', location.href).href);
      await spp.default();
      out.wasmOk = true;

      const proverWorkerUrl = new URL('./dist/workers/prover-worker.js', location.href).href;
      const prover = spp.ProverBridge.spawn(proverWorkerUrl);
      await prover.configureCircuitsBase(circuitsBaseUrl, JSON.stringify(input.circuitLock));
      await prover.ping();
      out.proverOk = true;

      const storage = await spp.Storage.open();
      out.opfsOk = true;

      client = await spp.Client.new({
        rpcUrl: input.rpcUrl,
        storage,
        contractConfig: input.contractConfig,
        circuitsBaseUrl,
        circuitLock: input.circuitLock,
        prover,
      });
      out.clientOk = true;

      const signer = {
        getPublicKey: () => window.__sppNodePublicKey(),
        signMessage: async (message) => window.__sppNodeSignMessage(String(message)),
        signTransaction: async (xdrInput) => window.__sppNodeSignTransaction(String(xdrInput)),
        signAuthEntry: async (authEntryXdr) => window.__sppNodeSignAuthEntry(String(authEntryXdr)),
      };

      const pub = await signer.getPublicKey();
      out.observedAddress = typeof pub === 'string' ? pub : null;
      out.addressMatched = pub === input.expectedAddress;

      const account = await client.account(
        { networkPassphrase: input.networkPassphrase, userAddress: pub },
        signer,
      );
      await account.derivePrivacyKeys();
      out.derivePrivacyKeysOk = true;

      try {
        await Promise.race([
          client.sync(),
          new Promise((_, rej) =>
            setTimeout(() => rej(new Error('client.sync timeout')), Math.min(input.timeoutMs * 0.4, 120_000)),
          ),
        ]);
      } catch (e) {
        // Sync is non-fatal for write_pool_ready bind (same as sppHostWritePoolFactory).
        out.errors.push(`sync_nonfatal: ${String(e?.message || e).slice(0, 300)}`);
      }

      const pool = await account.pool({ poolContract: input.poolContract });
      out.poolBoundOk = Boolean(pool);
      out.writePoolReady = out.poolBoundOk && out.derivePrivacyKeysOk && out.clientOk;

      if (input.doReads) {
        try {
          out.isRegistered = await account.isRegistered();
        } catch (e) {
          out.errors.push(`isRegistered: ${String(e?.message || e).slice(0, 300)}`);
          out.isRegistered = null;
        }
        try {
          const bal = await pool.balance();
          out.balanceStroops = bal == null ? null : String(bal);
        } catch (e) {
          out.errors.push(`balance: ${String(e?.message || e).slice(0, 300)}`);
          out.balanceStroops = null;
        }
        try {
          const notes = await pool.notes();
          out.noteCount = Array.isArray(notes) ? notes.length : null;
        } catch (e) {
          out.errors.push(`notes: ${String(e?.message || e).slice(0, 300)}`);
          out.noteCount = null;
        }
        if (input.otherAddress) {
          try {
            const lookup = await client.recipientLookup(input.otherAddress);
            const entry = lookup?.entry;
            out.recipientLookup = {
              otherAddress: input.otherAddress,
              found: Boolean(entry),
              registryFullySynced:
                typeof lookup?.registryFullySynced === 'boolean'
                  ? lookup.registryFullySynced
                  : null,
              networkTipLedger:
                typeof lookup?.networkTipLedger === 'number' ? lookup.networkTipLedger : null,
              noteKeyPresent: Boolean(entry && entry.noteKey),
              encryptionKeyPresent: Boolean(entry && entry.encryptionKey),
            };
          } catch (e) {
            out.errors.push(`recipientLookup: ${String(e?.message || e).slice(0, 300)}`);
            out.recipientLookup = { otherAddress: input.otherAddress, error: true };
          }
        }
      }

      try {
        client.dispose();
      } catch {
        /* ignore */
      }
      client = null;
      return out;
    } catch (e) {
      out.errors.push(String(e?.message || e).slice(0, 800));
      try {
        client?.dispose?.();
      } catch {
        /* ignore */
      }
      return out;
    } finally {
      globalThis.fetch = originalFetch;
    }
  }, args);
}

async function runAccount({ account, origin, contractConfig, circuitLock, artifactsDir }) {
  const evidence = emptyAccountEvidence(account.role, account.expectedAddress);
  const userDataDir = join(
    tmpdir(),
    `spp-dual-${account.role}-${randomBytes(4).toString('hex')}`,
  );
  mkdirSync(userDataDir, { recursive: true });
  evidence.userDataDir = userDataDir;

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
      if (/^S[A-Z0-9]{55}$/.test(text) || /secret|mnemonic|seed/i.test(text)) return;
    });
    page.on('pageerror', (err) => {
      evidence.errors.push(`pageerror: ${err.message}`.slice(0, 400));
    });

    // Signing stays in Node — secrets never logged and not embedded in page source.
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
    await page.waitForFunction(() => window.__SPP_DUAL__?.ready === true);

    const first = await evaluateWriteReadyPass(page, {
      passName: 'initial',
      rpcUrl: RPC_URL,
      poolContract: POOL,
      networkPassphrase: NETWORK_PASSPHRASE,
      expectedAddress: account.expectedAddress,
      otherAddress: account.otherAddress,
      contractConfig,
      circuitLock,
      timeoutMs: TIMEOUT_MS,
      doReads: true,
    });

    evidence.addressMatched = first.addressMatched === true;
    evidence.opfsOk = first.opfsOk === true;
    evidence.wasmOk = first.wasmOk === true;
    evidence.proverOk = first.proverOk === true;
    evidence.clientOk = first.clientOk === true;
    evidence.derivePrivacyKeysOk = first.derivePrivacyKeysOk === true;
    evidence.poolBoundOk = first.poolBoundOk === true;
    evidence.writePoolReady = first.writePoolReady === true;
    evidence.isRegistered = first.isRegistered;
    evidence.noteCount = first.noteCount;
    evidence.balanceStroops = first.balanceStroops;
    evidence.recipientLookup = first.recipientLookup;
    evidence.blockedSendTransactionCount += first.blockedSendTransactionCount || 0;
    evidence.rpcMethodsSeen = [
      ...new Set([...(evidence.rpcMethodsSeen || []), ...(first.rpcMethodsSeen || [])]),
    ];
    if (first.broadcastAttempted) evidence.broadcastAttempted = true;
    evidence.errors.push(...(first.errors || []));

    try {
      const shotPath = join(artifactsDir, `dual-account-${account.role}-initial.png`);
      await page.screenshot({ path: shotPath, fullPage: true });
      evidence.screenshotInitial = shotPath;
    } catch (e) {
      evidence.errors.push(`screenshot_initial: ${String(e?.message || e).slice(0, 200)}`);
    }

    // Reload / new navigation in SAME context — OPFS recovery path.
    await page.goto(origin + '/?reload=1', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__SPP_DUAL__?.ready === true);

    const reload = await evaluateWriteReadyPass(page, {
      passName: 'reload',
      rpcUrl: RPC_URL,
      poolContract: POOL,
      networkPassphrase: NETWORK_PASSPHRASE,
      expectedAddress: account.expectedAddress,
      otherAddress: null,
      contractConfig,
      circuitLock,
      timeoutMs: TIMEOUT_MS,
      doReads: false,
    });

    evidence.reloadRecovered =
      reload.opfsOk === true &&
      reload.wasmOk === true &&
      reload.clientOk === true &&
      reload.addressMatched === true &&
      reload.derivePrivacyKeysOk === true &&
      reload.poolBoundOk === true;
    evidence.blockedSendTransactionCount += reload.blockedSendTransactionCount || 0;
    evidence.rpcMethodsSeen = [
      ...new Set([...(evidence.rpcMethodsSeen || []), ...(reload.rpcMethodsSeen || [])]),
    ];
    if (reload.broadcastAttempted) evidence.broadcastAttempted = true;
    evidence.errors.push(...(reload.errors || []).map((e) => `reload: ${e}`));
    evidence.reloadDetail = {
      opfsOk: reload.opfsOk,
      wasmOk: reload.wasmOk,
      proverOk: reload.proverOk,
      clientOk: reload.clientOk,
      addressMatched: reload.addressMatched,
      derivePrivacyKeysOk: reload.derivePrivacyKeysOk,
      poolBoundOk: reload.poolBoundOk,
      writePoolReady: reload.writePoolReady,
    };

    try {
      const shotPath = join(artifactsDir, `dual-account-${account.role}-reload.png`);
      await page.screenshot({ path: shotPath, fullPage: true });
      evidence.screenshotReload = shotPath;
    } catch (e) {
      evidence.errors.push(`screenshot_reload: ${String(e?.message || e).slice(0, 200)}`);
    }
  } catch (e) {
    evidence.errors.push(String(e?.message || e).slice(0, 800));
  } finally {
    try {
      await context?.close();
    } catch {
      /* ignore */
    }
  }

  evidence.verdict = verdictFor(evidence);
  // Never leave Keypair-adjacent fields on the evidence object.
  return evidence;
}

async function main() {
  if (!SPP_ROOT) fail('Missing packaged SPP root (dist/spp or public/spp)');
  if (!existsSync(CIRCUITS_DIR)) fail(`Missing circuits dir: ${CIRCUITS_DIR}`);
  if (!existsSync(CHROME_PATH)) fail(`Missing Chromium at ${CHROME_PATH}`);

  mkdirSync(ARTIFACTS_DIR, { recursive: true });

  const contractConfig = loadDeployments();
  if (contractConfig.kdf_domain !== 'Nethermind') {
    fail(`expected kdf_domain Nethermind, got ${contractConfig.kdf_domain}`);
  }
  const locks = loadCircuitLocks();
  const { accounts } = loadWallets();

  const serveRoot = join(tmpdir(), `spp-dual-harness-${randomBytes(4).toString('hex')}`);
  mkdirSync(serveRoot, { recursive: true });
  writeHarnessHtml(serveRoot);
  const { server, origin } = await startOverlayServer(serveRoot, SPP_ROOT);

  const evidence = {
    sampledAt: new Date().toISOString(),
    sdkVersion: '0.2.1',
    poolContract: POOL,
    kdf_domain: 'Nethermind',
    rpcUrl: RPC_URL,
    sppRoot: SPP_ROOT,
    circuitLock: {
      source: 'packaged_circuits.json',
      packagedVersion: locks.packagedVersion,
      testnetCircuitsVersion: locks.testnetVersion,
      note:
        'Client/Prover use packaged dist/circuits/circuits.json so lock matches on-disk proving keys (same as spp-groth16-local-prove). testnet-circuits.json recorded for comparison only.',
    },
    broadcastGateAuthorized: false,
    mutatorsCalled: {
      registerPublicKeys: false,
      deposit: false,
      transfer: false,
      withdraw: false,
    },
    crossContamination: false,
    isolation: {
      strategy: 'separate_launchPersistentContext_userDataDirs',
      note: 'Sender and recipient never share a BrowserContext or user-data profile; OPFS is per-profile.',
    },
    accounts: {},
    blockers: [],
  };

  try {
    // Sequential: each account gets its own persistent profile (strong OPFS isolation).
    for (const account of accounts) {
      const acctEvidence = await runAccount({
        account,
        origin,
        contractConfig,
        circuitLock: locks.circuitLock,
        artifactsDir: ARTIFACTS_DIR,
      });
      evidence.accounts[account.role] = acctEvidence;
      if (acctEvidence.verdict !== 'VERIFIED') {
        evidence.blockers.push(
          `${account.role}: ${acctEvidence.verdict} — ${
            (acctEvidence.errors || []).slice(0, 3).join(' | ') || 'see account errors'
          }`,
        );
      }
      if (acctEvidence.broadcastAttempted) {
        evidence.blockers.push(`${account.role}: broadcastAttempted unexpectedly true`);
      }
    }
    // Separate persistent profiles ⇒ no shared storage by construction.
    evidence.crossContamination = false;
  } finally {
    try {
      server.close();
    } catch {
      /* ignore */
    }
  }

  writeEvidence(evidence);

  const summary = {
    evidencePath: EVIDENCE_PATH,
    crossContamination: evidence.crossContamination,
    sender: evidence.accounts.sender?.verdict ?? 'FAILED',
    recipient: evidence.accounts.recipient?.verdict ?? 'FAILED',
    senderWritePoolReady: evidence.accounts.sender?.writePoolReady ?? false,
    recipientWritePoolReady: evidence.accounts.recipient?.writePoolReady ?? false,
    senderReloadRecovered: evidence.accounts.sender?.reloadRecovered ?? false,
    recipientReloadRecovered: evidence.accounts.recipient?.reloadRecovered ?? false,
    blockers: evidence.blockers,
  };
  console.log(JSON.stringify(summary, null, 2));

  if (summary.sender !== 'VERIFIED' || summary.recipient !== 'VERIFIED') {
    process.exitCode = 2;
  }
}

main().catch((err) => {
  try {
    writeEvidence({
      sampledAt: new Date().toISOString(),
      errors: [String(err?.stack || err).slice(0, 2000)],
      blockers: ['harness crashed before completion'],
      crossContamination: false,
      accounts: {},
      broadcastGateAuthorized: false,
    });
  } catch {
    /* ignore */
  }
  fail(err instanceof Error ? err.stack || err.message : String(err));
});
