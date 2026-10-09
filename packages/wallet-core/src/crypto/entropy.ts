/**
 * entropy.ts — ONLY source of cryptographically-secure random bytes in wallet-core.
 *
 * SECURITY INVARIANT 4: crypto.getRandomValues is the ONLY source of entropy.
 * This is the ONLY module that calls it. Math.random is never used.
 *
 * All other modules that need randomness import from here — they do not call
 * crypto.getRandomValues directly.
 */

/**
 * Generate cryptographically-secure random bytes of the given length.
 *
 * @param byteLength - Number of random bytes to generate. Must be > 0.
 * @returns A fresh Uint8Array filled with CSPRNG output.
 * @throws {RangeError} If byteLength is not a positive integer.
 */
export function generateEntropy(byteLength: number): Uint8Array {
  if (!Number.isInteger(byteLength) || byteLength <= 0) {
    throw new RangeError(`byteLength must be a positive integer, got: ${byteLength}`);
  }
  const buf = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(buf);
  return buf;
}

/**
 * Generate a 12-byte AES-GCM IV (96 bits — the recommended GCM nonce size).
 * A fresh IV must be generated for every encryption operation.
 */
export function generateIV(): Uint8Array {
  return generateEntropy(12);
}

/**
 * Generate a 16-byte PBKDF2 salt (128 bits).
 * A fresh salt must be generated for every new vault creation or password change.
 */
export function generateSalt(): Uint8Array {
  return generateEntropy(16);
}
