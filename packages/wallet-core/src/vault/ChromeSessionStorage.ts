/**
 * vault/ChromeSessionStorage.ts — chrome.storage.session adapter.
 *
 * Implements ISessionStorage on top of chrome.storage.session.
 *
 * SECURITY INVARIANTS:
 *   - Only a non-extractable AES-256-GCM CryptoKey is ever stored.
 *   - Mnemonic, passwords, raw key bytes, plaintext vault contents, and private
 *     keys are NEVER passed to this adapter or stored by it.
 *   - setAccessLevel() is NEVER called — session storage must remain restricted
 *     to TRUSTED_CONTEXTS (the default). This keeps it inaccessible to content
 *     scripts and web pages.
 *   - chrome.storage.session is NOT encrypted at rest. Its security property is
 *     in-memory / session-scoped persistence. The stored CryptoKey is
 *     non-extractable, so raw key material cannot be read even by extension code.
 *   - loadKey() validates the retrieved value is a CryptoKey before returning it.
 *     Any non-CryptoKey value is rejected (returns null).
 *
 * @types/chrome is intentionally NOT imported — this file declares the minimal
 * local SessionStorageArea interface it needs.
 */

import type { ISessionStorage } from './IVaultStorage.js';

// ── Minimal local interface for the chrome.storage.session StorageArea ────────

export interface ISessionStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
  // NOTE: setAccessLevel() is intentionally absent from this interface.
  // Implementations must NOT call it. The default access level (TRUSTED_CONTEXTS)
  // must be preserved to prevent content scripts from reading the wrapping key.
}

// ── Storage key ───────────────────────────────────────────────────────────────

/** Key under which the AES-GCM wrapping key is stored in chrome.storage.session. */
export const WRAPPING_KEY_STORAGE_KEY = 'solanym_wrapping_key' as const;

// ── Adapter ───────────────────────────────────────────────────────────────────

/**
 * Session-scoped vault key storage backed by chrome.storage.session.
 *
 * Inject the storage area via the constructor for testability.
 * In the extension service worker, pass `chrome.storage.session`.
 *
 * IMPORTANT: setAccessLevel() must NEVER be called — neither in this class
 * nor in any code that constructs it. The ISessionStorageArea interface does
 * not expose setAccessLevel(), making it structurally impossible to call it
 * through this adapter.
 *
 * @example
 *   const storage = new ChromeSessionStorage(chrome.storage.session);
 */
export class ChromeSessionStorage implements ISessionStorage {
  constructor(private readonly _area: ISessionStorageArea) {
    // No constructor body — no setup, no setAccessLevel() call.
    // The absence of a constructor body is a deliberate security property.
  }

  /**
   * Load the AES-256-GCM wrapping key from chrome.storage.session.
   *
   * Returns null if:
   *   - The key has never been set (wallet is fully locked).
   *   - The retrieved value is not a CryptoKey (unexpected type — storage
   *     tampered or corrupted).
   *
   * SECURITY: Raw data from storage is never logged. Any non-CryptoKey value
   * is silently rejected to prevent exposure of unexpected secret material.
   */
  async loadKey(): Promise<CryptoKey | null> {
    const result = await this._area.get(WRAPPING_KEY_STORAGE_KEY);
    const raw: unknown = result[WRAPPING_KEY_STORAGE_KEY];

    if (raw === undefined || raw === null) {
      return null; // session has expired or wallet was explicitly locked
    }

    // Runtime type guard: only accept a genuine CryptoKey object.
    // Rejects strings, Uint8Arrays, plain objects, and any other type.
    // This is the runtime enforcement of the "only CryptoKey in session storage" invariant.
    // SECURITY: do not log `raw` if the guard fails.
    if (!(raw instanceof CryptoKey)) {
      return null;
    }

    return raw;
  }

  /**
   * Store the AES-256-GCM wrapping key in chrome.storage.session.
   *
   * TypeScript ensures only CryptoKey can be passed — no mnemonic, password,
   * Uint8Array, or raw key bytes can reach this method via the type system.
   *
   * chrome.storage.session persists CryptoKey objects via the structured clone
   * algorithm, which preserves the non-extractable property across SW suspensions.
   *
   * SECURITY: setAccessLevel() is NOT called here or anywhere in this class.
   */
  async saveKey(key: CryptoKey): Promise<void> {
    await this._area.set({ [WRAPPING_KEY_STORAGE_KEY]: key });
  }

  /**
   * Remove the wrapping key from chrome.storage.session.
   *
   * Called by VaultService.lock() and on explicit logout.
   * After this call, tryRestoreFromSession() will return false until
   * the next successful unlock.
   */
  async clearKey(): Promise<void> {
    await this._area.remove(WRAPPING_KEY_STORAGE_KEY);
  }
}
