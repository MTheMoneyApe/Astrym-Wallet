#!/usr/bin/env node
/**
 * Local Groth16 prove path for stellar-private-payments@0.2.1 packaged artifacts.
 *
 * APIs used (real, from js/index.js + wasm .d.ts — not invented):
 *   - default init()
 *   - ProverBridge.spawn(proverWorkerUrl)
 *   - prover.configureCircuitsBase(circuitsBaseUrl, lockJson)
 *   - prover.ping()
 *   - Storage.open()
 *   - Client.new({ rpcUrl, storage, contractConfig, circuitsBaseUrl, circuitLock })
 *   - client.account / account.derivePrivacyKeys / account.pool
 *   - PrivatePool.deposit (builds proof internally via prove_next)
 *   - TX_PROGRESS_EVENT stages: Proving → Simulating → Signing → Submitting
 *   - verifySelectiveDisclosure / PrivatePool.disclose / verifyDisclosure
 *     (disclosure path needs existing notes; deposit path has no public proof-bytes export)
 *
 * Broadcast: fetch interceptor rejects JSON-RPC sendTransaction. Never flips
 * setSppTestnetBroadcastAuthorized. onChainSubmit must stay false.
 *
 * Usage (from packages/extension):
 *   node scripts/spp-groth16-local-prove.mjs
 *   SPP_GROTH16_TIMEOUT_MS=900000 node scripts/spp-groth16-local-prove.mjs
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

const SPP_ROOT = join(EXTENSION_ROOT, 'dist', 'spp');
const CIRCUITS_DIR = join(SPP_ROOT, 'dist', 'circuits');
const EVIDENCE_PATH =
  process.env.SPP_GROTH16_EVIDENCE_PATH ||
  '/opt/cursor/artifacts/crypto-runtime/groth16-local-evidence.json';
const WALLETS_PATH = process.env.SPP_E2E_WALLETS_PATH || '/tmp/spp-e2e-test-wallets.json';
const RPC_URL = process.env.SPP_RPC_URL || 'https://soroban-testnet.stellar.org';
const POOL = 'CAMWBUWHYXEGBM3Q7M5DBGW7LLJL3I4QGANQEZFEWLRNTOJMTT2WG24U';
const EXPECTED_SENDER = 'GDH76ERJT7WSYBV7A3VDZ4UTK7QFXWSBIS7ZRR6DNYTUHIRFRXBR5R7F';
const EXPECTED_RECIPIENT = 'GDJ7V7FI7K6CRWM6XOLHZML6WIHCD3XTW7LRBAQZJCI4FDCDCHUYYY37';
const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
const DEPOSIT_STROOPS = BigInt(process.env.SPP_GROTH16_DEPOSIT_STROOPS || '10000000'); // 1 XLM
const TIMEOUT_MS = Number(process.env.SPP_GROTH16_TIMEOUT_MS || 900_000);
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
  console.error(`[spp-groth16-local-prove] FAIL: ${message}`);
  process.exit(1);
}

function probeOnDisk(lock) {
  const circuitIds = Object.keys(lock).filter(
    (k) => k !== 'version' && k !== 'meta' && lock[k] && typeof lock[k] === 'object',
  );
  const missing = [];
  for (const id of circuitIds) {
    for (const artifact of [`${id}.r1cs`, `${id}.graph.bin`, `${id}_proving_key.bin`]) {
      if (!existsSync(join(CIRCUITS_DIR, artifact))) missing.push(artifact);
    }
  }
  return { circuitIds, missing, ok: missing.length === 0 };
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
  return { senderKp, recipientKp };
}

function writeHarnessHtml(root) {
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>SPP Groth16 local prove</title></head>
<body>
<h1>SPP Groth16 local prove</h1>
<pre id="out">boot</pre>
<script type="module">
window.__SPP_GROTH16__ = { ready: false, result: null, progress: [], rpc: [], errors: [] };
document.getElementById('out').textContent = 'module-ready';
window.__SPP_GROTH16__.ready = true;
</script>
</body></html>`;
  writeFileSync(join(root, 'index.html'), html);
}

function emptyEvidence(partial = {}) {
  return {
    sampledAt: new Date().toISOString(),
    sdkVersion: '0.2.1',
    alternative: 'A_playwright_chromium_packaged_spp_assets',
    apisFound: {
      ProverBridge: ['spawn', 'configureCircuitsBase', 'ping', 'fork', 'toHandle', 'free'],
      Client: ['new', 'account', 'sync', 'backgroundSync', 'verifySelectiveDisclosure', 'dispose'],
      PrivatePool: [
        'deposit',
        'transfer',
        'withdraw',
        'disclose',
        'verifyDisclosure',
        'estimate',
        'notes',
        'balance',
      ],
      standaloneProveExport: false,
      localVerifyExport: 'verifySelectiveDisclosure / PrivatePool.verifyDisclosure (disclosure receipts only)',
      txProgressEvent: 'stellar-private-payments:tx-progress',
      txProgressStagesObservedInWasm: ['Proving', 'Simulating', 'Signing', 'Submitting'],
    },
    poolContract: POOL,
    kdf_domain: 'Nethermind',
    senderAddress: EXPECTED_SENDER,
    recipientAddress: EXPECTED_RECIPIENT,
    broadcastGateAuthorized: false,
    artifactLoad: { ok: false },
    proverInit: { ok: false },
    witnessBuild: { ok: false },
    proofGenerated: { ok: false },
    localVerify: { ok: false },
    sdkAccepted: { ok: false },
    onChainSubmit: false,
    progressEvents: [],
    rpcMethodsSeen: [],
    blockedSendTransactionCount: 0,
    errors: [],
    blockers: [],
    ...partial,
  };
}

async function readBroadcastGateFlag() {
  try {
    // Evaluate source text only — do not execute TS. Default is false per module comment.
    const gatePath = join(
      WORKSPACE_ROOT,
      'packages/wallet-core/src/stellar/spp/sppBroadcastGate.ts',
    );
    const src = readFileSync(gatePath, 'utf8');
    const defaultOff = /let authorized = false/.test(src);
    return { sourceDefaultFalse: defaultOff, runtimeNotFlippedByThisScript: true };
  } catch (e) {
    return { error: String(e) };
  }
}

async function main() {
  if (!existsSync(SPP_ROOT)) fail(`Missing packaged SPP root: ${SPP_ROOT}`);
  if (!existsSync(CIRCUITS_DIR)) fail(`Missing circuits dir: ${CIRCUITS_DIR}`);
  if (!existsSync(CHROME_PATH)) fail(`Missing Chromium at ${CHROME_PATH}`);

  const lock = JSON.parse(readFileSync(join(CIRCUITS_DIR, 'circuits.json'), 'utf8'));
  const diskProbe = probeOnDisk(lock);
  const contractConfig = loadDeployments();
  if (contractConfig.kdf_domain !== 'Nethermind') {
    fail(`expected kdf_domain Nethermind, got ${contractConfig.kdf_domain}`);
  }
  const { senderKp } = loadWallets();

  const evidence = emptyEvidence({
    artifactLoad: {
      ok: diskProbe.ok,
      circuitCount: diskProbe.circuitIds.length,
      circuitIds: diskProbe.circuitIds,
      lockVersion: lock.version,
      lockCommit: lock.meta?.commit ?? null,
      missing: diskProbe.missing.slice(0, 24),
      circuitsDir: CIRCUITS_DIR,
    },
    broadcastGate: await readBroadcastGateFlag(),
  });

  if (!diskProbe.ok) {
    evidence.blockers.push('Packaged proving-key artifacts missing on disk');
    writeEvidence(evidence);
    fail('disk proving-key probe failed');
  }

  // Serve a temp root that includes packaged spp + harness index
  const serveRoot = join(tmpdir(), `spp-groth16-${randomBytes(4).toString('hex')}`);
  mkdirSync(serveRoot, { recursive: true });
  // Symlink/copy is heavy; instead serve from SPP_ROOT and write index into it carefully.
  // Prefer isolated temp with recursive copy of needed tree via server root = SPP_ROOT
  // and write index.html into SPP_ROOT only if absent — avoid mutating dist: use overlay server.
  writeHarnessHtml(serveRoot);
  // Overlay: map / -> serveRoot/index.html, everything else from SPP_ROOT
  const { server, origin } = await startOverlayServer(serveRoot, SPP_ROOT);

  const userDataDir = join(tmpdir(), `spp-groth16-profile-${randomBytes(4).toString('hex')}`);
  mkdirSync(userDataDir, { recursive: true });

  /** @type {import('@stellar/stellar-sdk').Keypair} */
  const kp = senderKp;
  const secretHeldInNodeOnly = true;

  let browser;
  try {
    browser = await chromium.launchPersistentContext(userDataDir, {
      executablePath: CHROME_PATH,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--enable-features=FileSystemAccessAPI',
      ],
    });
    const page = await browser.newPage();
    page.setDefaultTimeout(TIMEOUT_MS);

    const consoleLines = [];
    page.on('console', (msg) => {
      const text = msg.text();
      // Never retain lines that look like secrets
      if (/^S[A-Z0-9]{55}$/.test(text) || /secret|mnemonic|seed/i.test(text)) return;
      consoleLines.push(text.slice(0, 500));
    });
    page.on('pageerror', (err) => {
      evidence.errors.push(`pageerror: ${err.message}`);
    });

    // Signing stays in Node — secrets never logged and not embedded in page source.
    // Formats match Freighter / SppWalletSignerAdapter (SEP-0053, tx.hash, HashIdPreimage).
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
    await page.waitForFunction(() => window.__SPP_GROTH16__?.ready === true);

    const pageResult = await page.evaluate(
      async ({ rpcUrl, poolContract, networkPassphrase, depositStroops, contractConfig, timeoutMs }) => {
        const out = {
          artifactLoad: { ok: false },
          proverInit: { ok: false },
          witnessBuild: { ok: false },
          proofGenerated: { ok: false },
          localVerify: { ok: false, reason: null },
          sdkAccepted: { ok: false },
          onChainSubmit: false,
          progressEvents: [],
          rpcMethodsSeen: [],
          blockedSendTransactionCount: 0,
          errors: [],
          blockers: [],
          logsSnippet: null,
          depositStatus: null,
          alternativeDetail: 'worker_prover_via_Client_deposit_sendTransaction_blocked',
        };

        const circuitsBaseUrl = new URL('./dist/circuits/', location.href).href;
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

        // Broadcast gate: reject sendTransaction only; allow simulate/get*/etc.
        // WASM reqwest often passes a Request (body not in init) — clone+text both shapes.
        const originalFetch = globalThis.fetch.bind(globalThis);
        async function extractRpcMethod(input, init) {
          try {
            if (init && typeof init.body === 'string') {
              return JSON.parse(init.body)?.method ?? null;
            }
            if (init && init.body && (ArrayBuffer.isView(init.body) || init.body instanceof ArrayBuffer)) {
              const text = new TextDecoder().decode(init.body);
              return JSON.parse(text)?.method ?? null;
            }
            if (typeof Request !== 'undefined' && input instanceof Request) {
              const cloned = input.clone();
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
        globalThis.fetch = async (input, init = {}) => {
          const method = await extractRpcMethod(input, init);
          if (method) out.rpcMethodsSeen.push(method);
          if (method === 'sendTransaction') {
            out.blockedSendTransactionCount += 1;
            throw new Error(
              'BROADCAST_BLOCKED: sendTransaction denied by spp-groth16-local-prove harness',
            );
          }
          return originalFetch(input, init);
        };

        try {
          const lockResp = await fetch(new URL('circuits.json', circuitsBaseUrl));
          if (!lockResp.ok) throw new Error(`circuits.json HTTP ${lockResp.status}`);
          const circuitLock = await lockResp.json();
          const ids = Object.keys(circuitLock).filter(
            (k) => k !== 'version' && k !== 'meta' && circuitLock[k] && typeof circuitLock[k] === 'object',
          );
          const missing = [];
          for (const id of ids) {
            for (const artifact of [`${id}.r1cs`, `${id}.graph.bin`, `${id}_proving_key.bin`]) {
              const head = await fetch(new URL(artifact, circuitsBaseUrl), { method: 'HEAD' });
              if (!head.ok) missing.push(artifact);
            }
          }
          out.artifactLoad = {
            ok: missing.length === 0,
            circuitCount: ids.length,
            missing: missing.slice(0, 12),
            lockVersion: circuitLock.version,
          };
          if (!out.artifactLoad.ok) {
            out.blockers.push('HTTP artifact probe failed inside page');
            out.progressEvents = progress;
            return out;
          }

          const spp = await import(new URL('./js/index.js', location.href).href);
          await spp.default();

          // Prefer explicit ProverBridge path then hand to Client.new
          const proverWorkerUrl = new URL('./dist/workers/prover-worker.js', location.href).href;
          const prover = spp.ProverBridge.spawn(proverWorkerUrl);
          try {
            await prover.configureCircuitsBase(circuitsBaseUrl, JSON.stringify(circuitLock));
            await prover.ping();
            out.proverInit = {
              ok: true,
              api: 'ProverBridge.spawn + configureCircuitsBase + ping',
              proverWorkerUrl,
              circuitsBaseUrl,
            };
          } catch (e) {
            out.proverInit = { ok: false, error: String(e?.message || e) };
            try {
              prover.free();
            } catch {
              /* ignore */
            }
            out.progressEvents = progress;
            return out;
          }

          const storage = await spp.Storage.open();
          const client = await spp.Client.new({
            rpcUrl,
            storage,
            contractConfig,
            circuitsBaseUrl,
            circuitLock,
            prover,
          });

          const signer = {
            getPublicKey: () => window.__sppNodePublicKey(),
            signMessage: async (message /*, opts */) => window.__sppNodeSignMessage(String(message)),
            signTransaction: async (xdrInput /*, opts */) =>
              window.__sppNodeSignTransaction(String(xdrInput)),
            signAuthEntry: async (authEntryXdr /*, opts */) =>
              window.__sppNodeSignAuthEntry(String(authEntryXdr)),
          };

          const account = await client.account(
            { networkPassphrase, userAddress: await signer.getPublicKey() },
            signer,
          );
          await account.derivePrivacyKeys();

          // Sync enough state for prove_next → ensure_synced
          const syncStarted = Date.now();
          try {
            await Promise.race([
              client.sync(),
              new Promise((_, rej) =>
                setTimeout(() => rej(new Error('client.sync timeout')), Math.min(timeoutMs * 0.45, 400_000)),
              ),
            ]);
            out.sync = { ok: true, ms: Date.now() - syncStarted };
          } catch (e) {
            out.sync = { ok: false, error: String(e?.message || e), ms: Date.now() - syncStarted };
            // Continue — deposit may still trigger ensure_synced internally
          }

          const pool = await account.pool({ poolContract });

          const depositStarted = Date.now();
          try {
            const result = await Promise.race([
              pool.deposit(BigInt(depositStroops)),
              new Promise((_, rej) =>
                setTimeout(() => rej(new Error('deposit timeout')), Math.min(timeoutMs * 0.5, 500_000)),
              ),
            ]);
            out.depositStatus = result?.status ?? null;
            out.depositCode = result?.code ?? null;
            out.depositMessage =
              typeof result?.message === 'string' ? result.message.slice(0, 500) : null;
            out.depositHashes = Array.isArray(result?.hashes) ? result.hashes.length : 0;
            try {
              out.depositJson = result?.toJSON ? result.toJSON() : null;
            } catch {
              out.depositJson = null;
            }
          } catch (e) {
            out.depositError = String(e?.message || e).slice(0, 800);
          }
          out.depositMs = Date.now() - depositStarted;

          out.progressEvents = progress.slice();
          const stages = progress.map((p) => String(p.stage || ''));
          const messages = progress.map((p) => String(p.message || ''));
          const proved =
            stages.some((s) => /prov/i.test(s)) ||
            messages.some((m) => /generat.*proof|proof/i.test(m));
          const simulated = stages.some((s) => /simul/i.test(s));
          const submitted = stages.some((s) => /submit/i.test(s));

          // Witness build is not separately exported; treat circuit configure + Proving start as witness path engaged.
          out.witnessBuild = {
            ok: proved || stages.length > 0,
            note: 'No public witness API; inferred from TX_PROGRESS Proving / prove path engagement',
            stages,
          };
          const depositDiag = String(
            (out.depositJson && out.depositJson.message) ||
              out.depositMessage ||
              out.depositError ||
              '',
          );
          const proofAbcObserved =
            /proof:\s*\{\s*a:\s*Bytes\([0-9a-f]+\)/i.test(depositDiag) &&
            /b:\s*Bytes\([0-9a-f]+\)/i.test(depositDiag) &&
            /c:\s*Bytes\([0-9a-f]+\)/i.test(depositDiag);
          out.proofGenerated = {
            ok: proved || proofAbcObserved,
            path: 'PrivatePool.deposit → prove_next (TX_PROGRESS stage=prove)',
            stages,
            messages: messages.slice(0, 12),
            proofAbcObservedInSimulateDiagnostics: proofAbcObserved,
          };
          out.sdkAccepted = {
            ok: simulated && (proved || proofAbcObserved),
            note: 'Simulating after Proving implies SDK embedded proof into prepared tx for simulateTransaction',
            simulateReached: simulated,
          };
          if (submitted && out.blockedSendTransactionCount === 0) {
            out.onChainSubmit = true;
            out.blockers.push('Submitting stage observed without harness sendTransaction block firing');
          } else {
            out.onChainSubmit = false;
          }

          // Local verify: deposit proofs are not exported as DisclosureReceipt.
          // Attempt disclose only if notes exist (will usually fail pre-deposit).
          try {
            const notes = await pool.notes();
            out.noteCount = Array.isArray(notes) ? notes.length : null;
            if (Array.isArray(notes) && notes.length > 0 && spp.DisclosureRequest) {
              const commitment = notes[0].commitment ?? notes[0].noteCommitment ?? null;
              if (commitment) {
                const req = new spp.DisclosureRequest(
                  [commitment],
                  'local-prove-harness',
                  '00',
                  'local-verify',
                  `0x${Date.now().toString(16)}`,
                );
                const receipt = await pool.disclose(req);
                if (receipt && receipt.proofCompressedHex) {
                  out.proofGenerated = {
                    ok: true,
                    path: 'PrivatePool.disclose',
                    proofCompressedHexLen: String(receipt.proofCompressedHex).length,
                  };
                  const vkHash = receipt.circuit?.vkHash;
                  if (vkHash) {
                    const report = await pool.verifyDisclosure(receipt, vkHash);
                    out.localVerify = {
                      ok: Boolean(report?.proofVerified),
                      proofVerified: report?.proofVerified ?? null,
                      path: 'PrivatePool.verifyDisclosure',
                    };
                  }
                }
              }
            } else {
              out.localVerify = {
                ok: false,
                reason:
                  'No disclosure receipt available — PrivatePool.deposit does not export proof bytes; verifySelectiveDisclosure only accepts disclosure receipts',
              };
            }
          } catch (e) {
            out.localVerify = {
              ok: false,
              reason: `disclose/verify path error: ${String(e?.message || e).slice(0, 400)}`,
            };
          }

          try {
            if (typeof spp.dump_recent_logs === 'function') {
              const logs = await spp.dump_recent_logs();
              out.logsSnippet = String(logs || '')
                .split('\n')
                .filter((l) => /prov|witness|circuit|groth|proof/i.test(l))
                .slice(0, 40)
                .map((l) => l.slice(0, 240));
            }
          } catch {
            /* ignore */
          }

          try {
            client.dispose();
          } catch {
            /* ignore */
          }

          if (!out.proofGenerated.ok) {
            out.blockers.push(
              'TX_PROGRESS never reached Proving — sync/registration/ASP may be required before prove_next',
            );
          }
          if (out.onChainSubmit) {
            out.blockers.push('onChainSubmit unexpectedly true');
          }
          return out;
        } catch (e) {
          out.errors.push(String(e?.message || e).slice(0, 800));
          out.progressEvents = progress;
          return out;
        }
      },
      {
        rpcUrl: RPC_URL,
        poolContract: POOL,
        networkPassphrase: NETWORK_PASSPHRASE,
        depositStroops: DEPOSIT_STROOPS.toString(),
        contractConfig,
        timeoutMs: TIMEOUT_MS,
      },
    );

    Object.assign(evidence, {
      artifactLoad: pageResult.artifactLoad?.ok ? pageResult.artifactLoad : evidence.artifactLoad,
      proverInit: pageResult.proverInit,
      witnessBuild: pageResult.witnessBuild,
      proofGenerated: pageResult.proofGenerated,
      localVerify: pageResult.localVerify,
      sdkAccepted: pageResult.sdkAccepted,
      onChainSubmit: pageResult.onChainSubmit === true,
      progressEvents: pageResult.progressEvents || [],
      rpcMethodsSeen: [...new Set(pageResult.rpcMethodsSeen || [])],
      blockedSendTransactionCount: pageResult.blockedSendTransactionCount || 0,
      errors: [...evidence.errors, ...(pageResult.errors || [])],
      blockers: [...(evidence.blockers || []), ...(pageResult.blockers || [])],
      sync: pageResult.sync ?? null,
      depositError: pageResult.depositError ?? null,
      depositStatus: pageResult.depositStatus ?? null,
      depositCode: pageResult.depositCode ?? null,
      depositMessage: pageResult.depositMessage ?? null,
      depositJson: pageResult.depositJson ?? null,
      depositMs: pageResult.depositMs ?? null,
      noteCount: pageResult.noteCount ?? null,
      logsSnippet: pageResult.logsSnippet ?? null,
      alternativeDetail: pageResult.alternativeDetail,
      secretHandling: {
        walletsPath: WALLETS_PATH,
        derivedSenderMatchesExpected: true,
        secretsLogged: false,
        secretsHeldInNodeOnly: secretHeldInNodeOnly,
      },
      consoleSample: consoleLines.slice(-30),
    });

    // Hard invariant
    if (evidence.onChainSubmit !== false) {
      evidence.blockers.push('Invariant violated: onChainSubmit must be false');
    }
  } finally {
    try {
      await browser?.close();
    } catch {
      /* ignore */
    }
    try {
      server.close();
    } catch {
      /* ignore */
    }
  }

  writeEvidence(evidence);
  console.log(
    JSON.stringify(
      {
        evidencePath: EVIDENCE_PATH,
        artifactLoad: evidence.artifactLoad?.ok ?? false,
        proverInit: evidence.proverInit?.ok ?? false,
        witnessBuild: evidence.witnessBuild?.ok ?? false,
        proofGenerated: evidence.proofGenerated?.ok ?? false,
        localVerify: evidence.localVerify?.ok ?? false,
        sdkAccepted: evidence.sdkAccepted?.ok ?? false,
        onChainSubmit: evidence.onChainSubmit,
        blockedSendTransactionCount: evidence.blockedSendTransactionCount,
        blockers: evidence.blockers,
      },
      null,
      2,
    ),
  );
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
        // Range support for probe
        const range = req.headers.range;
        if (range) {
          const m = /^bytes=(\d+)-(\d)?/.exec(range);
          if (m) {
            const start = Number(m[1]);
            const end = m[2] ? Number(m[2]) : start;
            headers['Content-Length'] = String(end - start + 1);
            headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
            res.writeHead(206, headers);
            createReadStream(full, { start, end }).pipe(res);
            return;
          }
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

function writeEvidence(evidence) {
  mkdirSync(dirname(EVIDENCE_PATH), { recursive: true });
  // Scrub any accidental secret-shaped strings
  const json = JSON.stringify(evidence, null, 2).replace(/\bS[A-Z0-9]{55}\b/g, '<REDACTED_SECRET_SHAPE>');
  writeFileSync(EVIDENCE_PATH, json);
}

main().catch((err) => {
  try {
    writeEvidence(
      emptyEvidence({
        errors: [String(err?.stack || err).slice(0, 2000)],
        blockers: ['harness crashed before completion'],
        onChainSubmit: false,
      }),
    );
  } catch {
    /* ignore */
  }
  fail(err instanceof Error ? err.stack || err.message : String(err));
});
