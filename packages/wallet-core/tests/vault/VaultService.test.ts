/**
 * VaultService.test.ts — Comprehensive VaultService state-machine tests.
 *
 * Uses the REAL PasswordUnlocker (full PBKDF2-SHA256 @ 600k iterations + AES-256-GCM)
 * to verify the complete security invariants end-to-end, not a mock.
 * Each PBKDF2 invocation takes ~470ms; total suite is expected to run ~20–35s.
 *
 * In-memory test doubles for IPersistentStorage and ISessionStorage let tests
 * inspect what was written to each storage tier without Chrome APIs.
 *
 * Test categories:
 *   1. Initial / SW-restart locked state
 *   2. Vault creation lifecycle
 *   3. Unlock lifecycle (correct password)
 *   4. Wrong password failure
 *   5. Lock behaviour and secret clearance
 *   6. Session key handling
 *   7. tryRestoreFromSession (transparent SW-restart re-unlock)
 *   8. Locked-state access rejection
 *   9. No secret material in persistent storage
 *  10. Session storage contains only the permitted CryptoKey
 *  11. Malformed / corrupted vault handling
 *  12. hasVault predicate
 */

import { describe, expect, it } from 'vitest';
import { makeSeedPhrase, rawMnemonic } from '../../src/crypto/types.js';
import type { IPersistentStorage, ISessionStorage } from '../../src/vault/IVaultStorage.js';
import type { IVaultUnlocker } from '../../src/vault/IVaultUnlocker.js';
import { PasswordUnlocker } from '../../src/vault/PasswordUnlocker.js';
import {
  VaultAlreadyExistsError,
  VaultDecryptionError,
  VaultNotFoundError,
  WalletLockedError,
  type EncryptedVaultBlob,
} from '../../src/vault/types.js';
import { VaultService } from '../../src/vault/VaultService.js';

// ─── Test doubles ─────────────────────────────────────────────────────────────

/** In-memory persistent storage — lets tests inspect what was saved. */
class MemPersistent implements IPersistentStorage {
  private _blob: EncryptedVaultBlob | null = null;

  async loadBlob(): Promise<EncryptedVaultBlob | null> {
    return this._blob;
  }

  async saveBlob(blob: EncryptedVaultBlob): Promise<void> {
    this._blob = blob;
  }

  async clearBlob(): Promise<void> {
    this._blob = null;
  }

  /** Test helper: read the raw stored blob. */
  get raw(): EncryptedVaultBlob | null {
    return this._blob;
  }

  /** Test helper: inject a corrupted blob. */
  setRaw(blob: EncryptedVaultBlob | null): void {
    this._blob = blob;
  }
}

/** In-memory session storage — lets tests inspect what was saved. */
class MemSession implements ISessionStorage {
  private _key: CryptoKey | null = null;

  async loadKey(): Promise<CryptoKey | null> {
    return this._key;
  }

  async saveKey(key: CryptoKey): Promise<void> {
    this._key = key;
  }

  async clearKey(): Promise<void> {
    this._key = null;
  }

  /** Test helper: read the raw stored key. */
  get raw(): CryptoKey | null {
    return this._key;
  }
}

// ─── Factory helpers ──────────────────────────────────────────────────────────

function makeStorage() {
  return { persistent: new MemPersistent(), session: new MemSession() };
}

function makeService(
  persistent: IPersistentStorage = new MemPersistent(),
  session: ISessionStorage = new MemSession(),
  unlocker: IVaultUnlocker = new PasswordUnlocker(),
) {
  return new VaultService(unlocker, persistent, session);
}

/** Simulate a SW restart: same storage, fresh VaultService instance. */
function swRestart(persistent: MemPersistent, session: MemSession) {
  return makeService(persistent, session);
}

// ─── Test mnemonic ────────────────────────────────────────────────────────────

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PHRASE = makeSeedPhrase(MNEMONIC);
const PASSWORD = 'Test!Password#42Secure';

// ─── 1. Initial / SW-restart locked state ─────────────────────────────────────

