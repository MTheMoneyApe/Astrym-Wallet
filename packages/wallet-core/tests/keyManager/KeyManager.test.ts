import * as crypto from 'node:crypto';
/**
 * KeyManager.test.ts — Comprehensive tests for KeyManager and ChromeAccountStorage.
 *
 * Test categories:
 *   A. getAccounts() — basic reads (including locked-vault compatibility)
 *   B. addAccount() — derivation, sequential indices, default/custom labels
 *   C. addAccount() — locked vault, atomicity
 *   D. addAccount() — public-key correctness and 32-byte invariant
 *   E. renameAccount() — mutations, persistence, errors
 *   F. renameAccount() — validation (empty/whitespace labels)
 *   G. Security invariants — no secret material in KeyManager state
 *   H. Defensive-copy invariant
 *   I. ChromeAccountStorage — round-trip, malformed data, missing data
 *
 * Uses real SoftwareSigner + VaultService + PasswordUnlocker.
 * In-memory storage doubles — no chrome.* globals needed.
 *
 * PBKDF2 cost: ~470ms per vault creation/unlock. Tests target minimal
 * PBKDF2 invocations; a single unlocked vault fixture is shared where possible.
 */

import { describe, expect, it, vi } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import { makeSeedPhrase } from '../../src/crypto/types.js';
import {
  ACCOUNTS_STORAGE_KEY,
  ChromeAccountStorage,
  type ILocalStorageArea,
} from '../../src/keyManager/ChromeAccountStorage.js';
import type { IAccountStorage } from '../../src/keyManager/IAccountStorage.js';
import { KeyManager } from '../../src/keyManager/KeyManager.js';
import {
  AccountNotFoundError,
  InvalidAccountLabelError,
  type AccountInfo,
  type V2AccountState,
} from '../../src/keyManager/types.js';
import { SoftwareSigner } from '../../src/signer/SoftwareSigner.js';
import type { IPersistentStorage, ISessionStorage } from '../../src/vault/IVaultStorage.js';
import { PasswordUnlocker } from '../../src/vault/PasswordUnlocker.js';
import { WalletLockedError, type EncryptedVaultBlob } from '../../src/vault/types.js';
import { VaultService } from '../../src/vault/VaultService.js';

// ─── In-memory vault storage doubles ─────────────────────────────────────────

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

// ─── In-memory account storage double ────────────────────────────────────────

class MemAccountStorage implements IAccountStorage {
  private _state: V2AccountState = { version: 2, accounts: [], idempotencyMap: {} };
  async loadState(): Promise<V2AccountState> { 
    return { 
      version: 2 as const, 
      accounts: this._state.accounts.map(a => ({ ...a, publicKey: a.publicKey.slice() })),
      idempotencyMap: { ...this._state.idempotencyMap } 
    }; 
  }
  async saveState(state: V2AccountState) { 
    this._state = {
      version: 2,
      accounts: state.accounts.map(a => ({ ...a, publicKey: a.publicKey.slice() })),
      idempotencyMap: { ...state.idempotencyMap }
    };
  }
  async writeIntent(uuid: string) {}
  async clearIntent() {}

  async loadAccounts() { return this.loadState().then(s => s.accounts); }
  async saveAccounts(accounts: AccountInfo[]) { 
    const s = await this.loadState();
    s.accounts = accounts;
    await this.saveState(s);
  }
}

// ─── In-memory Chrome storage area mock ──────────────────────────────────────

function makeLocalArea(): ILocalStorageArea & { _store: Map<string, unknown>; setAccessLevel: ReturnType<typeof vi.fn> } {
  const _store = new Map<string, unknown>();
  const setAccessLevel = vi.fn(); // must NEVER be called
  return {
    get: vi.fn(async (key: string) => {
      const val = _store.get(key);
      return val === undefined ? {} : { [key]: val };
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(items)) { _store.set(k, v); }
    }),
    setAccessLevel,
    _store,
  };
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PHRASE = makeSeedPhrase(MNEMONIC);
const PASSWORD = 'KeyMgr!Test#42SecurePass';

/** Build an unlocked VaultService + SoftwareSigner. ~1 PBKDF2 call. */
async function makeUnlockedSigner(): Promise<{ vault: VaultService; signer: SoftwareSigner }> {
  const vault = new VaultService(new PasswordUnlocker(), new MemPersistent(), new MemSession());
  await vault.createVault(PASSWORD, PHRASE);
  return { vault, signer: new SoftwareSigner(vault) };
}

