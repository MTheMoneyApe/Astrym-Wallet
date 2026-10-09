/**
 * vault/IVaultStorage.ts — Storage abstraction interfaces for VaultService.
 *
 * These interfaces are the injection boundary between VaultService and the
 * platform's storage APIs (chrome.storage.local / chrome.storage.session).
 *
 * Two separate interfaces enforce the security constraint that the session
 * storage may ONLY hold the AES-256-GCM wrapping CryptoKey — nothing else.
 *
 * SECURITY:
 *   - IPersistentStorage stores ONLY the EncryptedVaultBlob (ciphertext).
 *   - ISessionStorage stores ONLY the derived AES-256-GCM CryptoKey.
 *   - Neither interface receives mnemonic, private keys, or passwords.
 *   - setAccessLevel() is NEVER called on chrome.storage.session — the interface
 *     does not expose such a method, and implementations must not call it.
 */

import type { EncryptedVaultBlob } from './types.js';

// ── Persistent storage (chrome.storage.local in the extension) ────────────────

export interface IPersistentStorage {
  /**
   * Load the encrypted vault blob from persistent storage.
   * Returns null if no vault has been created yet.
   */
  loadBlob(): Promise<EncryptedVaultBlob | null>;

  /**
   * Persist the encrypted vault blob.
   * Only the ciphertext blob may be stored — never mnemonic or keys.
   */
  saveBlob(blob: EncryptedVaultBlob): Promise<void>;

  /**
   * Remove the encrypted vault blob from persistent storage.
   * Used for rollback mechanisms and full resets.
   */
  clearBlob(): Promise<void>;
}

// ── Session storage (chrome.storage.session in the extension) ─────────────────

export interface ISessionStorage {
  /**
   * Load the cached AES-256-GCM wrapping key from session storage.
   * Returns null if no key is cached (wallet is fully locked / session expired).
   *
   * SECURITY BOUNDARY:
   *   - Only a CryptoKey object may be retrieved — no mnemonic, no raw key bytes.
   *   - Session storage is NOT encrypted at rest. The security property is
   *     in-memory/session-scoped persistence, NOT encryption at rest.
   */
  loadKey(): Promise<CryptoKey | null>;

  /**
   * Cache the AES-256-GCM wrapping key in session storage.
   *
   * SECURITY:
   *   - Only a CryptoKey (non-extractable) may be stored — never a mnemonic,
   *     private key, raw key bytes, or password.
   *   - setAccessLevel() must NEVER be called. Session storage must remain
   *     restricted to TRUSTED_CONTEXTS only (the default).
   */
  saveKey(key: CryptoKey): Promise<void>;

  /**
   * Remove the cached wrapping key from session storage.
   * Called on explicit lock, auto-lock, and logout.
   */
  clearKey(): Promise<void>;
}