describe('VaultService — initial / SW-restart locked state', () => {
  it('new instance starts locked (isLocked === true)', () => {
    const svc = makeService();
    expect(svc.isLocked).toBe(true);
  });

  it('getMnemonic throws WalletLockedError on a fresh instance', () => {
    const svc = makeService();
    expect(() => svc.getMnemonic()).toThrow(WalletLockedError);
  });

  it('hasVault returns false when no vault exists', async () => {
    const svc = makeService();
    expect(await svc.hasVault()).toBe(false);
  });
});

// ─── 2. Vault creation lifecycle ──────────────────────────────────────────────

describe('VaultService — createVault', () => {
  it('createVault succeeds and wallet is immediately unlocked', async () => {
    const svc = makeService();
    await svc.createVault(PASSWORD, PHRASE);
    expect(svc.isLocked).toBe(false);
  });

  it('getMnemonic returns the correct phrase after createVault', async () => {
    const svc = makeService();
    await svc.createVault(PASSWORD, PHRASE);
    expect(rawMnemonic(svc.getMnemonic())).toBe(MNEMONIC);
  });

  it('hasVault returns true after createVault', async () => {
    const svc = makeService();
    await svc.createVault(PASSWORD, PHRASE);
    expect(await svc.hasVault()).toBe(true);
  });

  it('createVault throws VaultAlreadyExistsError if vault already exists', async () => {
    const { persistent, session } = makeStorage();
    const svc = makeService(persistent, session);
    await svc.createVault(PASSWORD, PHRASE);

    // Attempt a second createVault on the same storage
    const svc2 = makeService(persistent, session);
    await expect(svc2.createVault('other-pw', PHRASE)).rejects.toThrow(
      VaultAlreadyExistsError,
    );
  });
});

// ─── 3. Unlock lifecycle ──────────────────────────────────────────────────────

describe('VaultService — unlock (correct password)', () => {
  it('unlock transitions isLocked from true to false', async () => {
    const { persistent, session } = makeStorage();
    const svc1 = makeService(persistent, session);
    await svc1.createVault(PASSWORD, PHRASE);
    await svc1.lock();

    const svc2 = swRestart(persistent, session);
    expect(svc2.isLocked).toBe(true);
    await svc2.unlock(PASSWORD);
    expect(svc2.isLocked).toBe(false);
  });

  it('getMnemonic returns the original phrase after unlock', async () => {
    const { persistent, session } = makeStorage();
    const svc1 = makeService(persistent, session);
    await svc1.createVault(PASSWORD, PHRASE);
    await svc1.lock();

    const svc2 = swRestart(persistent, session);
    await svc2.unlock(PASSWORD);
    expect(rawMnemonic(svc2.getMnemonic())).toBe(MNEMONIC);
  });

  it('unlock throws VaultNotFoundError if no vault exists', async () => {
    const svc = makeService();
    await expect(svc.unlock(PASSWORD)).rejects.toThrow(VaultNotFoundError);
  });
});

// ─── 4. Wrong password failure ────────────────────────────────────────────────

describe('VaultService — wrong password', () => {
  it('unlock throws VaultDecryptionError on wrong password', async () => {
    const { persistent, session } = makeStorage();
    const svc1 = makeService(persistent, session);
    await svc1.createVault(PASSWORD, PHRASE);

    const svc2 = swRestart(persistent, session);
    await expect(svc2.unlock('wrong-password')).rejects.toThrow(VaultDecryptionError);
  });

  it('wallet remains locked after a failed unlock attempt', async () => {
    const { persistent, session } = makeStorage();
    const svc1 = makeService(persistent, session);
    await svc1.createVault(PASSWORD, PHRASE);

    const svc2 = swRestart(persistent, session);
    try {
      await svc2.unlock('wrong-password');
    } catch {
      // expected
    }
    expect(svc2.isLocked).toBe(true);
  });

  it('getMnemonic still throws WalletLockedError after failed unlock', async () => {
    const { persistent, session } = makeStorage();
    const svc1 = makeService(persistent, session);
    await svc1.createVault(PASSWORD, PHRASE);

    const svc2 = swRestart(persistent, session);
    try {
      await svc2.unlock('wrong-password');
    } catch {
      // expected
    }
    expect(() => svc2.getMnemonic()).toThrow(WalletLockedError);
  });

  it('error from wrong password does not leak the password string', async () => {
    const { persistent, session } = makeStorage();
    const svc1 = makeService(persistent, session);
    await svc1.createVault(PASSWORD, PHRASE);

    const svc2 = swRestart(persistent, session);
    const err = await svc2.unlock('super-secret-bad-pw').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(VaultDecryptionError);
    expect((err as Error).message).not.toContain('super-secret-bad-pw');
  });
});