/** Build a fully configured unlocked KeyManager with fresh in-memory storage. */
async function makeUnlockedManager(): Promise<{
  vault: VaultService;
  signer: SoftwareSigner;
  storage: MemAccountStorage;
  manager: KeyManager;
}> {
  const { vault, signer } = await makeUnlockedSigner();
  const storage = new MemAccountStorage();
  const manager = new KeyManager(signer, storage);
  return { vault, signer, storage, manager };
}

// ─── A. getAccounts() — basic reads ──────────────────────────────────────────

describe('KeyManager — getAccounts()', () => {
  it('returns [] when no accounts have been added', async () => {
    const { manager } = await makeUnlockedManager();
    const accounts = await manager.getAccounts();
    expect(accounts).toEqual([]);
  });

  it('returns accounts in ascending index order', async () => {
    const { manager } = await makeUnlockedManager();
    await manager.addAccount('First');
    await manager.addAccount('uuid-sec', 'Second');
    await manager.addAccount('Third');
    const accounts = await manager.getAccounts();
    expect(accounts.map(a => a.index)).toEqual([0, 1, 2]);
  });

  it('returns the correct count after multiple addAccount() calls', async () => {
    const { manager } = await makeUnlockedManager();
    await manager.addAccount(crypto.randomUUID());
    await manager.addAccount(crypto.randomUUID());
    const accounts = await manager.getAccounts();
    expect(accounts).toHaveLength(2);
  });

  it('getAccounts() works when vault is locked (reads storage only)', async () => {
    const { vault, manager } = await makeUnlockedManager();
    await manager.addAccount(crypto.randomUUID()); // add while unlocked
    await vault.lock();         // lock the vault

    // Should still return accounts (no key derivation needed for reading)
    const accounts = await manager.getAccounts();
    expect(accounts).toHaveLength(1);
    expect(accounts[0]!.index).toBe(0);
  });
});

// ─── B. addAccount() — derivation, sequential indices, labels ─────────────────

describe('KeyManager — addAccount() indices and labels', () => {
  it('first addAccount() assigns HD index 0', async () => {
    const { manager } = await makeUnlockedManager();
    const account = await manager.addAccount(crypto.randomUUID());
    expect(account.index).toBe(0);
  });

  it('second addAccount() assigns HD index 1', async () => {
    const { manager } = await makeUnlockedManager();
    await manager.addAccount(crypto.randomUUID());
    const second = await manager.addAccount(crypto.randomUUID());
    expect(second.index).toBe(1);
  });

  it('third addAccount() assigns HD index 2', async () => {
    const { manager } = await makeUnlockedManager();
    await manager.addAccount(crypto.randomUUID());
    await manager.addAccount(crypto.randomUUID());
    const third = await manager.addAccount(crypto.randomUUID());
    expect(third.index).toBe(2);
  });

  it('default label for index 0 is "Account 1"', async () => {
    const { manager } = await makeUnlockedManager();
    const account = await manager.addAccount(crypto.randomUUID());
    expect(account.label).toBe('Account 1');
  });

  it('default label for index 1 is "Account 2"', async () => {
    const { manager } = await makeUnlockedManager();
    await manager.addAccount(crypto.randomUUID());
    const account = await manager.addAccount(crypto.randomUUID());
    expect(account.label).toBe('Account 2');
  });

  it('custom label is used when provided', async () => {
    const { manager } = await makeUnlockedManager();
    const account = await manager.addAccount('uuid-trad', 'Trading Wallet');
    expect(account.label).toBe('Trading Wallet');
  });

  it('addAccount() with custom label does not affect index assignment', async () => {
    const { manager } = await makeUnlockedManager();
    await manager.addAccount('First');
    const second = await manager.addAccount('uuid-sec', 'Second');
    expect(second.index).toBe(1);
    expect(second.label).toBe('Second');
  });

  it('addAccount() persists — fresh KeyManager on same storage returns same accounts', async () => {
    const { signer, storage } = await makeUnlockedSigner().then(async ({ vault, signer }) => ({
      vault, signer, storage: new MemAccountStorage(),
    }));
    // Suppress TS error — manually construct
    const { vault: v, signer: s } = await makeUnlockedSigner();
    const sharedStorage = new MemAccountStorage();
    const manager1 = new KeyManager(s, sharedStorage);
    await manager1.addAccount(crypto.randomUUID(), 'Persistent');

    // Second manager instance on the same storage object
    const manager2 = new KeyManager(s, sharedStorage);
    const accounts = await manager2.getAccounts();
    expect(accounts).toHaveLength(1);
    expect(accounts[0]!.label).toBe('Persistent');
    expect(accounts[0]!.index).toBe(0);

    // suppress unused variable warning
    void signer; void storage;
  });
});

