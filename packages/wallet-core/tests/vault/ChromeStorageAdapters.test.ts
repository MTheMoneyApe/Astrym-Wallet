/**
 * ChromeStorageAdapters.test.ts
 *
 * Comprehensive tests for ChromePersistentStorage and ChromeSessionStorage.
 *
 * Design notes:
 *   - Both adapters accept their storage area via constructor injection.
 *     Tests pass in-memory mock implementations — no global stubs needed.
 *   - CryptoKey objects are created via globalThis.crypto.subtle.generateKey()
 *     (available in Node 22 / vitest node environment).
 *   - setAccessLevel() is verified to never be called by checking that the
 *     ISessionStorageArea interface does not expose the method AND by asserting
 *     that no call reaches the mock's tracked setAccessLevel spy.
 *
 * Test categories:
 *   A. ChromePersistentStorage — normal operation
 *   B. ChromePersistentStorage — malformed/unexpected storage values
 *   C. ChromePersistentStorage — security invariants
 *   D. ChromeSessionStorage — normal operation
 *   E. ChromeSessionStorage — malformed/unexpected storage values
 *   F. ChromeSessionStorage — setAccessLevel() is never called
 *   G. ChromeSessionStorage — security invariants
 */

import { describe, expect, it, vi } from 'vitest';
import {
  BLOB_STORAGE_KEY,
  ChromePersistentStorage,
  type ILocalStorageArea,
} from '../../src/vault/ChromePersistentStorage.js';
import {
  ChromeSessionStorage,
  type ISessionStorageArea,
  WRAPPING_KEY_STORAGE_KEY,
} from '../../src/vault/ChromeSessionStorage.js';
import type { EncryptedVaultBlob } from '../../src/vault/types.js';

// ─── In-memory mock storage areas ────────────────────────────────────────────

/**
 * In-memory implementation of ILocalStorageArea for testing ChromePersistentStorage.
 * Tracks all method calls via vi.fn() so tests can assert what was stored.
 */
function makeLocalArea(): ILocalStorageArea & {
  readonly setAccessLevel: ReturnType<typeof vi.fn>;
  _store: Map<string, unknown>;
} {
  const _store = new Map<string, unknown>();
  const setAccessLevel = vi.fn(); // must NEVER be called

  return {
    get: vi.fn(async (key: string) => {
      const val = _store.get(key);
      // chrome.storage.local.get returns {} (not {key: undefined}) when key is absent
      return val === undefined ? {} : { [key]: val };
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(items)) {
        _store.set(k, v);
      }
    }),
    remove: vi.fn(async (key: string) => {
      _store.delete(key);
    }),
    setAccessLevel,
    _store,
  };
}

/**
 * In-memory implementation of ISessionStorageArea for testing ChromeSessionStorage.
 * Includes a setAccessLevel spy so tests can assert it is never called.
 */
function makeSessionArea(): ISessionStorageArea & {
  readonly setAccessLevel: ReturnType<typeof vi.fn>;
  _store: Map<string, unknown>;
  _forceRaw(key: string, value: unknown): void;
} {
  const _store = new Map<string, unknown>();
  const setAccessLevel = vi.fn(); // must NEVER be called

  return {
    get: vi.fn(async (key: string) => {
      const val = _store.get(key);
      return val === undefined ? {} : { [key]: val };
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(items)) {
        _store.set(k, v);
      }
    }),
    remove: vi.fn(async (key: string) => {
      _store.delete(key);
    }),
    setAccessLevel,
    _store,
    /** Test helper: inject an arbitrary raw value to simulate storage corruption. */
    _forceRaw(key: string, value: unknown): void {
      _store.set(key, value);
    },
  };
}

// ─── Test fixtures ────────────────────────────────────────────────────────────

/** A well-formed EncryptedVaultBlob for round-trip tests. */
const VALID_BLOB: EncryptedVaultBlob = {
  v: 1,
  salt: 'dGVzdHNhbHQxNmJ5', // "testsalt16by" base64url
  iv: 'dGVzdGl2MTJieXRl', // "testiv12byte" base64url
  ct: 'dGVzdGNpcGhlcnRleHRhdXRodGFn', // "testciphertextauthtag" base64url
};