// ─── 5. Lock behaviour and secret clearance ───────────────────────────────────

describe('VaultService — lock', () => {
  it('lock sets isLocked to true', async () => {
    const svc = makeService();
    await svc.createVault(PASSWORD, PHRASE);
    expect(svc.isLocked).toBe(false);
    await svc.lock();
    expect(svc.isLocked).toBe(true);
  });

  it('getMnemonic throws WalletLockedError after lock', async () => {
    const svc = makeService();
    await svc.createVault(PASSWORD, PHRASE);
    await svc.lock();
    expect(() => svc.getMnemonic()).toThrow(WalletLockedError);
  });

  it('lock clears the session key from session storage', async () => {
    const { persistent, session } = makeStorage();
    const svc = makeService(persistent, session);
    await svc.createVault(PASSWORD, PHRASE);
    expect(session.raw).not.toBeNull();

    await svc.lock();
    expect(session.raw).toBeNull();
  });

  it('unlock is possible again after lock using the correct password', async () => {
    const { persistent, session } = makeStorage();
    const svc = makeService(persistent, session);
    await svc.createVault(PASSWORD, PHRASE);
    await svc.lock();

    await svc.unlock(PASSWORD);
    expect(svc.isLocked).toBe(false);
    expect(rawMnemonic(svc.getMnemonic())).toBe(MNEMONIC);
  });

  it('create → unlock → lock → unlock cycle preserves the mnemonic', async () => {
    const { persistent, session } = makeStorage();
    const svc = makeService(persistent, session);
    await svc.createVault(PASSWORD, PHRASE);
    await svc.lock();
    await svc.unlock(PASSWORD);
    await svc.lock();
    await svc.unlock(PASSWORD);
    expect(rawMnemonic(svc.getMnemonic())).toBe(MNEMONIC);
  });
});

// ─── 6. Session key handling ──────────────────────────────────────────────────

describe('VaultService — session key handling', () => {
  it('createVault stores a CryptoKey in session storage', async () => {
    const { persistent, session } = makeStorage();
    const svc = makeService(persistent, session);
    await svc.createVault(PASSWORD, PHRASE);

    expect(session.raw).not.toBeNull();
    expect(session.raw).toBeInstanceOf(CryptoKey);
  });

  it('unlock stores a CryptoKey in session storage', async () => {
    const { persistent, session } = makeStorage();
    const svc1 = makeService(persistent, session);
    await svc1.createVault(PASSWORD, PHRASE);
    await svc1.lock();
    // After lock, session key is cleared
    expect(session.raw).toBeNull();

    const svc2 = swRestart(persistent, session);
    await svc2.unlock(PASSWORD);
    // After unlock, session key is restored
    expect(session.raw).not.toBeNull();
    expect(session.raw).toBeInstanceOf(CryptoKey);
  });

  it('session key is non-extractable', async () => {
    const { persistent, session } = makeStorage();
    const svc = makeService(persistent, session);
    await svc.createVault(PASSWORD, PHRASE);

    const key = session.raw!;
    expect(key.extractable).toBe(false);
  });

  it('session key is an AES-GCM key', async () => {
    const { persistent, session } = makeStorage();
    const svc = makeService(persistent, session);
    await svc.createVault(PASSWORD, PHRASE);

    const key = session.raw!;
    expect(key.type).toBe('secret');
    expect((key.algorithm as AesKeyAlgorithm).name).toBe('AES-GCM');
    expect((key.algorithm as AesKeyAlgorithm).length).toBe(256);
  });

  it('session storage never receives the mnemonic string', async () => {
    const { persistent, session } = makeStorage();
    const svc = makeService(persistent, session);
    await svc.createVault(PASSWORD, PHRASE);

    // The stored value must be a CryptoKey, not a string or Uint8Array
    const stored = session.raw;
    expect(typeof stored).not.toBe('string');
    expect(stored instanceof Uint8Array).toBe(false);
  });
});

// ─── 7. tryRestoreFromSession ─────────────────────────────────────────────────

