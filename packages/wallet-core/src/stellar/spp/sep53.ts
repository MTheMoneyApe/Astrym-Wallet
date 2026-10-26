/**
 * SEP-0053 — Stellar Signed Message encoding + SHA-256 payload.
 * @see https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0053.md
 */

import { sha256 } from '@noble/hashes/sha2.js';

export const STELLAR_SIGNED_MESSAGE_PREFIX = 'Stellar Signed Message:\n';

/** Build the canonical SEP-53 byte payload: prefix || UTF-8(message). */
export function encodeSep53Message(message: string): Uint8Array {
  const prefix = new TextEncoder().encode(STELLAR_SIGNED_MESSAGE_PREFIX);
  const body = new TextEncoder().encode(message);
  const out = new Uint8Array(prefix.length + body.length);
  out.set(prefix, 0);
  out.set(body, prefix.length);
  return out;
}

/** 32-byte SHA-256 digest that wallets must Ed25519-sign for SEP-53. */
export function hashSep53Message(message: string): Uint8Array {
  return sha256(encodeSep53Message(message));
}
