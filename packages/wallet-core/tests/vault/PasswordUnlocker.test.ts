/**
 * PasswordUnlocker.test.ts — Comprehensive tests for the vault KDF + AES-GCM layer.
 *
 * Test categories:
 *   1. PBKDF2 iteration count verification
 *   2. Encrypt/decrypt round-trip
 *   3. Wrong password fails
 *   4. Tampered ciphertext / auth tag fails
 *   5. Salt uniqueness
 *   6. IV/nonce uniqueness
 *   7. Empty and non-empty plaintext
 *   8. Malformed vault blob rejection
 *   9. Deterministic derivation (same password + salt → same key)
 */

import { describe, expect, it } from 'vitest';
import { PBKDF2_ITERATIONS, PasswordUnlocker } from '../../src/vault/PasswordUnlocker.js';
import { VaultDecryptionError, type EncryptedVaultBlob } from '../../src/vault/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Instantiate a fresh unlocker for each test to avoid shared state. */
function unlocker(): PasswordUnlocker {
  return new PasswordUnlocker();
}

/** Decode a base64url string to Uint8Array (mirrors the private helper). */
function fromBase64Url(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** Encode a Uint8Array to base64url without padding. */
function toBase64Url(buf: Uint8Array): string {
  let str = '';
  for (const b of buf) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// ─── 1. PBKDF2 iteration count ────────────────────────────────────────────────

describe('PasswordUnlocker — PBKDF2 iteration count', () => {
  it('PBKDF2_ITERATIONS constant equals exactly 600,000', () => {
    // Direct constant assertion. Any change to the KDF parameters will fail here.
    expect(PBKDF2_ITERATIONS).toBe(600_000);
  });

  it('uses exactly 600,000 iterations (verified by independent SubtleCrypto derivation)', async () => {
    /**
     * This test independently derives an AES-256-GCM key using 600,000 PBKDF2-SHA256
     * iterations, then verifies it can decrypt a blob produced by PasswordUnlocker.
     * If our implementation used any other iteration count, the independently derived
     * key would produce a different AES key and AES-GCM authentication would fail.
     *
     * The fixed IV is extracted from the blob so the reference key can re-encrypt
     * the known plaintext and compare ciphertext directly.
     */
    const password = 'iteration-count-verification-password';
    const plaintext = enc.encode('iteration-count-payload-data');

    // Step 1: encrypt with our PasswordUnlocker implementation
    const u = unlocker();
    const blob = await u.encrypt(password, plaintext);

    // Step 2: independently extract the salt from the blob
    const salt = fromBase64Url(blob.salt);
    const iv = fromBase64Url(blob.iv);

    // Step 3: independently derive a key using SubtleCrypto with exactly 600,000 iterations
    const baseKey = await globalThis.crypto.subtle.importKey(
      'raw',
      enc.encode(password),
      'PBKDF2',
      false,
      ['deriveKey'],
    );
    const referenceKey = await globalThis.crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 600_000, hash: 'SHA-256' },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt'],
    );

    // Step 4: decrypt the blob ciphertext using the independently derived key
    const ct = fromBase64Url(blob.ct);
    const decrypted = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      referenceKey,
      ct,
    );

    // If the iteration count matched, decryption succeeds and plaintext matches
    expect(dec.decode(new Uint8Array(decrypted))).toBe('iteration-count-payload-data');
  });

  it('a key derived with 599,999 iterations cannot decrypt our blob', async () => {
    const password = 'wrong-iteration-test';
    const plaintext = enc.encode('payload');

    const blob = await unlocker().encrypt(password, plaintext);

    const salt = fromBase64Url(blob.salt);
    const iv = fromBase64Url(blob.iv);
    const ct = fromBase64Url(blob.ct);

    const baseKey = await globalThis.crypto.subtle.importKey(
      'raw',
      enc.encode(password),
      'PBKDF2',
      false,
      ['deriveKey'],
    );
    const wrongKey = await globalThis.crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 599_999, hash: 'SHA-256' }, // wrong count
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt'],
    );

    // AES-GCM authentication tag verification must fail with the wrong key
    await expect(
      globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, wrongKey, ct),
    ).rejects.toThrow();
  });
});

