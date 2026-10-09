/**
 * vault/PasswordUnlocker.ts — Password-based vault encryption/decryption.
 *
 * Cryptographic design:
 *   KDF:       PBKDF2-HMAC-SHA256, 600,000 iterations, 128-bit new Uint8Array(salt), 256-bit output.
 *   Cipher:    AES-256-GCM, 96-bit IV (12 bytes), 128-bit authentication tag.
 *   Backend:   SubtleCrypto (Web Crypto API) — no hand-rolled primitives.
 *   Entropy:   entropy.ts (generateSalt / generateIV) — centralised CSPRNG.
 *
 * SECURITY INVARIANTS:
 *   - Passwords are immediately encoded to bytes and never stored as strings.
 *   - CryptoKeys are non-extractable (`extractable: false`).
 *   - Plaintext is never logged.
 *   - Salt and IV are always fresh random values per encrypt call.
 *   - Decryption failure (wrong password OR tampered data) throws VaultDecryptionError
 *     with a non-specific message — no oracle information is leaked.
 *
 * KDF note:
 *   The 600,000-iteration PBKDF2-SHA256 used here is the VAULT KDF.
 *   It is entirely separate from the BIP-39 seed derivation (2,048-iteration
 *   PBKDF2-SHA512 in mnemonic.ts). These two PBKDF2 usages must never be confused.
 *
 * Blob format (EncryptedVaultBlob):
 *   { v, new Uint8Array(salt), iv, ct }
 *   salt: 16 bytes base64url  — PBKDF2 salt
 *   iv:   12 bytes base64url  — AES-GCM nonce
 *   ct:   (N + 16) bytes base64url — ciphertext with GCM auth tag appended by SubtleCrypto
 */

import { generateIV, generateSalt } from '../crypto/entropy.js';
import type { IVaultUnlocker } from './IVaultUnlocker.js';
import { VaultDecryptionError, type EncryptedVaultBlob } from './types.js';

// ── KDF / cipher constants — MUST NOT be changed without user approval ────────

/** PBKDF2 iteration count for the vault KDF. Verified in unit tests. */
export const PBKDF2_ITERATIONS = 600_000;
/** PBKDF2 hash algorithm for the vault KDF. */
const PBKDF2_HASH = 'SHA-256' as const;
/** AES-GCM key length in bits. */
const AES_KEY_BITS = 256 as const;
/** AES algorithm name. */
const AES_ALG = 'AES-GCM' as const;

// ── Internal helpers ──────────────────────────────────────────────────────────

const _encoder = new TextEncoder();

/**
 * Encode a Uint8Array to base64url (no padding).
 * Uses a loop instead of spread to avoid call-stack overflow on large buffers.
 */