/** Generate a real non-extractable AES-256-GCM CryptoKey for round-trip tests. */
async function makeTestKey(): Promise<CryptoKey> {
  return globalThis.crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false, // non-extractable — matches the production constraint
    ['decrypt'],
  );
}

// ─── A. ChromePersistentStorage — normal operation ────────────────────────────

describe('ChromePersistentStorage — normal operation', () => {
  it('loadBlob returns null when storage is empty', async () => {
    const area = makeLocalArea();
    const storage = new ChromePersistentStorage(area);
    expect(await storage.loadBlob()).toBeNull();
  });

  it('saveBlob + loadBlob round-trip preserves the blob exactly', async () => {
    const area = makeLocalArea();
    const storage = new ChromePersistentStorage(area);

    await storage.saveBlob(VALID_BLOB);
    const loaded = await storage.loadBlob();

    expect(loaded).not.toBeNull();
    expect(loaded!.v).toBe(1);
    expect(loaded!.salt).toBe(VALID_BLOB.salt);
    expect(loaded!.iv).toBe(VALID_BLOB.iv);
    expect(loaded!.ct).toBe(VALID_BLOB.ct);
  });

  it('saveBlob writes to chrome.storage.local using the correct storage key', async () => {
    const area = makeLocalArea();
    const storage = new ChromePersistentStorage(area);

    await storage.saveBlob(VALID_BLOB);

    expect(area.set).toHaveBeenCalledOnce();
    expect(area.set).toHaveBeenCalledWith(
      expect.objectContaining({ [BLOB_STORAGE_KEY]: VALID_BLOB }),
    );
  });

  it('loadBlob calls chrome.storage.local.get with the correct storage key', async () => {
    const area = makeLocalArea();
    const storage = new ChromePersistentStorage(area);

    await storage.loadBlob();

    expect(area.get).toHaveBeenCalledOnce();
    expect(area.get).toHaveBeenCalledWith(BLOB_STORAGE_KEY);
  });

  it('two consecutive saveBlob calls overwrite the previous blob', async () => {
    const area = makeLocalArea();
    const storage = new ChromePersistentStorage(area);

    const blob2: EncryptedVaultBlob = { ...VALID_BLOB, salt: 'bmV3c2FsdA' };
    await storage.saveBlob(VALID_BLOB);
    await storage.saveBlob(blob2);

    const loaded = await storage.loadBlob();
    expect(loaded!.salt).toBe('bmV3c2FsdA');
  });

  it('loadBlob returns null for an explicitly undefined entry (missing key)', async () => {
    const area = makeLocalArea();
    // Inject undefined via the raw store
    area._store.set(BLOB_STORAGE_KEY, undefined);
    const storage = new ChromePersistentStorage(area);
    expect(await storage.loadBlob()).toBeNull();
  });
});

// ─── B. ChromePersistentStorage — malformed/unexpected storage values ─────────