// ─── 2. Encrypt/decrypt round-trip ────────────────────────────────────────────

describe('PasswordUnlocker — encrypt/decrypt round-trip', () => {
  it('decrypts to the exact original plaintext', async () => {
    const u = unlocker();
    const password = 'correct-password-123';
    const original = enc.encode('Hello, Solana wallet!');

    const blob = await u.encrypt(password, original);
    const recovered = await u.decrypt(password, blob);

    expect(recovered).toEqual(original);
  });

  it('round-trip preserves arbitrary binary data', async () => {
    const u = unlocker();
    const binary = new Uint8Array(256);
    for (let i = 0; i < 256; i++) binary[i] = i; // 0x00..0xFF

    const blob = await u.encrypt('binary-test', binary);
    const recovered = await u.decrypt('binary-test', blob);

    expect(recovered).toEqual(binary);
  });

  it('blob has the expected v:1 schema', async () => {
    const blob = await unlocker().encrypt('pw', enc.encode('data'));
    expect(blob.v).toBe(1);
    expect(typeof blob.salt).toBe('string');
    expect(typeof blob.iv).toBe('string');
    expect(typeof blob.ct).toBe('string');
  });

  it('ciphertext is longer than plaintext (auth tag adds 16 bytes)', async () => {
    const plaintext = enc.encode('test plaintext');
    const blob = await unlocker().encrypt('pw', plaintext);
    const ctBytes = fromBase64Url(blob.ct);
    // AES-GCM: ciphertext = plaintext || 16-byte auth tag
    expect(ctBytes.byteLength).toBe(plaintext.byteLength + 16);
  });

  it('same password and plaintext produce different blobs (due to random salt+IV)', async () => {
    const u = unlocker();
    const blob1 = await u.encrypt('pw', enc.encode('same'));
    const blob2 = await u.encrypt('pw', enc.encode('same'));
    // Different salt AND different IV → different ciphertext
    expect(blob1.salt).not.toBe(blob2.salt);
    expect(blob1.iv).not.toBe(blob2.iv);
    expect(blob1.ct).not.toBe(blob2.ct);
  });
});

// ─── 3. Wrong password fails ──────────────────────────────────────────────────

describe('PasswordUnlocker — wrong password', () => {
  it('throws VaultDecryptionError on wrong password', async () => {
    const u = unlocker();
    const blob = await u.encrypt('correct-password', enc.encode('secret'));
    await expect(u.decrypt('wrong-password', blob)).rejects.toThrow(VaultDecryptionError);
  });

  it('throws VaultDecryptionError on empty password when correct is non-empty', async () => {
    const u = unlocker();
    const blob = await u.encrypt('not-empty', enc.encode('data'));
    await expect(u.decrypt('', blob)).rejects.toThrow(VaultDecryptionError);
  });

  it('throws VaultDecryptionError on correct-prefix password', async () => {
    const u = unlocker();
    const blob = await u.encrypt('password123', enc.encode('data'));
    await expect(u.decrypt('password', blob)).rejects.toThrow(VaultDecryptionError);
  });

  it('error message is generic — does not echo back the supplied password', async () => {
    const suppliedPassword = 'supersecret-password-xyz-9999';
    const u = unlocker();
    const blob = await u.encrypt('correct-pw', enc.encode('data'));
    const err = await u.decrypt(suppliedPassword, blob).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(VaultDecryptionError);
    // The message must NOT echo back the exact password the user supplied
    expect((err as Error).message).not.toContain(suppliedPassword);
    // The message must NOT contain any fragment of the password either
    expect((err as Error).message).not.toContain('supersecret');
  });
});

// ─── 4. Tampered ciphertext / auth tag fails ──────────────────────────────────

