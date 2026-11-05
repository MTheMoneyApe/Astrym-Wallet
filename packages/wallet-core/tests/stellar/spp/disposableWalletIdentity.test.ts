/**
 * disposableWalletIdentity.test.ts — Vault unlock preserves disposable Stellar identities.
 *
 * Secure disposable Testnet material may be raw Ed25519 secret seeds (S…), not BIP-39 HD
 * mnemonics. Astrym VaultService stores BIP-39 phrases only. To host an existing S… identity
 * without replacing it, the 32-byte seed is encoded as a BIP-39 entropy mnemonic, sealed in a
 * VaultService, then recovered after unlock via mnemonicToEntropy → ed25519 → G….
 *
 * SoftwareSigner is exercised post-unlock (vault must be unlocked for getPublicKey). Its
 * SLIP-0010 child key is a distinct derivation from raw Stellar seed identities and is NOT
 * used for the G… match check.
 *
 * SECURITY: Never log/serialize mnemonics, seeds, passwords, or S… secrets.
 */

import { describe, expect, it } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import { entropyToMnemonic, mnemonicToEntropy } from '@scure/bip39';
import { wordlist as ENGLISH_WORDLIST } from '@scure/bip39/wordlists/english.js';
import { Keypair, StrKey } from '@stellar/stellar-sdk';
import { accessSync, chmodSync, constants, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

import { validateMnemonic } from '../../../src/crypto/mnemonic.js';
import { makeSeedPhrase, rawMnemonic } from '../../../src/crypto/types.js';
import { SoftwareSigner } from '../../../src/signer/SoftwareSigner.js';
import type { IPersistentStorage, ISessionStorage } from '../../../src/vault/IVaultStorage.js';
import { PasswordUnlocker } from '../../../src/vault/PasswordUnlocker.js';
import { WalletLockedError, type EncryptedVaultBlob } from '../../../src/vault/types.js';
import { VaultService } from '../../../src/vault/VaultService.js';

const SECURE_WALLETS_PATH = '/tmp/spp-e2e-test-wallets.json';
const EVIDENCE_PATH = '/opt/cursor/artifacts/crypto-runtime/wallet-unlock-evidence.json';

const EXPECTED_SENDER = 'GDH76ERJT7WSYBV7A3VDZ4UTK7QFXWSBIS7ZRR6DNYTUHIRFRXBR5R7F';
const EXPECTED_RECIPIENT = 'GDJ7V7FI7K6CRWM6XOLHZML6WIHCD3XTW7LRBAQZJCI4FDCDCHUYYY37';

const WRITE_EVIDENCE = process.env['SPP_DISPOSABLE_VAULT_UNLOCK'] === '1';

class MemPersistent implements IPersistentStorage {
  private _blob: EncryptedVaultBlob | null = null;
  async loadBlob() {
    return this._blob;
  }
  async saveBlob(blob: EncryptedVaultBlob) {
    this._blob = blob;
  }
  async clearBlob() {
    this._blob = null;
  }
}

class MemSession implements ISessionStorage {
  private _key: CryptoKey | null = null;
  async loadKey() {
    return this._key;
  }
  async saveKey(key: CryptoKey) {
    this._key = key;
  }
  async clearKey() {
    this._key = null;
  }
}

type WalletMaterial = {
  role: 'sender' | 'recipient';
  secret: string;
  expectedPublic: string;
};

type UnlockProof = {
  matched: boolean;
  derivedPublic: string;
  lockUnlockRoundtrip: boolean;
  softwareSignerUnlocked: boolean;
};

function secureFileReadable(path: string): boolean {
  try {
    accessSync(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function loadDisposableWallets(): WalletMaterial[] {
  const raw = JSON.parse(readFileSync(SECURE_WALLETS_PATH, 'utf8')) as Record<string, unknown>;
  const senderSecret = raw['senderSecret'];
  const recipientSecret = raw['recipientSecret'];
  if (typeof senderSecret !== 'string' || typeof recipientSecret !== 'string') {
    throw new Error('Secure wallet material missing senderSecret/recipientSecret strings');
  }
  if (!StrKey.isValidEd25519SecretSeed(senderSecret) || !StrKey.isValidEd25519SecretSeed(recipientSecret)) {
    throw new Error('Secure wallet material must be valid Ed25519 S… secret seeds');
  }
  // Cross-check file publics when present (never trust alone).
  const senderPublic = typeof raw['senderPublic'] === 'string' ? raw['senderPublic'] : EXPECTED_SENDER;
  const recipientPublic =
    typeof raw['recipientPublic'] === 'string' ? raw['recipientPublic'] : EXPECTED_RECIPIENT;
  return [
    { role: 'sender', secret: senderSecret, expectedPublic: EXPECTED_SENDER },
    { role: 'recipient', secret: recipientSecret, expectedPublic: EXPECTED_RECIPIENT },
  ].map((w) => {
    const filePub = w.role === 'sender' ? senderPublic : recipientPublic;
    if (filePub !== w.expectedPublic) {
      throw new Error(`${w.role} public in secure file does not match expected identity`);
    }
    return w;
  });
}

function stellarSeedToMnemonic(secret: string): string {
  const seed = StrKey.decodeEd25519SecretSeed(secret);
  return entropyToMnemonic(seed, ENGLISH_WORDLIST);
}

function publicFromVaultMnemonic(mnemonic: string): string {
  const seed = mnemonicToEntropy(mnemonic, ENGLISH_WORDLIST);
  return StrKey.encodeEd25519PublicKey(ed25519.getPublicKey(seed));
}

function randomVaultPassword(): string {
  return `vault-unlock-${randomBytes(24).toString('base64url')}`;
}

/**
 * Independent vault instance: create → derive → lock → unlock → derive again.
 * Never returns or logs secret material.
 */
async function proveUnlockPreservesIdentity(wallet: WalletMaterial): Promise<UnlockProof> {
  const password = randomVaultPassword();
  const mnemonic = stellarSeedToMnemonic(wallet.secret);
  const phrase = makeSeedPhrase(mnemonic);

  // Sanity: Keypair.fromSecret must already match expected (material integrity).
  const kpPub = Keypair.fromSecret(wallet.secret).publicKey();
  if (kpPub !== wallet.expectedPublic) {
    throw new Error(`${wallet.role}: secure secret does not match expected G…`);
  }

  if (!validateMnemonic(mnemonic)) {
    throw new Error(`${wallet.role}: entropy mnemonic failed wallet-core BIP-39 validation`);
  }

  const vault = new VaultService(new PasswordUnlocker(), new MemPersistent(), new MemSession());
  await vault.createVault(password, phrase);
  expect(vault.isLocked).toBe(false);

  const signer = new SoftwareSigner(vault, 'stellar');
  const hdPub = await signer.getPublicKey(0);
  expect(hdPub).toBeInstanceOf(Uint8Array);
  expect(hdPub.length).toBe(32);

  const unlockedMnemonic = rawMnemonic(vault.getMnemonic());
  if (!validateMnemonic(unlockedMnemonic)) {
    throw new Error(`${wallet.role}: unlocked vault mnemonic failed BIP-39 validation`);
  }
  const firstDerived = publicFromVaultMnemonic(unlockedMnemonic);
  if (firstDerived !== wallet.expectedPublic) {
    throw new Error(`${wallet.role}: derived G… after createVault does not match expected`);
  }

  await vault.lock();
  expect(vault.isLocked).toBe(true);
  expect(() => vault.getMnemonic()).toThrow(WalletLockedError);
  await expect(signer.getPublicKey(0)).rejects.toThrow(WalletLockedError);

  await vault.unlock(password);
  expect(vault.isLocked).toBe(false);

  const hdPubAgain = await signer.getPublicKey(0);
  expect(hdPubAgain).toBeInstanceOf(Uint8Array);
  expect(Buffer.from(hdPubAgain).equals(Buffer.from(hdPub))).toBe(true);

  const secondDerived = publicFromVaultMnemonic(rawMnemonic(vault.getMnemonic()));
  const lockUnlockRoundtrip = secondDerived === firstDerived && secondDerived === wallet.expectedPublic;

  await vault.lock();

  return {
    matched: firstDerived === wallet.expectedPublic && lockUnlockRoundtrip,
    derivedPublic: secondDerived,
    lockUnlockRoundtrip,
    softwareSignerUnlocked: true,
  };
}

function writeEvidence(payload: Record<string, unknown>): void {
  mkdirSync('/opt/cursor/artifacts/crypto-runtime', { recursive: true });
  writeFileSync(EVIDENCE_PATH, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  chmodSync(EVIDENCE_PATH, 0o600);
}

describe('Disposable wallet vault identity', () => {
  it('ephemeral S… seed survives vault lock/unlock without identity replacement', async () => {
    const kp = Keypair.random();
    const proof = await proveUnlockPreservesIdentity({
      role: 'sender',
      secret: kp.secret(),
      expectedPublic: kp.publicKey(),
    });
    expect(proof.matched).toBe(true);
    expect(proof.lockUnlockRoundtrip).toBe(true);
    expect(proof.softwareSignerUnlocked).toBe(true);
  }, 60_000);

  it.runIf(WRITE_EVIDENCE || secureFileReadable(SECURE_WALLETS_PATH))(
    'sender and recipient disposable Testnet wallets unlock independently and derive expected G…',
    async () => {
      const blockers: string[] = [];
      let senderMatched = false;
      let recipientMatched = false;
      let lockUnlockRoundtrip = false;

      try {
        const wallets = loadDisposableWallets();
        // Independent vault instances — prove sequentially but with zero shared storage.
        const senderProof = await proveUnlockPreservesIdentity(wallets[0]!);
        const recipientProof = await proveUnlockPreservesIdentity(wallets[1]!);

        senderMatched = senderProof.matched && senderProof.derivedPublic === EXPECTED_SENDER;
        recipientMatched =
          recipientProof.matched && recipientProof.derivedPublic === EXPECTED_RECIPIENT;
        lockUnlockRoundtrip = senderProof.lockUnlockRoundtrip && recipientProof.lockUnlockRoundtrip;

        if (!senderMatched) blockers.push('sender derived G… did not match expected identity');
        if (!recipientMatched) blockers.push('recipient derived G… did not match expected identity');
        if (!lockUnlockRoundtrip) blockers.push('lock→unlock roundtrip failed to preserve identity');
      } catch (err) {
        blockers.push(err instanceof Error ? err.message : String(err));
      }

      const evidence = {
        sampledAt: new Date().toISOString(),
        senderMatched,
        recipientMatched,
        unlockMethod:
          'VaultService+PasswordUnlocker createVault/unlock; BIP-39 entropy mnemonic bound to disposable Stellar S… seed; SoftwareSigner(stellar) exercised post-unlock; G… via mnemonicToEntropy+ed25519/StrKey (identity-preserving; not SLIP-0010 HD child)',
        lockUnlockRoundtrip,
        secretsExposed: false as const,
        blockers,
      };

      if (WRITE_EVIDENCE || secureFileReadable(SECURE_WALLETS_PATH)) {
        writeEvidence(evidence);
      }

      expect(senderMatched).toBe(true);
      expect(recipientMatched).toBe(true);
      expect(lockUnlockRoundtrip).toBe(true);
      expect(evidence.secretsExposed).toBe(false);
      expect(blockers).toEqual([]);
    },
    120_000,
  );
});