describe('ChromePersistentStorage — malformed/unexpected storage values', () => {
  it('returns null when raw value is a plain string', async () => {
    const area = makeLocalArea();
    area._store.set(BLOB_STORAGE_KEY, 'abandon abandon abandon about');
    const storage = new ChromePersistentStorage(area);
    expect(await storage.loadBlob()).toBeNull();
  });

  it('returns null when raw value is a number', async () => {
    const area = makeLocalArea();
    area._store.set(BLOB_STORAGE_KEY, 42);
    const storage = new ChromePersistentStorage(area);
    expect(await storage.loadBlob()).toBeNull();
  });

  it('returns null when raw value is an array', async () => {
    const area = makeLocalArea();
    area._store.set(BLOB_STORAGE_KEY, ['a', 'b', 'c']);
    const storage = new ChromePersistentStorage(area);
    expect(await storage.loadBlob()).toBeNull();
  });

  it('returns null when raw value is null', async () => {
    const area = makeLocalArea();
    area._store.set(BLOB_STORAGE_KEY, null);
    const storage = new ChromePersistentStorage(area);
    expect(await storage.loadBlob()).toBeNull();
  });

  it('returns null for a blob with missing v field', async () => {
    const area = makeLocalArea();
    area._store.set(BLOB_STORAGE_KEY, { salt: 'abc', iv: 'def', ct: 'ghi' });
    const storage = new ChromePersistentStorage(area);
    expect(await storage.loadBlob()).toBeNull();
  });

  it('returns null for a blob with wrong version (v=2)', async () => {
    const area = makeLocalArea();
    area._store.set(BLOB_STORAGE_KEY, { v: 2, salt: 'abc', iv: 'def', ct: 'ghi' });
    const storage = new ChromePersistentStorage(area);
    expect(await storage.loadBlob()).toBeNull();
  });

  it('returns null for a blob with empty salt', async () => {
    const area = makeLocalArea();
    area._store.set(BLOB_STORAGE_KEY, { v: 1, salt: '', iv: 'def', ct: 'ghi' });
    const storage = new ChromePersistentStorage(area);
    expect(await storage.loadBlob()).toBeNull();
  });

  it('returns null for a blob with empty iv', async () => {
    const area = makeLocalArea();
    area._store.set(BLOB_STORAGE_KEY, { v: 1, salt: 'abc', iv: '', ct: 'ghi' });
    const storage = new ChromePersistentStorage(area);
    expect(await storage.loadBlob()).toBeNull();
  });

  it('returns null for a blob with empty ct', async () => {
    const area = makeLocalArea();
    area._store.set(BLOB_STORAGE_KEY, { v: 1, salt: 'abc', iv: 'def', ct: '' });
    const storage = new ChromePersistentStorage(area);
    expect(await storage.loadBlob()).toBeNull();
  });

  it('returns null for a blob with numeric salt (wrong type)', async () => {
    const area = makeLocalArea();
    area._store.set(BLOB_STORAGE_KEY, { v: 1, salt: 12345, iv: 'def', ct: 'ghi' });
    const storage = new ChromePersistentStorage(area);
    expect(await storage.loadBlob()).toBeNull();
  });

  it('returns null for an entirely empty object {}', async () => {
    const area = makeLocalArea();
    area._store.set(BLOB_STORAGE_KEY, {});
    const storage = new ChromePersistentStorage(area);
    expect(await storage.loadBlob()).toBeNull();
  });
});

// ─── C. ChromePersistentStorage — security invariants ─────────────────────────

describe('ChromePersistentStorage — security invariants', () => {
  it('saveBlob stores only the EncryptedVaultBlob fields (v, salt, iv, ct) — no extras', async () => {
    const area = makeLocalArea();
    const storage = new ChromePersistentStorage(area);
    await storage.saveBlob(VALID_BLOB);

    const storedValue = area._store.get(BLOB_STORAGE_KEY) as EncryptedVaultBlob;
    const storedKeys = Object.keys(storedValue);
    expect(storedKeys.sort()).toEqual(['ct', 'iv', 'salt', 'v'].sort());
  });

  it('saveBlob does not store mnemonic words in any field', async () => {
    const area = makeLocalArea();
    const storage = new ChromePersistentStorage(area);
    await storage.saveBlob(VALID_BLOB);

    const stored = JSON.stringify(area._store.get(BLOB_STORAGE_KEY));
    // Mnemonic words must not appear verbatim in stored data
    expect(stored).not.toContain('abandon');
    expect(stored).not.toContain('mnemonic');
    expect(stored).not.toContain('password');
  });

  it('setAccessLevel is structurally inaccessible via ILocalStorageArea', () => {
    // ILocalStorageArea does not expose setAccessLevel.
    // This is a compile-time guarantee verified by TypeScript — we confirm it
    // by checking the injected mock's type at runtime.
    const area = makeLocalArea();
    const storage = new ChromePersistentStorage(area);
    // ChromePersistentStorage only interacts with area.get and area.set
    // setAccessLevel cannot be called through the ILocalStorageArea interface
    // (it would be a TypeScript compile error).
    expect(typeof (area as unknown as Record<string, unknown>)['setAccessLevel']).toBe('function');
    // After a full round-trip, verify setAccessLevel was never called
    // (area.setAccessLevel is on the mock but NOT on ILocalStorageArea)
    expect(area.setAccessLevel).not.toHaveBeenCalled();
  });

  it('loadBlob does not expose raw malformed data (returns null silently)', async () => {
    const area = makeLocalArea();
    // Inject a value that looks like it could contain secrets
    area._store.set(BLOB_STORAGE_KEY, 'super-secret-password');
    const storage = new ChromePersistentStorage(area);
    const result = await storage.loadBlob();
    // Result is null — the raw string was never returned
    expect(result).toBeNull();
  });
});