describe('PasswordUnlocker — tampered data rejection', () => {
  it('throws VaultDecryptionError when ciphertext byte is flipped', async () => {
    const u = unlocker();
    const blob = await u.encrypt('pw', enc.encode('payload'));
    const ct = fromBase64Url(blob.ct);
    // Flip the first byte of the ciphertext (not the auth tag region)
    const b = ct[0];
    if (b === undefined) throw new Error('Empty');
    ct[0] = b ^ 0xff;
    const tampered: EncryptedVaultBlob = { ...blob, ct: toBase64Url(ct) };
    await expect(u.decrypt('pw', tampered)).rejects.toThrow(VaultDecryptionError);
  });

  it('throws VaultDecryptionError when a byte in the auth tag is flipped', async () => {
    const u = unlocker();
    const blob = await u.encrypt('pw', enc.encode('payload'));
    const ct = fromBase64Url(blob.ct);
    // Flip the last byte (last byte of the 16-byte GCM auth tag)
    const b = ct[ct.length - 1];
    if (b === undefined) throw new Error('Empty');
    ct[ct.length - 1] = b ^ 0x01;
    const tampered: EncryptedVaultBlob = { ...blob, ct: toBase64Url(ct) };
    await expect(u.decrypt('pw', tampered)).rejects.toThrow(VaultDecryptionError);
  });

  it('throws VaultDecryptionError when IV is changed', async () => {
    const u = unlocker();
    const blob = await u.encrypt('pw', enc.encode('payload'));
    const iv = fromBase64Url(blob.iv);
    const b = iv[0];
    if (b === undefined) throw new Error('Empty');
    iv[0] = b ^ 0xff;
    const tampered: EncryptedVaultBlob = { ...blob, iv: toBase64Url(iv) };
    await expect(u.decrypt('pw', tampered)).rejects.toThrow(VaultDecryptionError);
  });

  it('throws VaultDecryptionError when salt is changed (derives different key)', async () => {
    const u = unlocker();
    const blob = await u.encrypt('pw', enc.encode('payload'));
    const salt = fromBase64Url(blob.salt);
    const b = salt[0];
    if (b === undefined) throw new Error('Empty');
    salt[0] = b ^ 0xff;
    const tampered: EncryptedVaultBlob = { ...blob, salt: toBase64Url(salt) };
    await expect(u.decrypt('pw', tampered)).rejects.toThrow(VaultDecryptionError);
  });

  it('throws VaultDecryptionError when ciphertext is truncated (auth tag removed)', async () => {
    const u = unlocker();
    const blob = await u.encrypt('pw', enc.encode('payload'));
    const ct = fromBase64Url(blob.ct);
    // Remove the last 16 bytes (auth tag) — now auth tag is missing
    const truncated = ct.slice(0, ct.length - 16);
    // This is less than 16 bytes for a 7-byte plaintext → caught by size check
    // For longer plaintext, it would fail auth; test both paths:
    if (truncated.byteLength < 16) {
      const tampered: EncryptedVaultBlob = { ...blob, ct: toBase64Url(truncated) };
      await expect(u.decrypt('pw', tampered)).rejects.toThrow(VaultDecryptionError);
    } else {
      const tampered: EncryptedVaultBlob = { ...blob, ct: toBase64Url(truncated) };
      await expect(u.decrypt('pw', tampered)).rejects.toThrow(VaultDecryptionError);
    }
  });
});

// ─── 5. Salt uniqueness ────────────────────────────────────────────────────────

describe('PasswordUnlocker — salt uniqueness', () => {
  it('generates a unique 16-byte salt for each encrypt call', async () => {
    const u = unlocker();
    const salts = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const blob = await u.encrypt('pw', enc.encode('data'));
      const salt = fromBase64Url(blob.salt);
      expect(salt.byteLength).toBe(16);
      salts.add(blob.salt);
    }
    // All 10 salts must be distinct
    expect(salts.size).toBe(10);
  });
});

// ─── 6. IV/nonce uniqueness ────────────────────────────────────────────────────