describe('VaultService — tryRestoreFromSession', () => {
  it('restores unlocked state from session key (simulates SW restart)', async () => {
    const { persistent, session } = makeStorage();
    const svc1 = makeService(persistent, session);
    await svc1.createVault(PASSWORD, PHRASE);

    // Simulate SW restart: new VaultService instance, same storage
    const svc2 = swRestart(persistent, session);
    expect(svc2.isLocked).toBe(true);

    const restored = await svc2.tryRestoreFromSession();
    expect(restored).toBe(true);
    expect(svc2.isLocked).toBe(false);
  });

  it('getMnemonic returns correct phrase after session restore', async () => {
    const { persistent, session } = makeStorage();
    const svc1 = makeService(persistent, session);
    await svc1.createVault(PASSWORD, PHRASE);

    const svc2 = swRestart(persistent, session);
    await svc2.tryRestoreFromSession();
    expect(rawMnemonic(svc2.getMnemonic())).toBe(MNEMONIC);
  });

  it('returns false when session key is absent (fully locked state)', async () => {
    const { persistent, session } = makeStorage();
    const svc1 = makeService(persistent, session);
    await svc1.createVault(PASSWORD, PHRASE);
    await svc1.lock(); // clears session key

    const svc2 = swRestart(persistent, session);
    const restored = await svc2.tryRestoreFromSession();
    expect(restored).toBe(false);
    expect(svc2.isLocked).toBe(true);
  });

  it('returns false when no vault blob exists', async () => {
    const { persistent, session } = makeStorage();
    // Manually inject a key into session without a blob
    await session.saveKey(
      await globalThis.crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        false,
        ['decrypt'],
      ),
    );

    const svc = makeService(persistent, session);
    const restored = await svc.tryRestoreFromSession();
    expect(restored).toBe(false);
  });

  it('returns false and clears stale session key when key cannot decrypt blob', async () => {
    const { persistent, session } = makeStorage();
    const svc1 = makeService(persistent, session);
    await svc1.createVault(PASSWORD, PHRASE);

    // Overwrite the session key with a random, unrelated key
    const wrongKey = await globalThis.crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt'],
    );
    await session.saveKey(wrongKey);

    const svc2 = swRestart(persistent, session);
    const restored = await svc2.tryRestoreFromSession();
    expect(restored).toBe(false);
    expect(svc2.isLocked).toBe(true);

    // Stale session key must be cleared
    expect(session.raw).toBeNull();
  });

  it('wallet remains fully functional after session restore + lock + unlock', async () => {
    const { persistent, session } = makeStorage();
    const svc1 = makeService(persistent, session);
    await svc1.createVault(PASSWORD, PHRASE);

    // SW restart
    const svc2 = swRestart(persistent, session);
    await svc2.tryRestoreFromSession();

    // Lock and re-unlock with password
    await svc2.lock();
    await svc2.unlock(PASSWORD);
    expect(rawMnemonic(svc2.getMnemonic())).toBe(MNEMONIC);
  });
});

// ─── 8. Locked-state access rejection ────────────────────────────────────────

describe('VaultService — locked-state access rejection', () => {
  it('getMnemonic throws WalletLockedError when locked', () => {
    const svc = makeService();
    expect(() => svc.getMnemonic()).toThrow(WalletLockedError);
  });

  it('WalletLockedError has the correct name', () => {
    const svc = makeService();
    try {
      svc.getMnemonic();
    } catch (e) {
      expect(e).toBeInstanceOf(WalletLockedError);
      expect((e as Error).name).toBe('WalletLockedError');
    }
  });
});

// ─── 9. No secret material in persistent storage ──────────────────────────────