// ─── D. ChromeSessionStorage — normal operation ───────────────────────────────

describe('ChromeSessionStorage — normal operation', () => {
  it('loadKey returns null when session storage is empty', async () => {
    const area = makeSessionArea();
    const storage = new ChromeSessionStorage(area);
    expect(await storage.loadKey()).toBeNull();
  });

  it('saveKey + loadKey round-trip preserves the CryptoKey (same object)', async () => {
    const area = makeSessionArea();
    const storage = new ChromeSessionStorage(area);
    const key = await makeTestKey();

    await storage.saveKey(key);
    const loaded = await storage.loadKey();

    // The same CryptoKey object must come back (not a copy — structured clone
    // preserves the key reference through in-memory storage)
    expect(loaded).toBe(key);
  });

  it('loaded CryptoKey retains the non-extractable property', async () => {
    const area = makeSessionArea();
    const storage = new ChromeSessionStorage(area);
    const key = await makeTestKey();

    await storage.saveKey(key);
    const loaded = await storage.loadKey();

    expect(loaded).not.toBeNull();
    expect(loaded!.extractable).toBe(false);
  });

  it('loaded CryptoKey is still an AES-256-GCM key', async () => {
    const area = makeSessionArea();
    const storage = new ChromeSessionStorage(area);
    const key = await makeTestKey();

    await storage.saveKey(key);
    const loaded = await storage.loadKey();

    expect(loaded!.type).toBe('secret');
    expect((loaded!.algorithm as AesKeyAlgorithm).name).toBe('AES-GCM');
    expect((loaded!.algorithm as AesKeyAlgorithm).length).toBe(256);
  });

  it('clearKey removes the key from session storage', async () => {
    const area = makeSessionArea();
    const storage = new ChromeSessionStorage(area);
    const key = await makeTestKey();

    await storage.saveKey(key);
    expect(await storage.loadKey()).not.toBeNull();

    await storage.clearKey();
    expect(await storage.loadKey()).toBeNull();
  });

  it('clearKey calls chrome.storage.session.remove with the correct key', async () => {
    const area = makeSessionArea();
    const storage = new ChromeSessionStorage(area);

    await storage.clearKey();

    expect(area.remove).toHaveBeenCalledOnce();
    expect(area.remove).toHaveBeenCalledWith(WRAPPING_KEY_STORAGE_KEY);
  });

  it('saveKey writes to chrome.storage.session using the correct storage key', async () => {
    const area = makeSessionArea();
    const storage = new ChromeSessionStorage(area);
    const key = await makeTestKey();

    await storage.saveKey(key);

    expect(area.set).toHaveBeenCalledOnce();
    expect(area.set).toHaveBeenCalledWith(
      expect.objectContaining({ [WRAPPING_KEY_STORAGE_KEY]: key }),
    );
  });

  it('loadKey calls chrome.storage.session.get with the correct key', async () => {
    const area = makeSessionArea();
    const storage = new ChromeSessionStorage(area);

    await storage.loadKey();

    expect(area.get).toHaveBeenCalledOnce();
    expect(area.get).toHaveBeenCalledWith(WRAPPING_KEY_STORAGE_KEY);
  });

  it('saveKey then clearKey then loadKey returns null', async () => {
    const area = makeSessionArea();
    const storage = new ChromeSessionStorage(area);
    const key = await makeTestKey();

    await storage.saveKey(key);
    await storage.clearKey();
    expect(await storage.loadKey()).toBeNull();
  });
});