describe('PasswordUnlocker — IV uniqueness', () => {
  it('generates a unique 12-byte IV for each encrypt call', async () => {
    const u = unlocker();
    const ivs = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const blob = await u.encrypt('pw', enc.encode('data'));
      const iv = fromBase64Url(blob.iv);
      expect(iv.byteLength).toBe(12);
      ivs.add(blob.iv);
    }
    expect(ivs.size).toBe(10);
  });
});

// ─── 7. Empty and non-empty plaintext ─────────────────────────────────────────

describe('PasswordUnlocker — plaintext sizes', () => {
  it('encrypts and decrypts empty plaintext (0 bytes)', async () => {
    const u = unlocker();
    const empty = new Uint8Array(0);
    const blob = await u.encrypt('pw', empty);
    // AES-GCM of 0-byte plaintext → 16-byte auth tag only
    expect(fromBase64Url(blob.ct).byteLength).toBe(16);
    const recovered = await u.decrypt('pw', blob);
    expect(recovered.byteLength).toBe(0);
  });

  it('encrypts and decrypts a 1-byte plaintext', async () => {
    const u = unlocker();
    const single = (new Uint8Array([0x42]) as unknown as any);
    const blob = await u.encrypt('pw', single);
    const recovered = await u.decrypt('pw', blob);
    expect(recovered).toEqual(single);
  });

  it('encrypts and decrypts a 64-byte plaintext', async () => {
    const u = unlocker();
    const data = new Uint8Array(64).fill(0xab);
    const blob = await u.encrypt('pw', data);
    const recovered = await u.decrypt('pw', blob);
    expect(recovered).toEqual(data);
  });

  it('encrypts and decrypts a 1000-byte plaintext', async () => {
    const u = unlocker();
    const data = new Uint8Array(1000);
    crypto.getRandomValues(data);
    const blob = await u.encrypt('pw', data);
    const recovered = await u.decrypt('pw', blob);
    expect(recovered).toEqual(data);
  });

  it('encrypts and decrypts a UTF-8 mnemonic-length string (24 words × ~8 chars)', async () => {
    const u = unlocker();
    const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art';
    const data = enc.encode(mnemonic);
    const blob = await u.encrypt('pw', data);
    const recovered = await u.decrypt('pw', blob);
    expect(dec.decode(recovered)).toBe(mnemonic);
  });
});

// ─── 8. Malformed vault blob rejection ────────────────────────────────────────

