/**
 * vault/ChromePersistentStorage.ts — chrome.storage.local adapter.
 *
 * Implements IPersistentStorage on top of chrome.storage.local.
 *
 * SECURITY INVARIANTS:
 *   - Only EncryptedVaultBlob is ever written to chrome.storage.local.
 *   - Mnemonic, passwords, raw key bytes, and plaintext vault contents
 *     are NEVER passed to this adapter or stored by it.
 *   - Malformed / unexpected data read back from storage is treated as
 *     "no vault" (returns null) — the value is never logged.
 *
 * TypeScript enforces that saveBlob() can only accept EncryptedVaultBlob.
 * loadBlob() re-validates the runtime shape before returning, because
 * chrome.storage.local is weakly-typed (returns Record<string, unknown>).
 *
 * @types/chrome is intentionally NOT imported — this file declares the minimal
 * local StorageArea interface it needs, keeping the wallet-core package
 * independent of the browser-extension type package.
 */

import type { IPersistentStorage } from './IVaultStorage.js';
import type { EncryptedVaultBlob, VaultVersion } from './types.js';

// ── Minimal local interface for the chrome.storage.local StorageArea ──────────
// Only the methods this adapter calls are declared. This avoids a dependency
// on @types/chrome while remaining fully type-safe within this file.

export interface ILocalStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

// ── Storage key ───────────────────────────────────────────────────────────────

/** Key under which the vault blob is stored in chrome.storage.local. */
export const BLOB_STORAGE_KEY = 'solanym_vault_blob' as const;

// ── Runtime validator ─────────────────────────────────────────────────────────

/**
 * Runtime type guard for EncryptedVaultBlob.
 *
 * Validates structural properties only. Cryptographic content (salt/IV byte
 * lengths, ciphertext authenticity) is validated by PasswordUnlocker.
 */
function isEncryptedVaultBlob(raw: unknown): raw is EncryptedVaultBlob {
  if (typeof raw !== 'object' || raw === null) return false;
  const o = raw as Record<string, unknown>;
  return (
    o['v'] === (1 as VaultVersion) &&
    typeof o['salt'] === 'string' && (o['salt'] as string).length > 0 &&
    typeof o['iv'] === 'string' && (o['iv'] as string).length > 0 &&
    typeof o['ct'] === 'string' && (o['ct'] as string).length > 0
  );
}

// ── Adapter ───────────────────────────────────────────────────────────────────

/**
 * Persistent vault storage backed by chrome.storage.local.
 *
 * Inject the storage area via the constructor for testability.
 * In the extension service worker, pass `chrome.storage.local`.
 *
 * @example
 *   const storage = new ChromePersistentStorage(chrome.storage.local);
 */
export class ChromePersistentStorage implements IPersistentStorage {
  constructor(private readonly _area: ILocalStorageArea) {}

  /**
   * Load the encrypted vault blob from chrome.storage.local.
   *
   * Returns null if:
   *   - The key has never been set (no vault created yet).
   *   - The stored value fails the structural type guard (storage corruption).
   *
   * SECURITY: Raw data from storage is never logged, regardless of its shape.
   */
  async loadBlob(): Promise<EncryptedVaultBlob | null> {
    const result = await this._area.get(BLOB_STORAGE_KEY);
    const raw: unknown = result[BLOB_STORAGE_KEY];

    if (raw === undefined || raw === null) {
      return null; // key was never set — no vault exists yet
    }

    if (!isEncryptedVaultBlob(raw)) {
      // Storage contains unexpected data — treat as absent vault rather than crash.
      // SECURITY: do not log `raw` — it may contain corrupted secret bytes.
      return null;
    }

    return raw;
  }

  /**
   * Save the encrypted vault blob to chrome.storage.local.
   *
   * TypeScript ensures only EncryptedVaultBlob can be passed — no mnemonic,
   * password, key material, or plaintext vault contents can reach this method.
   */
  async saveBlob(blob: EncryptedVaultBlob): Promise<void> {
    await this._area.set({ [BLOB_STORAGE_KEY]: blob });
  }

  /**
   * Remove the encrypted vault blob from chrome.storage.local.
   */
  async clearBlob(): Promise<void> {
    await this._area.remove(BLOB_STORAGE_KEY);
  }
}