function toBase64Url(buf: Uint8Array): string {
  let str = '';
  const len = buf.length;
  for (let i = 0; i < len; i++) {
    str += String.fromCharCode(buf[i]!);
  }
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Decode a base64url string (with or without padding) to Uint8Array.
 */
function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

// ── Key derivation (internal) ─────────────────────────────────────────────────

/**
 * Derive an AES-256-GCM CryptoKey from a password and salt using PBKDF2-SHA256.
 *
 * The key is non-extractable. This function is package-internal — do not export
 * it as part of the public API; expose it only for VaultService key caching.
 *
 * @param password - User password (UTF-8 string). Never stored.
 * @param salt - 16-byte PBKDF2 salt.
 * @param usages - ['encrypt'] or ['decrypt'] — minimal privilege per call.
 */
async function pbkdf2DeriveKey(
  password: string,
  salt: Uint8Array,
  usages: ReadonlyArray<'encrypt' | 'decrypt'>,
): Promise<CryptoKey> {
  // Step 1: import the password as a raw PBKDF2 base key.
  const baseKey = await globalThis.crypto.subtle.importKey(
    'raw',
    new Uint8Array(_encoder.encode(password)),
    'PBKDF2',
    false, // non-extractable
    ['deriveKey'],
  );

  // Step 2: derive the AES-256-GCM key.
  return globalThis.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: new Uint8Array(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: PBKDF2_HASH,
    },
    baseKey,
    { name: AES_ALG, length: AES_KEY_BITS },
    false, // non-extractable
    usages as KeyUsage[],
  );
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Password-based vault unlocker using PBKDF2-SHA256 + AES-256-GCM.
 *
 * Instantiate once and inject into VaultService.
 * The instance is stateless — all state lives in the returned EncryptedVaultBlob.
 */
export class PasswordUnlocker implements IVaultUnlocker {
  /**
   * Encrypt plaintext bytes with a key derived from the password.
   *
   * A fresh 16-byte salt and 12-byte IV are generated via entropy.ts on every call.
   * Two calls with the same password and plaintext will produce different blobs.
   */
  async encrypt(password: string, plaintext: Uint8Array): Promise<EncryptedVaultBlob> {
    const salt = generateSalt(); // 16 bytes, 128-bit PBKDF2 salt
    const iv = generateIV(); // 12 bytes, 96-bit AES-GCM nonce

    const key = await pbkdf2DeriveKey(password, new Uint8Array(salt), ['encrypt']);

    // AES-GCM appends the 16-byte authentication tag to the ciphertext output.
    const ciphertextBuf = await globalThis.crypto.subtle.encrypt(
      { name: AES_ALG, iv: new Uint8Array(iv) },
      key,
      new Uint8Array(plaintext),
    );

    return {
      v: 1,
      salt: toBase64Url(salt),
      iv: toBase64Url(iv),
      ct: toBase64Url(new Uint8Array(ciphertextBuf)),
    };
  }

  /**
   * Decrypt a vault blob with a key derived from the password.
   *
   * AES-GCM authentication runs implicitly. A wrong password derives a different
   * key, which fails GCM tag verification. Tampered ciphertext also fails.
   * Both cases throw VaultDecryptionError — the caller cannot distinguish them
   * (intentional: no oracle information).
   *
   * @throws {VaultDecryptionError} On any decryption or authentication failure.
   */
  async decrypt(password: string, blob: EncryptedVaultBlob): Promise<Uint8Array> {
    const { salt, iv, ct } = this._validateAndDecode(blob);
    const key = await pbkdf2DeriveKey(password, new Uint8Array(salt), ['decrypt']);
    return this._aesGcmDecrypt(key, iv, ct);
  }

  /**
   * Derive the AES-256-GCM wrapping key from a password and blob's stored salt.
   *
   * The key is non-extractable with ['decrypt'] usage.
   * Store it in chrome.storage.session; pass to decryptWithKey() to
   * avoid re-running PBKDF2 on subsequent SW wakeups.
   *
   * This is the only method that runs PBKDF2 without also decrypting.
   * VaultService calls it after encrypt() to cache the key for transparent re-unlock.
   */
  async deriveKey(password: string, blob: EncryptedVaultBlob): Promise<CryptoKey> {
    const { salt } = this._validateAndDecode(blob);
    return pbkdf2DeriveKey(password, new Uint8Array(salt), ['decrypt']);
  }

  /**
   * Decrypt a vault blob using a pre-derived CryptoKey from session storage.
   * Skips PBKDF2 — only runs AES-GCM decryption.
   *
   * @throws {VaultDecryptionError} If the key is wrong or the blob is tampered.
   */
  async decryptWithKey(key: CryptoKey, blob: EncryptedVaultBlob): Promise<Uint8Array> {
    const { iv, ct } = this._validateAndDecode(blob);
    return this._aesGcmDecrypt(key, iv, ct);
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Validate and decode an EncryptedVaultBlob.
   * Shared by decrypt(), deriveKey(), and decryptWithKey().
   */
  private _validateAndDecode(blob: EncryptedVaultBlob): {
    salt: Uint8Array;
    iv: Uint8Array;
    ct: Uint8Array;
  } {
    if (blob.v !== 1) {
      throw new VaultDecryptionError(`unsupported vault version: ${blob.v}`);
    }
    if (
      typeof blob.salt !== 'string' ||
      typeof blob.iv !== 'string' ||
      typeof blob.ct !== 'string' ||
      blob.salt.length === 0 ||
      blob.iv.length === 0 ||
      blob.ct.length === 0
    ) {
      throw new VaultDecryptionError('malformed vault blob: missing required fields');
    }

    let salt: Uint8Array;
    let iv: Uint8Array;
    let ct: Uint8Array;

    try {
      salt = fromBase64Url(blob.salt);
      iv = fromBase64Url(blob.iv);
      ct = fromBase64Url(blob.ct);
    } catch {
      throw new VaultDecryptionError('malformed vault blob: invalid base64url encoding');
    }

    if (salt.byteLength !== 16) {
      throw new VaultDecryptionError(`malformed vault blob: expected 16-byte salt, got ${salt.byteLength}`);
    }
    if (iv.byteLength !== 12) {
      throw new VaultDecryptionError(`malformed vault blob: expected 12-byte IV, got ${iv.byteLength}`);
    }
    if (ct.byteLength < 16) {
      throw new VaultDecryptionError(`malformed vault blob: ciphertext too short (${ct.byteLength} bytes)`);
    }

    return { salt, iv, ct };
  }

  /** Run AES-256-GCM decryption. Throws VaultDecryptionError on failure. */
  private async _aesGcmDecrypt(
    key: CryptoKey,
    iv: Uint8Array,
    ct: Uint8Array,
  ): Promise<Uint8Array> {
    try {
      const plaintext = await globalThis.crypto.subtle.decrypt(
        { name: AES_ALG, iv: new Uint8Array(iv) },
        key,
        new Uint8Array(ct),
      );
      return new Uint8Array(plaintext);
    } catch {
      // SECURITY: Do not log the exception. Do not distinguish wrong-key from tampered-data.
      throw new VaultDecryptionError();
    }
  }
}