describe('PasswordUnlocker — malformed blob rejection', () => {
  it('throws VaultDecryptionError on wrong version number', async () => {
    const bad: EncryptedVaultBlob = { v: 99 as 1, salt: 'YQ', iv: 'YQ', ct: 'YQYQYQYQYQYQYQYQYQYQ' };
    await expect(unlocker().decrypt('pw', bad)).rejects.toThrow(VaultDecryptionError);
  });

  it('throws VaultDecryptionError when salt is an empty string', async () => {
    const u = unlocker();
    const good = await u.encrypt('pw', enc.encode('x'));
    const bad: EncryptedVaultBlob = { ...good, salt: '' };
    await expect(u.decrypt('pw', bad)).rejects.toThrow(VaultDecryptionError);
  });

  it('throws VaultDecryptionError when iv is an empty string', async () => {
    const u = unlocker();
    const good = await u.encrypt('pw', enc.encode('x'));
    const bad: EncryptedVaultBlob = { ...good, iv: '' };
    await expect(u.decrypt('pw', bad)).rejects.toThrow(VaultDecryptionError);
  });

  it('throws VaultDecryptionError when ct is an empty string', async () => {
    const u = unlocker();
    const good = await u.encrypt('pw', enc.encode('x'));
    const bad: EncryptedVaultBlob = { ...good, ct: '' };
    await expect(u.decrypt('pw', bad)).rejects.toThrow(VaultDecryptionError);
  });

  it('throws VaultDecryptionError when salt has wrong byte length (8 instead of 16)', async () => {
    const u = unlocker();
    const good = await u.encrypt('pw', enc.encode('x'));
    // 8-byte salt encoded as base64url
    const shortSalt = toBase64Url(new Uint8Array(8).fill(0xaa));
    const bad: EncryptedVaultBlob = { ...good, salt: shortSalt };
    await expect(u.decrypt('pw', bad)).rejects.toThrow(VaultDecryptionError);
  });

  it('throws VaultDecryptionError when iv has wrong byte length (8 instead of 12)', async () => {
    const u = unlocker();
    const good = await u.encrypt('pw', enc.encode('x'));
    const shortIv = toBase64Url(new Uint8Array(8).fill(0xbb));
    const bad: EncryptedVaultBlob = { ...good, iv: shortIv };
    await expect(u.decrypt('pw', bad)).rejects.toThrow(VaultDecryptionError);
  });

  it('throws VaultDecryptionError when ct is too short (< 16 bytes, no room for auth tag)', async () => {
    const u = unlocker();
    const good = await u.encrypt('pw', enc.encode('x'));
    // 8-byte ct — shorter than the 16-byte auth tag minimum
    const shortCt = toBase64Url(new Uint8Array(8).fill(0xcc));
    const bad: EncryptedVaultBlob = { ...good, ct: shortCt };
    await expect(u.decrypt('pw', bad)).rejects.toThrow(VaultDecryptionError);
  });

  it('throws VaultDecryptionError on invalid base64url encoding in salt', async () => {
    const u = unlocker();
    const good = await u.encrypt('pw', enc.encode('x'));
    const bad: EncryptedVaultBlob = { ...good, salt: '!!!not-base64!!!' };
    await expect(u.decrypt('pw', bad)).rejects.toThrow(VaultDecryptionError);
  });
});

// ─── 9. Deterministic key derivation ─────────────────────────────────────────

describe('PasswordUnlocker — deterministic key derivation', () => {
  it('same password + same salt always produces the same AES key (PBKDF2 is deterministic)', async () => {
    /**
     * We verify this indirectly: encrypt with a fixed salt+IV by manually
     * constructing the scenario — use SubtleCrypto to encrypt a plaintext
     * with a key derived at 600k iterations, then decrypt twice from two
     * independent derivations. Both must succeed with the same output.
     */
    const password = 'determinism-test-password';
    const fixedSalt = new Uint8Array(16).fill(0x5a);
    const fixedIv = new Uint8Array(12).fill(0x3c);
    const plaintext = enc.encode('deterministic-payload');

    // Derive key #1 independently
    const base1 = await globalThis.crypto.subtle.importKey(
      'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey'],
    );
    const key1 = await globalThis.crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: fixedSalt, iterations: 600_000, hash: 'SHA-256' },
      base1,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt'],
    );
    const ct1 = await globalThis.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: fixedIv },
      key1,
      plaintext,
    );

    // Derive key #2 independently (same inputs)
    const base2 = await globalThis.crypto.subtle.importKey(
      'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey'],
    );
    const key2 = await globalThis.crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: fixedSalt, iterations: 600_000, hash: 'SHA-256' },
      base2,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt'],
    );

    // key2 must be able to decrypt what key1 encrypted
    const pt2 = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fixedIv },
      key2,
      ct1,
    );
    expect(dec.decode(new Uint8Array(pt2))).toBe('deterministic-payload');
  });

  it('PasswordUnlocker can decrypt its own blob with the same password (multiple encrypt calls)', async () => {
    const u = unlocker();
    const password = 'multi-encrypt-test';
    const plaintext = enc.encode('some wallet data');

    const blob1 = await u.encrypt(password, plaintext);
    const blob2 = await u.encrypt(password, plaintext);

    // Both blobs decrypt to the same plaintext, even though salt/IV differ
    const r1 = await u.decrypt(password, blob1);
    const r2 = await u.decrypt(password, blob2);

    expect(dec.decode(r1)).toBe('some wallet data');
    expect(dec.decode(r2)).toBe('some wallet data');
  });
});
