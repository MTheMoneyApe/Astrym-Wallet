/**
 * mnemonic.ts — BIP-39 mnemonic generation, validation, and seed derivation.
 *
 * Uses @scure/bip39 v2.4.0 — audited, minimal implementation.
 *
 * SECURITY INVARIANTS:
 *   - 24 words = 256-bit entropy. MVP never generates fewer.
 *   - mnemonicToSeedSync is used (not async) for BIP-39 seed derivation.
 *     BIP-39 specifies exactly 2,048 PBKDF2-HMAC-SHA512 iterations for
 *     mnemonic → seed. This is fixed by spec and is NOT the vault KDF.
 *   - No passphrase is added to the BIP-39 seed. The empty-string passphrase
 *     is the standard for hardware-wallet-compatible derivation.
 *   - The result of mnemonicToSeedSync is a 64-byte Uint8Array — the BIP-39
 *     root seed. This is then consumed by hdDerive.ts (SLIP-0010).
 *   - NEVER log a SeedPhrase value. Never serialize it to JSON.
 *   - Validation is strict: only wordlist words are accepted.
 *
 * API note (@scure/bip39 v2.x vs v1.x):
 *   - generateMnemonic(wordlist, strength) — wordlist first, same as v1.
 *   - validateMnemonic(mnemonic, wordlist) — same as v1.
 *   - mnemonicToSeedSync(mnemonic, password?) — synchronous, returns Uint8Array.
 *   - mnemonicToSeed(mnemonic, password?) — async, returns Promise<Uint8Array>.
 *   - wordlist is imported from '@scure/bip39/wordlists/english.js' — required.
 */

import { generateMnemonic as _gen, mnemonicToSeedSync as _toSeed, validateMnemonic as _validate } from '@scure/bip39';
import { wordlist as ENGLISH_WORDLIST } from '@scure/bip39/wordlists/english.js';
import { makeSeedPhrase, rawMnemonic, type SeedPhrase } from './types.js';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Entropy strength for a 24-word mnemonic (256 bits). Never change this. */
const MNEMONIC_STRENGTH_BITS = 256;

// ── Exported API ──────────────────────────────────────────────────────────────

/**
 * Generate a new 24-word BIP-39 mnemonic phrase (256-bit entropy).
 *
 * Entropy comes from @scure/bip39's randomBytes, which delegates to
 * globalThis.crypto.getRandomValues — the same source as entropy.ts.
 *
 * 24 words = 256 bits entropy. This is the only strength supported by the MVP.
 *
 * @returns A branded SeedPhrase (the raw string is hidden from accidental logging).
 */
export function generate24WordMnemonic(): SeedPhrase {
  const mnemonic = _gen(ENGLISH_WORDLIST, MNEMONIC_STRENGTH_BITS);
  return makeSeedPhrase(mnemonic);
}

/**
 * Validate a mnemonic string against the BIP-39 English wordlist.
 *
 * This validates:
 *   - Correct word count (12, 15, 18, 21, or 24 words)
 *   - All words are in the English BIP-39 wordlist
 *   - The checksum is correct
 *
 * @param mnemonic - Raw mnemonic string (space-separated words).
 * @returns true if valid, false otherwise.
 */
export function validateMnemonic(mnemonic: string): boolean {
  try {
    return _validate(mnemonic.trim(), ENGLISH_WORDLIST);
  } catch {
    return false;
  }
}

/**
 * Validate that a SeedPhrase is a valid 24-word mnemonic.
 * Convenience wrapper that works on the branded type.
 */
export function validateSeedPhrase(phrase: SeedPhrase): boolean {
  return validateMnemonic(rawMnemonic(phrase));
}

/**
 * Derive a 64-byte BIP-39 root seed from a mnemonic phrase.
 *
 * Algorithm: PBKDF2-HMAC-SHA512(password=NFKD(mnemonic), salt=NFKD("mnemonic"),
 *            iterations=2048, keylen=64)
 *
 * The iteration count (2048) is fixed by the BIP-39 specification.
 * It is distinct from, and MUST NOT be confused with, the vault KDF's
 * 600,000-iteration PBKDF2-SHA256.
 *
 * No BIP-39 passphrase is used. The empty-string passphrase is the standard
 * for Phantom/Solflare/Backpack/Ledger compatibility.
 *
 * The returned seed is synchronously computed. Use this result as input to
 * hdDerive.derivePath().
 *
 * @param phrase - The validated BIP-39 SeedPhrase.
 * @returns 64-byte root seed as Uint8Array.
 *
 * @throws {Error} If the mnemonic is invalid.
 */
export function mnemonicToSeed(phrase: SeedPhrase): Uint8Array {
  const raw = rawMnemonic(phrase);
  if (!validateMnemonic(raw)) {
    throw new Error('Invalid mnemonic: cannot derive seed from an invalid phrase');
  }
  // BIP-39: no passphrase (empty string = standard hardware-wallet compatible path)
  return _toSeed(raw, /* password= */ '');
}

/**
 * Split a SeedPhrase into its individual words.
 * Useful for backup confirmation UI (word-order quiz).
 *
 * @returns Array of words in mnemonic order.
 */
export function mnemonicWords(phrase: SeedPhrase): string[] {
  return rawMnemonic(phrase).trim().split(' ');
}