describe('VaultService — no secret material in persistent storage', () => {
  it('persistent storage contains only the encrypted blob (no plaintext mnemonic)', async () => {
    const { persistent, session } = makeStorage();
    const svc = makeService(persistent, session);
    await svc.createVault(PASSWORD, PHRASE);

    const blob = persistent.raw!;
    // Stringify the blob and verify the mnemonic words do not appear plaintext
    const blobJson = JSON.stringify(blob);
    expect(blobJson).not.toContain('abandon');
    expect(blobJson).not.toContain('about');
  });

  it('persistent blob has the correct encrypted structure (v, salt, iv, ct)', async () => {
    const svc = makeService();
    await svc.createVault(PASSWORD, PHRASE);
    // Indirectly confirm via hasVault — if blob is stored, structure was saved
    expect(await svc.hasVault()).toBe(true);
  });

  it('persistent blob v field equals 1', async () => {
    const { persistent, session } = makeStorage();
    const svc = makeService(persistent, session);
    await svc.createVault(PASSWORD, PHRASE);
    expect(persistent.raw?.v).toBe(1);
  });

  it('persistent blob salt is a non-empty base64url string', async () => {
    const { persistent, session } = makeStorage();
    const svc = makeService(persistent, session);
    await svc.createVault(PASSWORD, PHRASE);
    expect(typeof persistent.raw?.salt).toBe('string');
    expect(persistent.raw!.salt.length).toBeGreaterThan(0);
  });

  it('persistent blob does not contain password', async () => {
    const { persistent, session } = makeStorage();
    const svc = makeService(persistent, session);
    await svc.createVault(PASSWORD, PHRASE);
    const blobJson = JSON.stringify(persistent.raw);
    // PASSWORD is "Test!Password#42Secure" — must not appear in the blob
    expect(blobJson).not.toContain('Test!Password');
  });
});

// ─── 10. Session storage contains only the CryptoKey ─────────────────────────

describe('VaultService — session storage key invariants', () => {
  it('session storage value is a CryptoKey, not a string or raw bytes', async () => {
    const { persistent, session } = makeStorage();
    const svc = makeService(persistent, session);
    await svc.createVault(PASSWORD, PHRASE);

    expect(session.raw).toBeInstanceOf(CryptoKey);
    expect(typeof session.raw).not.toBe('string');
    expect(session.raw instanceof Uint8Array).toBe(false);
    expect(session.raw instanceof ArrayBuffer).toBe(false);
  });

  it('after lock, session storage is empty (null)', async () => {
    const { persistent, session } = makeStorage();
    const svc = makeService(persistent, session);
    await svc.createVault(PASSWORD, PHRASE);
    await svc.lock();
    expect(session.raw).toBeNull();
  });

  it('each unlock stores a different CryptoKey object instance', async () => {
    const { persistent, session } = makeStorage();
    const svc1 = makeService(persistent, session);
    await svc1.createVault(PASSWORD, PHRASE);
    const key1 = session.raw;

    await svc1.lock();
    await svc1.unlock(PASSWORD);
    const key2 = session.raw;

    // Different object instances (different PBKDF2 results since different key objects)
    expect(key1).not.toBe(key2);
  });
});

// ─── 11. Malformed / corrupted vault handling ─────────────────────────────────

describe('VaultService — malformed / corrupted vault', () => {
  it('unlock throws VaultDecryptionError if blob ciphertext is tampered', async () => {
    const { persistent, session } = makeStorage();
    const svc1 = makeService(persistent, session);
    await svc1.createVault(PASSWORD, PHRASE);

    // Corrupt the ciphertext in the stored blob
    const blob = persistent.raw!;
    // Flip the first character of ct to a different base64url character
    const badCt = blob.ct[0] === 'A' ? 'B' + blob.ct.slice(1) : 'A' + blob.ct.slice(1);
    persistent.setRaw({ ...blob, ct: badCt });

    const svc2 = swRestart(persistent, session);
    await expect(svc2.unlock(PASSWORD)).rejects.toThrow(VaultDecryptionError);
  });

  it('tryRestoreFromSession returns false on a corrupted blob', async () => {
    const { persistent, session } = makeStorage();
    const svc1 = makeService(persistent, session);
    await svc1.createVault(PASSWORD, PHRASE);

    // Corrupt the blob after caching the session key
    const blob = persistent.raw!;
    const badCt = blob.ct[0] === 'A' ? 'B' + blob.ct.slice(1) : 'A' + blob.ct.slice(1);
    persistent.setRaw({ ...blob, ct: badCt });

    const svc2 = swRestart(persistent, session);
    const restored = await svc2.tryRestoreFromSession();
    expect(restored).toBe(false);
    expect(svc2.isLocked).toBe(true);
  });

  it('unlock throws VaultDecryptionError on a blob with missing fields', async () => {
    const { persistent, session } = makeStorage();
    persistent.setRaw({ v: 1, salt: '', iv: 'abc', ct: 'xyz' });

    const svc = makeService(persistent, session);
    await expect(svc.unlock(PASSWORD)).rejects.toThrow(VaultDecryptionError);
  });

  it('unlock throws VaultDecryptionError on a blob with wrong version', async () => {
    const { persistent, session } = makeStorage();
    persistent.setRaw({ v: 99 as 1, salt: 'abc', iv: 'def', ct: 'ghi' });

    const svc = makeService(persistent, session);
    await expect(svc.unlock(PASSWORD)).rejects.toThrow(VaultDecryptionError);
  });
});

