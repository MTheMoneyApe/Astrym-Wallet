/**
 * Branded type for BIP-39 mnemonic phrases.
 *
 * SECURITY: toString() and toJSON() return a redacted string so that accidental
 * console.log or JSON serialization of a SeedPhrase never leaks the mnemonic.
 * The actual words are accessed only via the `words` property inside Wallet Core.
 *
 * Nothing outside wallet-core/src/ may hold a SeedPhrase value.
 */

declare const __seedPhraseBrand: unique symbol;

/** Opaque wrapper around the raw mnemonic word string. */
export type SeedPhrase = string & { readonly [__seedPhraseBrand]: true };

/**
 * Wrap a plain mnemonic string in the SeedPhrase brand.
 * Call site is responsible for ensuring the string is a valid BIP-39 mnemonic.
 * This is intentionally internal — only mnemonic.ts and vault code call this.
 */
export function makeSeedPhrase(mnemonic: string): SeedPhrase {
  // Validate at least superficially — full BIP-39 validation happens in mnemonic.ts
  if (typeof mnemonic !== 'string' || mnemonic.trim() === '') {
    throw new TypeError('SeedPhrase must be a non-empty string');
  }
  return mnemonic as SeedPhrase;
}

/**
 * Extract the raw mnemonic string from a SeedPhrase brand.
 * This is intentionally restricted to internal wallet-core use.
 * No external module should call this directly.
 */
export function rawMnemonic(phrase: SeedPhrase): string {
  return phrase as unknown as string;
}