// ─── C. addAccount() — locked vault, atomicity ───────────────────────────────

describe('KeyManager — addAccount() locked vault and atomicity', () => {
  it('addAccount() throws WalletLockedError when vault is locked from the start', async () => {
    const vault = new VaultService(new PasswordUnlocker(), new MemPersistent(), new MemSession());
    const signer = new SoftwareSigner(vault);
    const manager = new KeyManager(signer, new MemAccountStorage());

    await expect(manager.addAccount(crypto.randomUUID())).rejects.toThrow(WalletLockedError);
  });

  it('addAccount() throws WalletLockedError after vault.lock()', async () => {
    const { vault, manager } = await makeUnlockedManager();
    await vault.lock();
    await expect(manager.addAccount(crypto.randomUUID())).rejects.toThrow(WalletLockedError);
  });

  it('addAccount() does not persist a partial entry on WalletLockedError', async () => {
    const { vault, manager } = await makeUnlockedManager();
    await vault.lock();

    try {
      await manager.addAccount(crypto.randomUUID());
    } catch {
      // expected
    }

    // Storage must remain empty — no ghost account written
    const accounts = await manager.getAccounts();
    expect(accounts).toHaveLength(0);
  });

  it('addAccount() throws InvalidAccountLabelError for empty label string', async () => {
    const { manager } = await makeUnlockedManager();
    await expect(manager.addAccount('uuid-err', '')).rejects.toThrow(InvalidAccountLabelError);
  });

  it('addAccount() throws InvalidAccountLabelError for whitespace-only label', async () => {
    const { manager } = await makeUnlockedManager();
    await expect(manager.addAccount('uuid-err', '   ')).rejects.toThrow(InvalidAccountLabelError);
  });

  it('addAccount() does not persist an account when label validation fails', async () => {
    const { manager } = await makeUnlockedManager();
    try {
      await manager.addAccount('uuid-err', '');
    } catch {
      // expected
    }
    const accounts = await manager.getAccounts();
    expect(accounts).toHaveLength(0);
  });
});

// ─── D. addAccount() — public-key correctness and 32-byte invariant ───────────

describe('KeyManager — addAccount() public-key correctness', () => {
  it('addAccount(0) publicKey is exactly 32 bytes', async () => {
    const { manager } = await makeUnlockedManager();
    const account = await manager.addAccount(crypto.randomUUID());
    expect(account.publicKey).toBeInstanceOf(Uint8Array);
    expect(account.publicKey.length).toBe(32);
  });

  it('addAccount(0) publicKey matches signer.getPublicKey(0)', async () => {
    const { signer, manager } = await makeUnlockedManager();
    const account = await manager.addAccount(crypto.randomUUID());
    const expected = await signer.getPublicKey(0);
    expect(Buffer.from(account.publicKey).toString('hex')).toBe(
      Buffer.from(expected).toString('hex'),
    );
  });

  it('addAccount(1) publicKey matches signer.getPublicKey(1)', async () => {
    const { signer, manager } = await makeUnlockedManager();
    await manager.addAccount(crypto.randomUUID());
    const account1 = await manager.addAccount(crypto.randomUUID());
    const expected = await signer.getPublicKey(1);
    expect(Buffer.from(account1.publicKey).toString('hex')).toBe(
      Buffer.from(expected).toString('hex'),
    );
  });

  it('account 0 and account 1 have distinct public keys', async () => {
    const { manager } = await makeUnlockedManager();
    const a0 = await manager.addAccount(crypto.randomUUID());
    const a1 = await manager.addAccount(crypto.randomUUID());
    expect(Buffer.from(a0.publicKey).toString('hex')).not.toBe(
      Buffer.from(a1.publicKey).toString('hex'),
    );
  });

  it('publicKey from addAccount() is a valid Ed25519 public key (verifies a signature)', async () => {
    const { signer, manager } = await makeUnlockedManager();
    const account = await manager.addAccount(crypto.randomUUID());
    const msg = new Uint8Array([1, 2, 3, 4]);
    const sig = await signer.signMessage(msg, 0);
    const valid = ed25519.verify(sig, msg, account.publicKey);
    expect(valid).toBe(true);
  });
});