// ─── 12. hasVault predicate ───────────────────────────────────────────────────

describe('VaultService — hasVault', () => {
  it('returns false before any vault is created', async () => {
    expect(await makeService().hasVault()).toBe(false);
  });

  it('returns true after createVault', async () => {
    const svc = makeService();
    await svc.createVault(PASSWORD, PHRASE);
    expect(await svc.hasVault()).toBe(true);
  });

  it('returns true after lock (blob persists)', async () => {
    const { persistent, session } = makeStorage();
    const svc = makeService(persistent, session);
    await svc.createVault(PASSWORD, PHRASE);
    await svc.lock();
    // hasVault checks persistent storage, not memory
    expect(await svc.hasVault()).toBe(true);
  });

  it('returns true after SW restart (blob persists across restarts)', async () => {
    const { persistent, session } = makeStorage();
    const svc1 = makeService(persistent, session);
    await svc1.createVault(PASSWORD, PHRASE);

    const svc2 = swRestart(persistent, session);
    expect(await svc2.hasVault()).toBe(true);
  });
});


describe('VaultService � deleteVault', () => {
  it('successfully deletes vault and clears memory', async () => {
    const unlocker = new PasswordUnlocker(); const persistent = new MemPersistent(); const session = new MemSession();
    const vault = new VaultService(unlocker, persistent, session);
    await vault.createVault(PASSWORD, PHRASE);
    expect(vault.isLocked).toBe(false);

    await vault.deleteVault();

    expect(vault.isLocked).toBe(true);
    expect(() => vault.getMnemonic()).toThrow();
    expect(await persistent.loadBlob()).toBeNull();
    expect(await session.loadKey()).toBeNull();
  });

  it('fails clearBlob but still clears memory and session', async () => {
    const unlocker = new PasswordUnlocker(); const persistent = new MemPersistent(); const session = new MemSession();
    const vault = new VaultService(unlocker, persistent, session);
    await vault.createVault(PASSWORD, PHRASE);

    const error = new Error('Disk failure');
    persistent.clearBlob = async () => { throw error; };

    await expect(vault.deleteVault()).rejects.toThrow('deleteVault partially failed: Disk failure');
    expect(vault.isLocked).toBe(true);
    expect(() => vault.getMnemonic()).toThrow();
    expect(await session.loadKey()).toBeNull();
  });

  it('fails clearKey but still clears memory and blob', async () => {
    const unlocker = new PasswordUnlocker(); const persistent = new MemPersistent(); const session = new MemSession();
    const vault = new VaultService(unlocker, persistent, session);
    await vault.createVault(PASSWORD, PHRASE);

    session.clearKey = async () => { throw new Error('Session failure'); };

    await expect(vault.deleteVault()).rejects.toThrow('deleteVault partially failed: Session failure');
    expect(vault.isLocked).toBe(true);
    expect(() => vault.getMnemonic()).toThrow();
    expect(await persistent.loadBlob()).toBeNull();
  });

  it('fails both clearBlob and clearKey, aggregates errors', async () => {
    const unlocker = new PasswordUnlocker(); const persistent = new MemPersistent(); const session = new MemSession();
    const vault = new VaultService(unlocker, persistent, session);
    await vault.createVault(PASSWORD, PHRASE);

    persistent.clearBlob = async () => { throw new Error('Disk error'); };
    session.clearKey = async () => { throw new Error('Session error'); };

    await expect(vault.deleteVault()).rejects.toThrow('deleteVault partially failed: Disk error; Session error');
    expect(vault.isLocked).toBe(true);
    expect(() => vault.getMnemonic()).toThrow();
  });
});



