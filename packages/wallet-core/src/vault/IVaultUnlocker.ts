import type { EncryptedVaultBlob } from './types.js';

export interface IVaultUnlocker {
  /**
   * Encrypt plaintext bytes with a password-derived key.
   * Generates fresh random salt and IV on each call.
   */
  encrypt(password: string, plaintext: Uint8Array): Promise<EncryptedVaultBlob>;

  /**
   * Decrypt a vault blob, re-deriving the key from the password.
   * Throws VaultDecryptionError on wrong password or tampered data.
   */
  decrypt(password: string, blob: EncryptedVaultBlob): Promise<Uint8Array>;

  /**
   * Derive the AES-256-GCM wrapping key from a password and the blob's stored salt,
   * without performing decryption.
   *
   * The returned key has `['decrypt']` usage and `extractable: false`.
   * It is suitable for storing in chrome.storage.session and later passing to
   * decryptWithKey() — skipping PBKDF2 on subsequent SW wakeups.
   *
   * @param password - User password (UTF-8). Never stored.
   * @param blob - Encrypted blob whose `salt` field supplies the PBKDF2 salt.
   */
  deriveKey(password: string, blob: EncryptedVaultBlob): Promise<CryptoKey>;

  /**
   * Decrypt a vault blob using a pre-derived CryptoKey (e.g. from session storage).
   * Avoids running PBKDF2 again.
   *
   * @param key - AES-256-GCM CryptoKey with 'decrypt' usage, from session storage.
   * @param blob - The encrypted vault blob from persistent storage.
   * @throws VaultDecryptionError if the key is wrong or the blob is tampered.
   */
  decryptWithKey(key: CryptoKey, blob: EncryptedVaultBlob): Promise<Uint8Array>;
}
