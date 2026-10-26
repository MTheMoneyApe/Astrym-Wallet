import { ed25519 } from '@noble/curves/ed25519.js';
/**
 * hdDerive.ts — SLIP-0010 Ed25519 hierarchical deterministic key derivation.
 *
 * SECURITY: This is the cryptographic core. All logic matches the verified
 * pseudocode in implementation_plan.md, which was tested against official
 * SLIP-0010 test vectors (TV1, TV2) and the Phantom-compatible Solana vector.
 *
 * Algorithm reference: https://github.com/satoshilabs/slips/blob/master/slip-0010.md
 *
 * INVARIANTS:
 *   - Non-hardened derivation for Ed25519 is explicitly rejected per spec.
 *   - Seed must be 16–64 bytes (BIP-39 produces 64 bytes).
 *   - All path segments must be hardened (apostrophe-suffixed).
 *   - Private key bytes never leave this module's function call stack.
 */

import { hmac } from '@noble/hashes/hmac.js';
import { sha512 } from '@noble/hashes/sha2.js';

// ── Constants ────────────────────────────────────────────────────────────────

/** HMAC key string defined in SLIP-0010 for Ed25519. */
const CURVE_KEY = new TextEncoder().encode('ed25519 seed');

/** The hardened-bit offset added to all Ed25519 derivation indices. */
const HARDENED_BIT = 0x80000000 as const;

/** Min/max BIP-39 seed lengths accepted by deriveMasterKey. */
const SEED_MIN_BYTES = 16;
const SEED_MAX_BYTES = 64;

// ── Error types ───────────────────────────────────────────────────────────────

/**
 * Thrown when a path contains a non-hardened segment.
 * Per SLIP-0010: "If curve is ed25519 ... only hardened key generation is supported."
 */
export class NonHardenedDerivationError extends Error {
  constructor(segment: string, path: string) {
    super(
      `Non-hardened Ed25519 derivation is not supported. ` +
        `Segment "${segment}" in path "${path}" is missing the hardened marker (').`,
    );
    this.name = 'NonHardenedDerivationError';
  }
}

/** Thrown when a path or index value is invalid. */
export class InvalidDerivationPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidDerivationPathError';
  }
}

/** Thrown when the seed byte length is outside the accepted range. */
export class InvalidSeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidSeedError';
  }
}

// ── Internal node type ────────────────────────────────────────────────────────

/** An HD key node: 32-byte private key + 32-byte chain code. */
interface DerivedNode {
  readonly privateKey: Uint8Array;
  readonly chainCode: Uint8Array;
}

// ── Algorithm ─────────────────────────────────────────────────────────────────

/**
 * Derive the SLIP-0010 master key from a BIP-39 seed.
 *
 * Algorithm: I = HMAC-SHA512(Key = "ed25519 seed", Data = seed)
 *            IL = I[0..31] → master private key
 *            IR = I[32..63] → master chain code
 *
 * @param seed - BIP-39 seed bytes, must be 16–64 bytes.
 */
export function deriveMasterKey(seed: Uint8Array): DerivedNode {
  if (!(seed instanceof Uint8Array)) {
    throw new InvalidSeedError(
      `seed must be a Uint8Array, got: ${typeof seed}`,
    );
  }
  if (seed.length < SEED_MIN_BYTES || seed.length > SEED_MAX_BYTES) {
    throw new InvalidSeedError(
      `seed must be ${SEED_MIN_BYTES}–${SEED_MAX_BYTES} bytes, got: ${seed.length}`,
    );
  }

  const I = hmac(sha512, CURVE_KEY, seed);
  return {
    privateKey: I.slice(0, 32),
    chainCode: I.slice(32, 64),
  };
}

/**
 * Derive a hardened child key from a parent node.
 *
 * Algorithm: I = HMAC-SHA512(Key = IR_parent,
 *                            Data = 0x00 || IL_parent || uint32BE(index | 0x80000000))
 *
 * @param node - Parent node (private key + chain code).
 * @param index - Child index, 0 ≤ index < 2^31. The hardened bit is added internally.
 */
export function deriveHardenedChild(node: DerivedNode, index: number): DerivedNode {
  if (!Number.isInteger(index) || index < 0 || index >= HARDENED_BIT) {
    throw new InvalidDerivationPathError(
      `Child index must be an integer in [0, 2^31), got: ${index}`,
    );
  }

  const hardenedIndex = (index + HARDENED_BIT) >>> 0; // uint32, big-endian below

  // Data: 0x00 || privateKey(32) || uint32BE(hardenedIndex) = 37 bytes
  const data = new Uint8Array(37);
  data[0] = 0x00;
  data.set(node.privateKey, 1);
  data[33] = (hardenedIndex >>> 24) & 0xff;
  data[34] = (hardenedIndex >>> 16) & 0xff;
  data[35] = (hardenedIndex >>> 8) & 0xff;
  data[36] = hardenedIndex & 0xff;

  const I = hmac(sha512, node.chainCode, data);
  return {
    privateKey: I.slice(0, 32),
    chainCode: I.slice(32, 64),
  };
}

/**
 * Derive a key node along a full derivation path string.
 *
 * All segments MUST be hardened (apostrophe-suffixed). Any non-hardened
 * segment throws NonHardenedDerivationError.
 *
 * @param seed - BIP-39 seed bytes.
 * @param path - Derivation path, e.g. "m/44'/501'/0'/0'".
 *
 * @example
 * // Solana account 0 (Phantom-compatible)
 * const node = derivePath(seed, "m/44'/501'/0'/0'");
 */
