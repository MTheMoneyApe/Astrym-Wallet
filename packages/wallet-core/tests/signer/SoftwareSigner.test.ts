/**
 * SoftwareSigner.test.ts — Comprehensive tests for the Ed25519 software signer.
 *
 * Test categories (from implementation_plan.md + architectural decisions):
 *   A. getPublicKey — derivation correctness
 *   B. signTransaction — signature correctness and verification
 *   C. signMessage — correctness and verification
 *   D. Locked-vault behaviour
 *   E. Security invariants — private key bytes never exposed
 *   F. Multiple accounts — distinct keys and signatures
 *
 * All tests use real PasswordUnlocker and real VaultService (no mocks for crypto).
 * PBKDF2 cost: ~1 unlock = ~470ms. Tests are designed for 2-3 unlocks total.
 *
 * Reference mnemonic: "abandon ×11 + about" — same as hdDerive.test.ts vectors.
 * Account 0 public key reference: derived from m/44'/501'/0'/0' with this mnemonic.
 */

import { describe, expect, it } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import { makeSeedPhrase } from '../../src/crypto/types.js';
import type { IPersistentStorage, ISessionStorage } from '../../src/vault/IVaultStorage.js';
import { PasswordUnlocker } from '../../src/vault/PasswordUnlocker.js';
import { WalletLockedError, type EncryptedVaultBlob } from '../../src/vault/types.js';
import { VaultService } from '../../src/vault/VaultService.js';
import { SoftwareSigner } from '../../src/signer/SoftwareSigner.js';

// ─── In-memory storage doubles ────────────────────────────────────────────────

class MemPersistent implements IPersistentStorage {
  private _blob: EncryptedVaultBlob | null = null;
  async loadBlob() { return this._blob; }
  async saveBlob(blob: EncryptedVaultBlob) { this._blob = blob; }
  async clearBlob() { this._blob = null; }
}