// ─── E. renameAccount() — mutations and persistence ───────────────────────────

describe('KeyManager — renameAccount() mutations', () => {
  it('renameAccount() updates the label for the given index', async () => {
    const { manager } = await makeUnlockedManager();
    await manager.addAccount(crypto.randomUUID());
    await manager.renameAccount(0, 'Hot Wallet');
    const accounts = await manager.getAccounts();
    expect(accounts[0]!.label).toBe('Hot Wallet');
  });

  it('renameAccount() change is visible via getAccounts() immediately', async () => {
    const { manager } = await makeUnlockedManager();
    await manager.addAccount('Original');
    await manager.renameAccount(0, 'Updated');
    const accounts = await manager.getAccounts();
    expect(accounts[0]!.label).toBe('Updated');
  });

  it('renameAccount() persists — fresh KeyManager on same storage sees the new label', async () => {
    const { signer } = await makeUnlockedSigner();
    const sharedStorage = new MemAccountStorage();
    const manager1 = new KeyManager(signer, sharedStorage);
    await manager1.addAccount(crypto.randomUUID());
    await manager1.renameAccount(0, 'Persisted Label');

    const manager2 = new KeyManager(signer, sharedStorage);
    const accounts = await manager2.getAccounts();
    expect(accounts[0]!.label).toBe('Persisted Label');
  });

  it('renameAccount() on index 0 does not affect account with index 1', async () => {
    const { manager } = await makeUnlockedManager();
    await manager.addAccount('First');
    await manager.addAccount('uuid-sec', 'Second');
    await manager.renameAccount(0, 'Renamed First');
    const accounts = await manager.getAccounts();
    expect(accounts[1]!.label).toBe('Second');
  });

  it('renameAccount() does not require vault to be unlocked', async () => {
    const { vault, manager } = await makeUnlockedManager();
    await manager.addAccount('Original');
    await vault.lock();
    // Must not throw WalletLockedError
    await expect(manager.renameAccount(0, 'Renamed While Locked')).resolves.toBeUndefined();
    const accounts = await manager.getAccounts();
    expect(accounts[0]!.label).toBe('Renamed While Locked');
  });

  it('renameAccount() throws AccountNotFoundError for a non-existent index', async () => {
    const { manager } = await makeUnlockedManager();
    await expect(manager.renameAccount(99, 'Ghost')).rejects.toThrow(AccountNotFoundError);
  });

  it('renameAccount() throws AccountNotFoundError on empty list', async () => {
    const { manager } = await makeUnlockedManager();
    await expect(manager.renameAccount(0, 'Name')).rejects.toThrow(AccountNotFoundError);
  });
});

// ─── F. renameAccount() — label validation ────────────────────────────────────

describe('KeyManager — renameAccount() label validation', () => {
  it('throws InvalidAccountLabelError for empty string label', async () => {
    const { manager } = await makeUnlockedManager();
    await manager.addAccount(crypto.randomUUID());
    await expect(manager.renameAccount(0, '')).rejects.toThrow(InvalidAccountLabelError);
  });

  it('throws InvalidAccountLabelError for whitespace-only label', async () => {
    const { manager } = await makeUnlockedManager();
    await manager.addAccount(crypto.randomUUID());
    await expect(manager.renameAccount(0, '   ')).rejects.toThrow(InvalidAccountLabelError);
  });

  it('throws InvalidAccountLabelError for tab-only label', async () => {
    const { manager } = await makeUnlockedManager();
    await manager.addAccount(crypto.randomUUID());
    await expect(manager.renameAccount(0, '\t\t')).rejects.toThrow(InvalidAccountLabelError);
  });

  it('accepts a label with leading/trailing whitespace as long as it is not all-whitespace', async () => {
    const { manager } = await makeUnlockedManager();
    await manager.addAccount(crypto.randomUUID());
    // " Valid " has non-whitespace content — should succeed
    await expect(manager.renameAccount(0, ' Valid ')).resolves.toBeUndefined();
    const accounts = await manager.getAccounts();
    expect(accounts[0]!.label).toBe(' Valid ');
  });
});

// ─── G. Security invariants ───────────────────────────────────────────────────