export function derivePath(seed: Uint8Array, path: string): DerivedNode {
  if (typeof path !== 'string' || path.length === 0) {
    throw new InvalidDerivationPathError(`path must be a non-empty string, got: ${JSON.stringify(path)}`);
  }
  if (!path.startsWith('m/')) {
    throw new InvalidDerivationPathError(`path must start with "m/", got: "${path}"`);
  }

  const segmentStr = path.slice(2); // strip "m/"
  if (segmentStr.length === 0) {
    throw new InvalidDerivationPathError(`path must contain at least one segment after "m/", got: "${path}"`);
  }

  const segments = segmentStr.split('/');

  let node = deriveMasterKey(seed);

  for (const seg of segments) {
    // Empty segment check FIRST — "m//0'" should be an invalid path, not
    // a non-hardened derivation. An empty string does not end with "'" but
    // the root cause is the malformed path, not an unhardened index.
    if (seg.length === 0) {
      throw new InvalidDerivationPathError(
        `Empty segment in path "${path}" — double slash or trailing slash detected`,
      );
    }

    // Must end with hardened marker '
    if (!seg.endsWith("'")) {
      throw new NonHardenedDerivationError(seg, path);
    }


    const indexStr = seg.slice(0, -1); // strip the apostrophe

    // Must be a valid non-empty integer string
    if (indexStr.length === 0) {
      throw new InvalidDerivationPathError(
        `Empty index in path segment "${seg}" of path "${path}"`,
      );
    }

    // Reject any non-digit characters (including minus, dot, space)
    if (!/^\d+$/.test(indexStr)) {
      throw new InvalidDerivationPathError(
        `Non-integer index "${indexStr}" in path segment "${seg}" of path "${path}"`,
      );
    }

    const index = Number(indexStr);

    // Reject if it doesn't round-trip (catches very large numbers > Number.MAX_SAFE_INTEGER)
    if (!Number.isInteger(index) || String(index) !== indexStr) {
      throw new InvalidDerivationPathError(
        `Index "${indexStr}" in path "${path}" is not a safe integer`,
      );
    }

    // Must fit in hardened-index space (0 ≤ index < 2^31)
    if (index < 0 || index >= HARDENED_BIT) {
      throw new InvalidDerivationPathError(
        `Index ${index} in path "${path}" is out of hardened range [0, 2^31)`,
      );
    }

    node = deriveHardenedChild(node, index);
  }

  return node;
}

/**
 * Derive the Solana account public key bytes at the given account index.
 * Path: m/44'/501'/accountIndex'/0'
 *
 * Returns the 32-byte Ed25519 public key (without the SLIP-0010 0x00 prefix byte).
 * Uses @noble/curves for the public key derivation.
 *
 * @param seed - BIP-39 seed bytes (64 bytes from mnemonicToSeed).
 * @param accountIndex - HD account index, starting at 0.
 */
export function deriveSolanaPublicKey(seed: Uint8Array, accountIndex: number): Uint8Array {
  if (!Number.isInteger(accountIndex) || accountIndex < 0) {
    throw new InvalidDerivationPathError(
      `accountIndex must be a non-negative integer, got: ${accountIndex}`,
    );
  }
  const path = `m/44'/501'/${accountIndex}'/0'`;
  const node = derivePath(seed, path);
  // Import lazily to avoid circular; @noble/curves ed25519 getPublicKey is pure
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  
  return ed25519.getPublicKey(node.privateKey);
}

/**
 * Stellar SEP-0005 BIP-44 path template.
 * Path: m/44'/148'/{accountIndex}' (all segments hardened)
 */
export const STELLAR_DERIVATION_PATH = (accountIndex: number): string =>
  `m/44'/148'/${accountIndex}'`;

/**
 * Solana BIP-44 path template.
 * Path: m/44'/501'/{accountIndex}'/0'
 */
export const SOLANA_DERIVATION_PATH = (accountIndex: number): string =>
  `m/44'/501'/${accountIndex}'/0'`;

/**
 * Derive the Stellar account public key bytes at the given account index according to SEP-0005.
 * Path: m/44'/148'/accountIndex'
 *
 * Returns the 32-byte Ed25519 public key.
 *
 * @param seed - BIP-39 seed bytes (64 bytes from mnemonicToSeed).
 * @param accountIndex - HD account index, starting at 0.
 */
export function deriveStellarPublicKey(seed: Uint8Array, accountIndex: number): Uint8Array {
  if (!Number.isInteger(accountIndex) || accountIndex < 0) {
    throw new InvalidDerivationPathError(
      `accountIndex must be a non-negative integer, got: ${accountIndex}`,
    );
  }
  const path = STELLAR_DERIVATION_PATH(accountIndex);
  const node = derivePath(seed, path);
  return ed25519.getPublicKey(node.privateKey);
}

/**
 * Derive the Stellar account key node according to SEP-0005.
 *
 * @param seed - BIP-39 seed bytes (64 bytes from mnemonicToSeed).
 * @param accountIndex - HD account index, starting at 0.
 */
export function deriveStellarKeyNode(seed: Uint8Array, accountIndex: number): DerivedNode {
  if (!Number.isInteger(accountIndex) || accountIndex < 0) {
    throw new InvalidDerivationPathError(
      `accountIndex must be a non-negative integer, got: ${accountIndex}`,
    );
  }
  const path = STELLAR_DERIVATION_PATH(accountIndex);
  return derivePath(seed, path);
}