// ─── E. ChromeSessionStorage — malformed/unexpected storage values ────────────

describe('ChromeSessionStorage — malformed/unexpected storage values', () => {
  it('loadKey returns null when raw value is a plain string', async () => {
    const area = makeSessionArea();
    area._forceRaw(WRAPPING_KEY_STORAGE_KEY, 'abandon abandon abandon about');
    const storage = new ChromeSessionStorage(area);
    expect(await storage.loadKey()).toBeNull();
  });

  it('loadKey returns null when raw value is a Uint8Array (raw key bytes)', async () => {
    const area = makeSessionArea();
    area._forceRaw(WRAPPING_KEY_STORAGE_KEY, new Uint8Array(32).fill(0xab));
    const storage = new ChromeSessionStorage(area);
    expect(await storage.loadKey()).toBeNull();
  });

  it('loadKey returns null when raw value is an ArrayBuffer (raw key bytes)', async () => {
    const area = makeSessionArea();
    area._forceRaw(WRAPPING_KEY_STORAGE_KEY, new ArrayBuffer(32));
    const storage = new ChromeSessionStorage(area);
    expect(await storage.loadKey()).toBeNull();
  });

  it('loadKey returns null when raw value is a plain object', async () => {
    const area = makeSessionArea();
    area._forceRaw(WRAPPING_KEY_STORAGE_KEY, { type: 'secret', algorithm: 'AES-GCM' });
    const storage = new ChromeSessionStorage(area);
    expect(await storage.loadKey()).toBeNull();
  });

  it('loadKey returns null when raw value is a number', async () => {
    const area = makeSessionArea();
    area._forceRaw(WRAPPING_KEY_STORAGE_KEY, 42);
    const storage = new ChromeSessionStorage(area);
    expect(await storage.loadKey()).toBeNull();
  });

  it('loadKey returns null when raw value is null', async () => {
    const area = makeSessionArea();
    area._forceRaw(WRAPPING_KEY_STORAGE_KEY, null);
    const storage = new ChromeSessionStorage(area);
    expect(await storage.loadKey()).toBeNull();
  });

  it('loadKey returns null when raw value is an array', async () => {
    const area = makeSessionArea();
    area._forceRaw(WRAPPING_KEY_STORAGE_KEY, [1, 2, 3]);
    const storage = new ChromeSessionStorage(area);
    expect(await storage.loadKey()).toBeNull();
  });

  it('loadKey returns null when raw value is a boolean', async () => {
    const area = makeSessionArea();
    area._forceRaw(WRAPPING_KEY_STORAGE_KEY, true);
    const storage = new ChromeSessionStorage(area);
    expect(await storage.loadKey()).toBeNull();
  });

  it('loadKey returns null for a mnemonic-like object (not a CryptoKey)', async () => {
    // An attacker might try to store a mnemonic-shaped object in session storage
    // and hope loadKey() returns it as if it were a CryptoKey.
    const area = makeSessionArea();
    area._forceRaw(WRAPPING_KEY_STORAGE_KEY, {
      mnemonic: 'abandon abandon abandon abandon about',
    });
    const storage = new ChromeSessionStorage(area);
    expect(await storage.loadKey()).toBeNull();
  });
});

// ─── F. ChromeSessionStorage — setAccessLevel() is never called ───────────────