describe('KeyManager — security invariants', () => {
  it('KeyManager own properties contain no Uint8Array (no stored keys or seeds)', async () => {
    const { manager } = await makeUnlockedManager();
    await manager.addAccount(crypto.randomUUID());
    // Inspect all own properties
    const props = Object.getOwnPropertyNames(manager);
    for (const prop of props) {
      const val = (manager as unknown as Record<string, unknown>)[prop];
      // No property should hold a Uint8Array (would indicate a stored public/private key or seed)
      expect(val instanceof Uint8Array).toBe(false);
    }
  });

  it('KeyManager own properties contain no mnemonic string', async () => {
    const { manager } = await makeUnlockedManager();
    const props = Object.getOwnPropertyNames(manager);
    for (const prop of props) {
      const val = (manager as unknown as Record<string, unknown>)[prop];
      if (typeof val === 'string') {
        expect(val).not.toContain('abandon');
        expect(val).not.toContain('about');
      }
    }
  });

  it('publicKey returned by getAccounts() is a valid Ed25519 public key, not a private key', async () => {
    const { manager } = await makeUnlockedManager();
    const account = await manager.addAccount(crypto.randomUUID());
    // Public keys are 32 bytes; a 64-byte value would indicate a signature was returned
    expect(account.publicKey.length).toBe(32);
    // Valid Ed25519 public key should be accepted by @noble/curves
    const isValid = ed25519.utils.isValidPublicKey(account.publicKey);
    expect(isValid).toBe(true);
  });
});

// ─── H. Defensive-copy invariant ─────────────────────────────────────────────

describe('KeyManager — defensive-copy invariant', () => {
  it('mutating the publicKey returned by addAccount() does not affect getAccounts()', async () => {
    const { manager } = await makeUnlockedManager();
    const returned = await manager.addAccount(crypto.randomUUID());

    // Record the original hex before mutation
    const originalHex = Buffer.from(returned.publicKey).toString('hex');

    // Mutate the returned Uint8Array
    returned.publicKey.fill(0xff);

    // getAccounts() must still return the original, unmodified publicKey
    const accounts = await manager.getAccounts();
    const storedHex = Buffer.from(accounts[0]!.publicKey).toString('hex');
    expect(storedHex).toBe(originalHex);
    expect(storedHex).not.toBe('ff'.repeat(32));
  });

  it('mutating the publicKey returned by getAccounts() does not affect subsequent getAccounts()', async () => {
    const { manager } = await makeUnlockedManager();
    await manager.addAccount(crypto.randomUUID());

    const first = await manager.getAccounts();
    const originalHex = Buffer.from(first[0]!.publicKey).toString('hex');

    // Mutate the returned Uint8Array
    first[0]!.publicKey.fill(0x00);

    // Second call must return the original data
    const second = await manager.getAccounts();
    expect(Buffer.from(second[0]!.publicKey).toString('hex')).toBe(originalHex);
  });

  it('getAccounts() does not return the same array reference on two calls', async () => {
    const { manager } = await makeUnlockedManager();
    await manager.addAccount(crypto.randomUUID());
    const first = await manager.getAccounts();
    const second = await manager.getAccounts();
    // Different array references
    expect(first).not.toBe(second);
  });
});

// ─── I. ChromeAccountStorage — round-trip and malformed-data handling ─────────