class MemSession implements ISessionStorage {
  private _key: CryptoKey | null = null;
  async loadKey() { return this._key; }
  async saveKey(key: CryptoKey) { this._key = key; }
  async clearKey() { this._key = null; }
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PHRASE = makeSeedPhrase(MNEMONIC);
const PASSWORD = 'SoftwareSigner!Test#42';

/**
 * Build an unlocked VaultService + SoftwareSigner pair.
 * One PBKDF2 call per invocation (~470ms).
 */
async function makeUnlockedSigner(): Promise<{
  vault: VaultService;
  signer: SoftwareSigner;
}> {
  const vault = new VaultService(
    new PasswordUnlocker(),
    new MemPersistent(),
    new MemSession(),
  );
  await vault.createVault(PASSWORD, PHRASE);
  return { vault, signer: new SoftwareSigner(vault) };
}

// ─── Known reference values ───────────────────────────────────────────────────
// These are derived from the SLIP-0010 derivation already verified in hdDerive.test.ts.
// Account 0: m/44'/501'/0'/0' private key (hex from the cross-validated test vector)
const ACCOUNT_0_PRIVATE_KEY_HEX =
  '37df573b3ac4ad5b522e064e25b63ea16bcbe79d449e81a0268d1047948bb445';

// ─── A. getPublicKey — derivation correctness ─────────────────────────────────

describe('SoftwareSigner — getPublicKey', () => {
  it('getPublicKey(0) returns a 32-byte Uint8Array', async () => {
    const { signer } = await makeUnlockedSigner();
    const pub = await signer.getPublicKey(0);
    expect(pub).toBeInstanceOf(Uint8Array);
    expect(pub.length).toBe(32);
  });

  it('getPublicKey(0) matches the known reference for the abandon mnemonic', async () => {
    const { signer } = await makeUnlockedSigner();
    const pub = await signer.getPublicKey(0);

    // The expected public key is derived from the cross-validated private key
    const expectedPriv = Uint8Array.from(
      Buffer.from(ACCOUNT_0_PRIVATE_KEY_HEX, 'hex'),
    );
    const expectedPub = ed25519.getPublicKey(expectedPriv);

    expect(Buffer.from(pub).toString('hex')).toBe(
      Buffer.from(expectedPub).toString('hex'),
    );
  });

  it('getPublicKey(0) !== getPublicKey(1) — distinct accounts produce distinct keys', async () => {
    const { signer } = await makeUnlockedSigner();
    const pub0 = await signer.getPublicKey(0);
    const pub1 = await signer.getPublicKey(1);
    expect(Buffer.from(pub0).toString('hex')).not.toBe(
      Buffer.from(pub1).toString('hex'),
    );
  });

  it('getPublicKey(1) !== getPublicKey(2)', async () => {
    const { signer } = await makeUnlockedSigner();
    const pub1 = await signer.getPublicKey(1);
    const pub2 = await signer.getPublicKey(2);
    expect(Buffer.from(pub1).toString('hex')).not.toBe(
      Buffer.from(pub2).toString('hex'),
    );
  });

  it('getPublicKey is deterministic — same account index gives same key', async () => {
    const { signer } = await makeUnlockedSigner();
    const pub0a = await signer.getPublicKey(0);
    const pub0b = await signer.getPublicKey(0);
    expect(Buffer.from(pub0a).toString('hex')).toBe(
      Buffer.from(pub0b).toString('hex'),
    );
  });
});

// ─── B. signTransaction — signature correctness ───────────────────────────────

describe('SoftwareSigner — signTransaction', () => {
  it('signTransaction returns a 64-byte Uint8Array', async () => {
    const { signer } = await makeUnlockedSigner();
    const payload = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const sig = await signer.signTransaction(payload, 0);
    expect(sig).toBeInstanceOf(Uint8Array);
    expect(sig.length).toBe(64);
  });

  it('signTransaction signature verifies with ed25519.verify()', async () => {
    const { signer } = await makeUnlockedSigner();
    const payload = new Uint8Array([10, 20, 30, 40]);
    const pub = await signer.getPublicKey(0);
    const sig = await signer.signTransaction(payload, 0);
    const valid = ed25519.verify(sig, payload, pub);
    expect(valid).toBe(true);
  });

  it('signTransaction signature does NOT verify for a different payload', async () => {
    const { signer } = await makeUnlockedSigner();
    const payload = new Uint8Array([10, 20, 30]);
    const wrongPayload = new Uint8Array([10, 20, 31]);
    const pub = await signer.getPublicKey(0);
    const sig = await signer.signTransaction(payload, 0);
    const valid = ed25519.verify(sig, wrongPayload, pub);
    expect(valid).toBe(false);
  });

  it('signTransaction signature does NOT verify against a different account key', async () => {
    const { signer } = await makeUnlockedSigner();
    const payload = new Uint8Array([1, 2, 3]);
    const pub0 = await signer.getPublicKey(0);
    const pub1 = await signer.getPublicKey(1);
    const sig = await signer.signTransaction(payload, 0);
    // sig was made with account 0 key, should not verify with account 1 key
    const valid = ed25519.verify(sig, payload, pub1);
    expect(valid).toBe(false);
    // But does verify with account 0 key
    expect(ed25519.verify(sig, payload, pub0)).toBe(true);
  });

  it('signTransaction with different account indices produces different signatures', async () => {
    const { signer } = await makeUnlockedSigner();
    const payload = new Uint8Array([1, 2, 3, 4]);
    const sig0 = await signer.signTransaction(payload, 0);
    const sig1 = await signer.signTransaction(payload, 1);
    expect(Buffer.from(sig0).toString('hex')).not.toBe(
      Buffer.from(sig1).toString('hex'),
    );
  });
});

// ─── C. signMessage — correctness ────────────────────────────────────────────

describe('SoftwareSigner — signMessage', () => {
  it('signMessage returns a 64-byte Uint8Array', async () => {
    const { signer } = await makeUnlockedSigner();
    const msg = new TextEncoder().encode('Hello Solana');
    const sig = await signer.signMessage(msg, 0);
    expect(sig).toBeInstanceOf(Uint8Array);
    expect(sig.length).toBe(64);
  });

  it('signMessage signature verifies with ed25519.verify()', async () => {
    const { signer } = await makeUnlockedSigner();
    const msg = new TextEncoder().encode('Sign me');
    const pub = await signer.getPublicKey(0);
    const sig = await signer.signMessage(msg, 0);
    const valid = ed25519.verify(sig, msg, pub);
    expect(valid).toBe(true);
  });

  it('signMessage signature does NOT verify for a tampered message', async () => {
    const { signer } = await makeUnlockedSigner();
    const msg = new TextEncoder().encode('Original');
    const tampered = new TextEncoder().encode('Tampered');
    const pub = await signer.getPublicKey(0);
    const sig = await signer.signMessage(msg, 0);
    expect(ed25519.verify(sig, tampered, pub)).toBe(false);
  });

  it('signMessage and signTransaction on same bytes produce identical signatures', async () => {
    const { signer } = await makeUnlockedSigner();
    const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const pub = await signer.getPublicKey(0);
    const sigTx = await signer.signTransaction(bytes, 0);
    const sigMsg = await signer.signMessage(bytes, 0);
    // Both ultimately call ed25519.sign with the same key and payload
    expect(Buffer.from(sigTx).toString('hex')).toBe(
      Buffer.from(sigMsg).toString('hex'),
    );
    // Both verify
    expect(ed25519.verify(sigTx, bytes, pub)).toBe(true);
    expect(ed25519.verify(sigMsg, bytes, pub)).toBe(true);
  });

  it('signMessage with empty bytes works and produces a valid signature', async () => {
    const { signer } = await makeUnlockedSigner();
    const empty = new Uint8Array(0);
    const pub = await signer.getPublicKey(0);
    const sig = await signer.signMessage(empty, 0);
    expect(sig.length).toBe(64);
    expect(ed25519.verify(sig, empty, pub)).toBe(true);
  });
});

// ─── D. Locked-vault behaviour ────────────────────────────────────────────────

describe('SoftwareSigner — throws when vault is locked', () => {
  it('getPublicKey throws WalletLockedError when vault is locked', async () => {
    const vault = new VaultService(
      new PasswordUnlocker(),
      new MemPersistent(),
      new MemSession(),
    );
    const signer = new SoftwareSigner(vault);
    // vault is locked (no createVault or unlock called)
    await expect(signer.getPublicKey(0)).rejects.toThrow(WalletLockedError);
  });

  it('signTransaction throws WalletLockedError when vault is locked', async () => {
    const vault = new VaultService(
      new PasswordUnlocker(),
      new MemPersistent(),
      new MemSession(),
    );
    const signer = new SoftwareSigner(vault);
    await expect(
      signer.signTransaction(new Uint8Array([1, 2, 3]), 0),
    ).rejects.toThrow(WalletLockedError);
  });

  it('signMessage throws WalletLockedError when vault is locked', async () => {
    const vault = new VaultService(
      new PasswordUnlocker(),
      new MemPersistent(),
      new MemSession(),
    );
    const signer = new SoftwareSigner(vault);
    await expect(
      signer.signMessage(new Uint8Array([1, 2, 3]), 0),
    ).rejects.toThrow(WalletLockedError);
  });

  it('getPublicKey throws WalletLockedError after vault.lock()', async () => {
    const { vault, signer } = await makeUnlockedSigner();
    await vault.lock();
    await expect(signer.getPublicKey(0)).rejects.toThrow(WalletLockedError);
  });

  it('signTransaction throws WalletLockedError after vault.lock()', async () => {
    const { vault, signer } = await makeUnlockedSigner();
    await vault.lock();
    await expect(
      signer.signTransaction(new Uint8Array([1]), 0),
    ).rejects.toThrow(WalletLockedError);
  });
});

// ─── E. Security invariants — private key bytes never exposed ─────────────────

describe('SoftwareSigner — security invariants', () => {
  it('getPublicKey does not return 32-byte data that matches the private key', async () => {
    const { signer } = await makeUnlockedSigner();
    const pub = await signer.getPublicKey(0);

    // The private key (ACCOUNT_0_PRIVATE_KEY_HEX) is known for this test mnemonic.
    // Confirm the returned public key is NOT the private key bytes.
    expect(Buffer.from(pub).toString('hex')).not.toBe(ACCOUNT_0_PRIVATE_KEY_HEX);
  });

  it('SoftwareSigner has no public property that holds a private key or mnemonic', () => {
    const vault = new VaultService(
      new PasswordUnlocker(),
      new MemPersistent(),
      new MemSession(),
    );
    const signer = new SoftwareSigner(vault);

    // Inspect all own enumerable properties — none should be a secret
    const publicProps = Object.getOwnPropertyNames(signer);
    // The only own property should be the _vault reference (private field)
    for (const prop of publicProps) {
      const val = (signer as unknown as Record<string, unknown>)[prop];
      // No property should be a string that looks like a mnemonic
      if (typeof val === 'string') {
        expect(val).not.toContain('abandon');
      }
      // No property should be a Uint8Array (no stored private key bytes)
      expect(val instanceof Uint8Array).toBe(false);
    }
  });

  it('signTransaction return value is a Uint8Array (not a private key)', async () => {
    const { signer } = await makeUnlockedSigner();
    const payload = new Uint8Array([0xff, 0xfe]);
    const sig = await signer.signTransaction(payload, 0);

    // Signature must NOT equal the private key bytes
    expect(Buffer.from(sig).toString('hex')).not.toBe(ACCOUNT_0_PRIVATE_KEY_HEX);
    // Signature must be exactly 64 bytes (not 32 bytes like a private key)
    expect(sig.length).toBe(64);
  });

  it('SoftwareSigner stores no mnemonic as an instance property', async () => {
    const { signer } = await makeUnlockedSigner();
    const allProps = Object.getOwnPropertyNames(signer);
    for (const prop of allProps) {
      const val = (signer as unknown as Record<string, unknown>)[prop];
      if (typeof val === 'string') {
        expect(val).not.toContain('abandon');
        expect(val).not.toContain('about');
      }
    }
  });
});

// ─── F. Multiple accounts — distinct keys ────────────────────────────────────

describe('SoftwareSigner — multiple accounts', () => {
  it('accounts 0, 1, and 2 all produce distinct public keys', async () => {
    const { signer } = await makeUnlockedSigner();
    const pub0 = Buffer.from(await signer.getPublicKey(0)).toString('hex');
    const pub1 = Buffer.from(await signer.getPublicKey(1)).toString('hex');
    const pub2 = Buffer.from(await signer.getPublicKey(2)).toString('hex');
    expect(pub0).not.toBe(pub1);
    expect(pub1).not.toBe(pub2);
    expect(pub0).not.toBe(pub2);
  });

  it('signature from account 0 does not verify against account 1 pubkey', async () => {
    const { signer } = await makeUnlockedSigner();
    const payload = new Uint8Array([1, 2, 3]);
    const sig = await signer.signMessage(payload, 0);
    const pub1 = await signer.getPublicKey(1);
    expect(ed25519.verify(sig, payload, pub1)).toBe(false);
  });
});

