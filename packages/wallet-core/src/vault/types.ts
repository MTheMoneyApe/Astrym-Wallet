/**
 * vault/types.ts — Type definitions for the encrypted vault subsystem.
 *
 * SECURITY INVARIANTS:
 *   - VaultContents (decrypted plaintext) must never be written to any storage.
 *     It lives only in service-worker module memory, cleared on every SW suspension.
 *   - EncryptedVaultBlob is the only form that may be persisted to chrome.storage.local.
 *   - Passwords are never stored in any form.
 */

/** Current vault schema version. Bump when the blob format changes. */
export type VaultVersion = 1;

/**
 * Serialised form of an encrypted vault, safe to persist in chrome.storage.local.
 *
 * All binary fields are base64url-encoded (no padding).
 *
 * Layout:
 *   v    — format version (currently 1)
 *   salt — PBKDF2 salt, 16 bytes (128 bits), fresh random per vault creation
 *   iv   — AES-GCM nonce, 12 bytes (96 bits), fresh random per encrypt call
 *   ct   — AES-256-GCM ciphertext, includes the 16-byte authentication tag appended
 *           by SubtleCrypto (i.e. ct.length = plaintext.length + 16)
 */
export interface EncryptedVaultBlob {
  readonly v: VaultVersion;
  readonly salt: string; // base64url, 16 bytes
  readonly iv: string;   // base64url, 12 bytes
  readonly ct: string;   // base64url, plaintext + 16-byte GCM auth tag
}

/**
 * Decrypted vault contents held in service-worker memory only.
 *
 * NEVER write VaultContents to any storage — chrome.storage.local,
 * chrome.storage.session, IndexedDB, or anywhere else.
 */
export interface VaultContents {
  /** BIP-39 mnemonic words joined by spaces. NEVER log or serialise. */
  readonly mnemonic: string;
  /** Optional display name for the first account. */
  readonly accountName?: string;
}

/**
 * Thrown when vault decryption fails.
 * The message is intentionally generic — do not embed password or key material.
 */
export class VaultDecryptionError extends Error {
  constructor(detail?: string) {
    super(
      detail
        ? `Vault decryption failed: ${detail}`
        : 'Vault decryption failed: wrong password or tampered data',
    );
    this.name = 'VaultDecryptionError';
  }
}

/**
 * Thrown when a vault operation is attempted while the wallet is locked
 * and no session key is available to restore from.
 */
export class WalletLockedError extends Error {
  constructor() {
    super('Wallet is locked — unlock required');
    this.name = 'WalletLockedError';
  }
}

/**
 * Thrown when unlock/access is attempted but no vault has been created yet.
 */
export class VaultNotFoundError extends Error {
  constructor() {
    super('No vault found — create a wallet first');
    this.name = 'VaultNotFoundError';
  }
}

/**
 * Thrown when createVault is called but a vault already exists in storage.
 * Prevents accidental vault destruction without explicit user action.
 */
export class VaultAlreadyExistsError extends Error {
  constructor() {
    super('A vault already exists — wipe storage before creating a new wallet');
    this.name = 'VaultAlreadyExistsError';
  }
}
