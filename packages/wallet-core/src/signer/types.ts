/**
 * signer/types.ts — Type definitions for the signing layer.
 *
 * SECURITY:
 *   - PrivateKeyBytes is NOT exported — private scalars are never exposed
 *     outside the signer module's call stack.
 *   - SignedMessage is a branded type so callers cannot accidentally
 *     treat an unsigned byte array as a verified signature.
 */

/** 32-byte Ed25519 public key. */
export type PublicKeyBytes = Uint8Array;

/**
 * 64-byte Ed25519 signature, branded to prevent confusion with unsigned data.
 *
 * Obtain via SoftwareSigner.signTransaction() or SoftwareSigner.signMessage().
 */
declare const _signatureBrand: unique symbol;
export type Signature = Uint8Array & { readonly [_signatureBrand]: true };

/**
 * Wrap a raw 64-byte Uint8Array as a typed Signature.
 * Only the signer module should call this.
 */
export function makeSignature(raw: Uint8Array): Signature {
  if (raw.length !== 64) {
    throw new TypeError(`Signature must be 64 bytes, got ${raw.length}`);
  }
  return raw as Signature;
}