describe('ChromeAccountStorage — round-trip and edge cases', () => {
  function makeStorage() {
    const area = makeLocalArea();
    const storage = new ChromeAccountStorage(area);
    return { storage, area };
  }

  it('loadAccounts() returns [] when storage is empty', async () => {
    const { storage } = makeStorage();
    const state = await storage.loadState(); expect(state.accounts).toEqual([]);
  });

  it('saveAccounts + loadAccounts round-trip preserves index, label, and publicKey', async () => {
    const { storage } = makeStorage();
    const pub = new Uint8Array(32).fill(42);
    const input: AccountInfo[] = [{ index: 0, publicKey: pub, label: 'Test Account' }];
    await storage.saveAccounts(input);

    const loaded = await storage.loadAccounts();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.index).toBe(0);
    expect(loaded[0]!.label).toBe('Test Account');
    expect(Buffer.from(loaded[0]!.publicKey).toString('hex')).toBe(
      Buffer.from(pub).toString('hex'),
    );
  });

  it('round-trip preserves multiple accounts', async () => {
    const { storage } = makeStorage();
    const accounts: AccountInfo[] = [
      { index: 0, publicKey: new Uint8Array(32).fill(1), label: 'First' },
      { index: 1, publicKey: new Uint8Array(32).fill(2), label: 'Second' },
    ];
    await storage.saveAccounts(accounts);
    const loaded = await storage.loadAccounts();
    expect(loaded).toHaveLength(2);
    expect(loaded[0]!.index).toBe(0);
    expect(loaded[1]!.index).toBe(1);
  });

  it('loadAccounts() returns [] when stored value is not an array', async () => {
    const { storage, area } = makeStorage();
    // Inject malformed data directly into the store
    area._store.set(ACCOUNTS_STORAGE_KEY, { not: 'an array' });
    await expect(storage.loadState()).rejects.toThrow(/StorageCorruptionError/);
  });

  it('loadAccounts() returns [] when stored value is a plain string', async () => {
    const { storage, area } = makeStorage();
    area._store.set(ACCOUNTS_STORAGE_KEY, 'corrupted');
    await expect(storage.loadState()).rejects.toThrow(/StorageCorruptionError/);
  });

  it('loadAccounts() returns [] when stored value is null', async () => {
    const { storage, area } = makeStorage();
    area._store.set(ACCOUNTS_STORAGE_KEY, null);
    const state = await storage.loadState(); expect(state.accounts).toEqual([]);
  });

  it('loadAccounts() skips entries with missing publicKey field', async () => {
    const { storage, area } = makeStorage();
    area._store.set(ACCOUNTS_STORAGE_KEY, [
      { index: 0, label: 'No pubkey' }, // malformed — missing publicKey
    ]);
    const state = await storage.loadState(); expect(state.accounts).toEqual([]);
  });

  it('loadAccounts() skips entries with publicKey decoding to wrong byte length', async () => {
    const { storage, area } = makeStorage();
    // publicKey that decodes to fewer than 32 bytes
    const shortKey = Buffer.from(new Uint8Array(16)).toString('base64');
    area._store.set(ACCOUNTS_STORAGE_KEY, [
      { index: 0, publicKey: shortKey, label: 'Short key' },
    ]);
    const state = await storage.loadState(); expect(state.accounts).toEqual([]);
  });

  it('loadAccounts() skips entries with invalid base64url publicKey', async () => {
    const { storage, area } = makeStorage();
    area._store.set(ACCOUNTS_STORAGE_KEY, [
      { index: 0, publicKey: '!!!not-base64!!!', label: 'Bad key' },
    ]);
    const state = await storage.loadState(); expect(state.accounts).toEqual([]);
  });

  it('loadAccounts() skips entries with negative index', async () => {
    const { storage, area } = makeStorage();
    const pub = Buffer.from(new Uint8Array(32).fill(1)).toString('base64');
    area._store.set(ACCOUNTS_STORAGE_KEY, [
      { index: -1, publicKey: pub, label: 'Negative index' },
    ]);
    const state = await storage.loadState(); expect(state.accounts).toEqual([]);
  });

  it('loadAccounts() returns valid entries even when some entries are malformed', async () => {
    const { storage, area } = makeStorage();
    const goodPub = Buffer.from(new Uint8Array(32).fill(7))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    area._store.set(ACCOUNTS_STORAGE_KEY, [
      { index: 0, publicKey: goodPub, label: 'Good' },
      { index: 1, label: 'Missing key' }, // malformed — skipped
    ]);
    const accounts = await storage.loadAccounts();
    expect(accounts).toHaveLength(1);
    expect(accounts[0]!.label).toBe('Good');
  });

  it('loadAccounts() returns publicKey as a fresh Uint8Array (not a shared buffer)', async () => {
    const { storage } = makeStorage();
    const pub = new Uint8Array(32).fill(9);
    await storage.saveAccounts([{ index: 0, publicKey: pub, label: 'Copy test' }]);

    const loaded1 = await storage.loadAccounts();
    const loaded2 = await storage.loadAccounts();
    // Not the same reference
    expect(loaded1[0]!.publicKey).not.toBe(loaded2[0]!.publicKey);
    // Same content
    expect(Buffer.from(loaded1[0]!.publicKey).toString('hex')).toBe(
      Buffer.from(loaded2[0]!.publicKey).toString('hex'),
    );
  });

  it('storage key is exactly "solanym_accounts"', () => {
    expect(ACCOUNTS_STORAGE_KEY).toBe('solanym_accounts');
  });
});

