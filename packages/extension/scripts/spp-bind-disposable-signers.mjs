#!/usr/bin/env node
/**
 * Lab helper: load disposable Testnet S… secrets into memory for verification
 * without printing them. Prints only public G… addresses and bind status.
 *
 * Usage:
 *   node scripts/spp-bind-disposable-signers.mjs
 *
 * Does not start the extension SW — this validates StellarSecretKeyWalletSigner
 * binding for the funded disposable accounts. Extension SW registry is bound
 * at runtime via the same module when the lab harness injects.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(__dirname, '../package.json'));
const { Keypair } = require('@stellar/stellar-sdk');

const WALLETS = process.env.SPP_E2E_WALLETS_PATH || '/tmp/spp-e2e-test-wallets.json';
const OUT =
  process.env.SPP_BIND_EVIDENCE_PATH ||
  '/opt/cursor/artifacts/crypto-runtime/disposable-signer-bind-evidence.json';

const EXPECTED = {
  sender: 'GDH76ERJT7WSYBV7A3VDZ4UTK7QFXWSBIS7ZRR6DNYTUHIRFRXBR5R7F',
  recipient: 'GDJ7V7FI7K6CRWM6XOLHZML6WIHCD3XTW7LRBAQZJCI4FDCDCHUYYY37',
};

function main() {
  const raw = JSON.parse(readFileSync(WALLETS, 'utf8'));
  const sender = Keypair.fromSecret(raw.senderSecret);
  const recipient = Keypair.fromSecret(raw.recipientSecret);
  const evidence = {
    sampledAt: new Date().toISOString(),
    walletsPath: WALLETS,
    sender: {
      expected: EXPECTED.sender,
      derived: sender.publicKey(),
      matched: sender.publicKey() === EXPECTED.sender,
    },
    recipient: {
      expected: EXPECTED.recipient,
      derived: recipient.publicKey(),
      matched: recipient.publicKey() === EXPECTED.recipient,
    },
    secretsExposed: false,
    note: 'HD SoftwareSigner cannot represent these S… identities; use StellarSecretKeyWalletSigner / disposableTestnetSignerRegistry.',
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(evidence, null, 2));
  if (!evidence.sender.matched || !evidence.recipient.matched) {
    console.error('[spp-bind-disposable-signers] FAIL identity mismatch');
    process.exit(1);
  }
  console.log('[spp-bind-disposable-signers] OK sender+recipient matched expected G…');
  console.log(`[spp-bind-disposable-signers] evidence=${OUT}`);
}

main();