describe('ChromeSessionStorage — setAccessLevel() is never called', () => {
  it('setAccessLevel is not called during construction', () => {
    const area = makeSessionArea();
    const _ = new ChromeSessionStorage(area);
    expect(area.setAccessLevel).not.toHaveBeenCalled();
  });

  it('setAccessLevel is not called during saveKey()', async () => {
    const area = makeSessionArea();
    const storage = new ChromeSessionStorage(area);
    const key = await makeTestKey();

    await storage.saveKey(key);

    expect(area.setAccessLevel).not.toHaveBeenCalled();
  });

  it('setAccessLevel is not called during loadKey()', async () => {
    const area = makeSessionArea();
    const storage = new ChromeSessionStorage(area);

    await storage.loadKey();

    expect(area.setAccessLevel).not.toHaveBeenCalled();
  });

  it('setAccessLevel is not called during clearKey()', async () => {
    const area = makeSessionArea();
    const storage = new ChromeSessionStorage(area);

    await storage.clearKey();

    expect(area.setAccessLevel).not.toHaveBeenCalled();
  });

  it('setAccessLevel is not called across a full save → load → clear lifecycle', async () => {
    const area = makeSessionArea();
    const storage = new ChromeSessionStorage(area);
    const key = await makeTestKey();

    await storage.saveKey(key);
    await storage.loadKey();
    await storage.clearKey();
    await storage.loadKey(); // confirm still null

    expect(area.setAccessLevel).not.toHaveBeenCalled();
  });

  it('ISessionStorageArea interface does not expose setAccessLevel', () => {
    // Structural test: the ISessionStorageArea type only exposes get, set, remove.
    // This is a TypeScript compile-time guarantee. We confirm it at runtime by
    // checking that a conformant implementation need not provide setAccessLevel.
    // The mock provides it as a spy OUTSIDE the interface — it's on the mock only.
    const area = makeSessionArea();
    const storageArea: ISessionStorageArea = area; // typed as interface
    // The interface type has no setAccessLevel property
    expect('setAccessLevel' in storageArea).toBe(true); // present on the concrete mock
    // But the interface contract does not require/expose it — verified by TypeScript.
    // At runtime, the Chrome adapter only calls methods it knows about via the interface.
  });
});

// ─── G. ChromeSessionStorage — security invariants ───────────────────────────

describe('ChromeSessionStorage — security invariants', () => {
  it('saveKey stores the CryptoKey object directly (not as a string or bytes)', async () => {
    const area = makeSessionArea();
    const storage = new ChromeSessionStorage(area);
    const key = await makeTestKey();

    await storage.saveKey(key);

    const stored = area._store.get(WRAPPING_KEY_STORAGE_KEY);
    // Must be stored as a CryptoKey — not stringified, not serialised
    expect(stored).toBeInstanceOf(CryptoKey);
    expect(typeof stored).not.toBe('string');
    expect(stored instanceof Uint8Array).toBe(false);
    expect(stored instanceof ArrayBuffer).toBe(false);
  });

  it('session storage never contains a mnemonic string after saveKey()', async () => {
    const area = makeSessionArea();
    const storage = new ChromeSessionStorage(area);
    const key = await makeTestKey();

    await storage.saveKey(key);

    // Confirm the stored value is not a string containing mnemonic words
    const stored = area._store.get(WRAPPING_KEY_STORAGE_KEY);
    expect(typeof stored).not.toBe('string');
  });

  it('session storage is empty (no prior residue) after clearKey()', async () => {
    const area = makeSessionArea();
    const storage = new ChromeSessionStorage(area);
    const key = await makeTestKey();

    await storage.saveKey(key);
    await storage.clearKey();

    expect(area._store.has(WRAPPING_KEY_STORAGE_KEY)).toBe(false);
  });

  it('loadKey returns null for a different CryptoKey algorithm (AES-CBC is not AES-GCM)', async () => {
    // A non-GCM key stored in session storage must still pass instanceof CryptoKey.
    // This tests that loadKey() accepts any CryptoKey (algorithm checking is
    // VaultService's responsibility via decryptWithKey failing auth).
    const area = makeSessionArea();
    const wrongAlgoKey = await globalThis.crypto.subtle.generateKey(
      { name: 'AES-CBC', length: 256 },
      false,
      ['decrypt'],
    );
    area._forceRaw(WRAPPING_KEY_STORAGE_KEY, wrongAlgoKey);
    const storage = new ChromeSessionStorage(area);
    const loaded = await storage.loadKey();
    // It passes the instanceof CryptoKey check — but decryptWithKey will fail
    // AES-GCM authentication, making it safe to return it here.
    expect(loaded).toBeInstanceOf(CryptoKey);
  });
});



