#!/usr/bin/env node
/**
 * spp-disposable-vault-unlock.mjs
 *
 * Prove both disposable Testnet wallets unlock independently through the
 * legitimate VaultService / PasswordUnlocker / SoftwareSigner path and derive
 * the expected G… public keys.
 *
 * Secure material (mode 600): /tmp/spp-e2e-test-wallets.json
 *   { senderSecret, recipientSecret, senderPublic, recipientPublic }
 * Secrets are Stellar S… seeds. VaultService stores BIP-39 phrases, so each
 * seed is sealed as a BIP-39 entropy mnemonic (same 32 bytes — not a replacement
 * identity). After unlock, G… is recovered via mnemonicToEntropy + ed25519.
 * SoftwareSigner(stellar) is exercised while unlocked (SLIP-0010 child ≠ raw seed).
 *
 * Evidence: /opt/cursor/artifacts/crypto-runtime/wallet-unlock-evidence.json
 *
 * SECURITY: Never print mnemonics, seeds, passwords, or private keys.
 *
 * Usage (from repo root or packages/extension):
 *   node packages/extension/scripts/spp-disposable-vault-unlock.mjs
 */

import { spawnSync } from 'node:child_process';
import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXTENSION_ROOT = resolve(__dirname, '..');
const REPO_ROOT = resolve(EXTENSION_ROOT, '..', '..');
const WALLET_CORE = resolve(REPO_ROOT, 'packages/wallet-core');
const SECURE_WALLETS_PATH = '/tmp/spp-e2e-test-wallets.json';
const EVIDENCE_DIR = '/opt/cursor/artifacts/crypto-runtime';
const EVIDENCE_PATH = `${EVIDENCE_DIR}/wallet-unlock-evidence.json`;
const TEST_REL = 'tests/stellar/spp/disposableWalletIdentity.test.ts';

const EXPECTED_SENDER = 'GDH76ERJT7WSYBV7A3VDZ4UTK7QFXWSBIS7ZRR6DNYTUHIRFRXBR5R7F';
const EXPECTED_RECIPIENT = 'GDJ7V7FI7K6CRWM6XOLHZML6WIHCD3XTW7LRBAQZJCI4FDCDCHUYYY37';

const UNLOCK_METHOD =
  'VaultService+PasswordUnlocker createVault/unlock; BIP-39 entropy mnemonic bound to disposable Stellar S… seed; SoftwareSigner(stellar) exercised post-unlock; G… via mnemonicToEntropy+ed25519/StrKey (identity-preserving; not SLIP-0010 HD child)';

/** @param {string} message */
function fail(message) {
  writeEvidence({
    sampledAt: new Date().toISOString(),
    senderMatched: false,
    recipientMatched: false,
    unlockMethod: UNLOCK_METHOD,
    lockUnlockRoundtrip: false,
    secretsExposed: false,
    blockers: [message],
  });
  console.error(`[spp-disposable-vault-unlock] FAIL: ${message}`);
  process.exit(1);
}

/** @param {Record<string, unknown>} payload */
function writeEvidence(payload) {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  writeFileSync(EVIDENCE_PATH, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  chmodSync(EVIDENCE_PATH, 0o600);
}

function assertSecureMaterial() {
  try {
    accessSync(SECURE_WALLETS_PATH, constants.R_OK);
  } catch {
    fail(`Secure wallet material not readable at ${SECURE_WALLETS_PATH}`);
  }
  const mode = statSync(SECURE_WALLETS_PATH).mode & 0o777;
  if (mode & 0o077) {
    fail(`Secure wallet material mode must be 600 (got ${mode.toString(8)})`);
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(SECURE_WALLETS_PATH, 'utf8'));
  } catch {
    fail('Secure wallet material is not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    fail('Secure wallet material must be a JSON object');
  }
  for (const key of ['senderSecret', 'recipientSecret', 'senderPublic', 'recipientPublic']) {
    if (typeof parsed[key] !== 'string' || parsed[key].length === 0) {
      fail(`Secure wallet material missing string field ${key}`);
    }
  }
  if (parsed.senderPublic !== EXPECTED_SENDER) {
    fail('senderPublic does not match expected disposable sender G…');
  }
  if (parsed.recipientPublic !== EXPECTED_RECIPIENT) {
    fail('recipientPublic does not match expected disposable recipient G…');
  }
  // Shape-only checks — never print secret values.
  if (parsed.senderSecret[0] !== 'S' || parsed.senderSecret.length !== 56) {
    fail('senderSecret must be a 56-char S… StrKey');
  }
  if (parsed.recipientSecret[0] !== 'S' || parsed.recipientSecret.length !== 56) {
    fail('recipientSecret must be a 56-char S… StrKey');
  }
}

function resolveVitestBin() {
  const candidates = [
    resolve(REPO_ROOT, 'node_modules/vitest/vitest.mjs'),
    resolve(WALLET_CORE, 'node_modules/vitest/vitest.mjs'),
    resolve(REPO_ROOT, 'node_modules/.bin/vitest'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

function main() {
  console.log('[spp-disposable-vault-unlock] Checking secure material (no secrets logged)…');
  assertSecureMaterial();

  const vitestBin = resolveVitestBin();
  if (!vitestBin) {
    fail('vitest binary not found; install workspace deps first');
  }

  mkdirSync(EVIDENCE_DIR, { recursive: true });

  console.log('[spp-disposable-vault-unlock] Running independent vault unlock proofs…');
  const result = spawnSync(
    process.execPath,
    [vitestBin, 'run', TEST_REL],
    {
      cwd: WALLET_CORE,
      env: {
        ...process.env,
        SPP_DISPOSABLE_VAULT_UNLOCK: '1',
      },
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    },
  );

  // Redact any accidental secret-looking tokens from vitest output before echoing.
  const redact = (s) =>
    String(s || '')
      .replace(/S[A-Z2-7]{55}/g, 'S[REDACTED]')
      .replace(/\b([a-z]+(?:\s+[a-z]+){11,23})\b/gi, '[REDACTED_MNEMONIC]');

  if (result.stdout) process.stdout.write(redact(result.stdout));
  if (result.stderr) process.stderr.write(redact(result.stderr));

  if (!existsSync(EVIDENCE_PATH)) {
    fail(`Unlock proof did not write evidence at ${EVIDENCE_PATH}`);
  }

  let evidence;
  try {
    evidence = JSON.parse(readFileSync(EVIDENCE_PATH, 'utf8'));
  } catch {
    fail('Evidence file is not valid JSON');
  }

  const ok =
    evidence.senderMatched === true &&
    evidence.recipientMatched === true &&
    evidence.lockUnlockRoundtrip === true &&
    evidence.secretsExposed === false &&
    Array.isArray(evidence.blockers) &&
    evidence.blockers.length === 0;

  console.log(
    JSON.stringify({
      evidencePath: EVIDENCE_PATH,
      senderMatched: evidence.senderMatched,
      recipientMatched: evidence.recipientMatched,
      lockUnlockRoundtrip: evidence.lockUnlockRoundtrip,
      secretsExposed: evidence.secretsExposed,
      blockerCount: Array.isArray(evidence.blockers) ? evidence.blockers.length : null,
      vitestStatus: result.status,
    }),
  );

  if (result.status !== 0 || !ok) {
    process.exit(1);
  }
  console.log('[spp-disposable-vault-unlock] OK — both disposable wallets unlocked; identities preserved.');
}

main();
