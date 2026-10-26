/**
 * Fase 2.16/2.17 — TrustedDigestFn boundary (harness only).
 *
 * Guarantees of probeDigestFnNotConstant:
 *   - Rejects trivially constant stubs across a fixed sample set.
 * Does NOT guarantee:
 *   - That the function is SHA-256, collision-resistant, or untampered.
 *   - Authenticity of digests across trust boundaries.
 *
 * TypeScript brands are not cryptographic guarantees. Real signing integration
 * must bind a known implementation (e.g. @noble/hashes sha256) at the host
 * trust boundary — this module still does not connect to the signer.
 */

import type { DigestFn, DigestHex } from './types.js';

/** Brand for digests produced under an explicitly declared algorithm binding. */
export type TrustedDigestHex = DigestHex & { readonly __trustedDigest: unique symbol };

/**
 * Digest binding admitted by the hardened offline model (2.17+).
 * Still NOT sufficient alone to authorize real signatures.
 */
export type TrustedDigestFn = {
  readonly algorithm: 'sha256';
  readonly purpose: 'spp-approved-intent-v1';
  digest(bytes: Uint8Array): TrustedDigestHex;
};

export type DigestFnProbeResult =
  | { ok: true; distinctOutputs: number }
  | { ok: false; reason: 'CONSTANT_OUTPUT' | 'NON_HEX' | 'TOO_FEW_SAMPLES' };

export type TrustedDigestCheck =
  | { ok: true; trusted: TrustedDigestFn }
  | {
      ok: false;
      reason:
        | 'BAD_SHAPE'
        | 'BAD_ALGORITHM'
        | 'BAD_PURPOSE'
        | 'CONSTANT_OUTPUT'
        | 'NON_HEX'
        | 'TOO_FEW_SAMPLES';
    };

/**
 * Lightweight entropy probe: rejects DigestFn that returns the same value for
 * several distinct inputs. NOT a proof of any specific secure algorithm.
 */
export function probeDigestFnNotConstant(
  digestFn: DigestFn,
  samples: Uint8Array[] = [
    new Uint8Array([0x00]),
    new Uint8Array([0x01]),
    new Uint8Array([0x00, 0x00]),
    new TextEncoder().encode('a'),
    new TextEncoder().encode('b'),
    new TextEncoder().encode('spp-probe-sample'),
  ],
): DigestFnProbeResult {
  if (samples.length < 2) return { ok: false, reason: 'TOO_FEW_SAMPLES' };
  const outs = new Set<string>();
  for (const s of samples) {
    const h = digestFn(s);
    if (typeof h !== 'string' || !/^[0-9a-f]{64}$/.test(h)) {
      return { ok: false, reason: 'NON_HEX' };
    }
    outs.add(h);
  }
  if (outs.size === 1) return { ok: false, reason: 'CONSTANT_OUTPUT' };
  return { ok: true, distinctOutputs: outs.size };
}

/**
 * Admit a TrustedDigestFn only if shape matches and the digest method is not
 * constant under probeDigestFnNotConstant.
 */
export function assertTrustedDigestFn(candidate: unknown): TrustedDigestCheck {
  if (
    candidate === null ||
    typeof candidate !== 'object' ||
    typeof (candidate as TrustedDigestFn).digest !== 'function'
  ) {
    return { ok: false, reason: 'BAD_SHAPE' };
  }
  const t = candidate as TrustedDigestFn;
  if (t.algorithm !== 'sha256') return { ok: false, reason: 'BAD_ALGORITHM' };
  if (t.purpose !== 'spp-approved-intent-v1') return { ok: false, reason: 'BAD_PURPOSE' };

  const probe = probeDigestFnNotConstant((bytes) => t.digest(bytes));
  if (!probe.ok) return { ok: false, reason: probe.reason };

  return { ok: true, trusted: t };
}

/**
 * Wrap a concrete sha256 hex implementation. Caller must supply a real hash
 * (tests use @noble/hashes). Branding does not authenticate the implementation.
 */
export function wrapSha256AsTrusted(
  sha256Hex: (bytes: Uint8Array) => DigestHex,
): TrustedDigestFn {
  return {
    algorithm: 'sha256',
    purpose: 'spp-approved-intent-v1',
    digest(bytes: Uint8Array): TrustedDigestHex {
      const h = sha256Hex(bytes);
      if (!/^[0-9a-f]{64}$/.test(h)) {
        throw new Error('TrustedDigestFn: sha256Hex must return 64 lowercase hex chars');
      }
      return h as TrustedDigestHex;
    },
  };
}

/** Adapt TrustedDigestFn to the DigestFn shape used by planDigest helpers. */
export function asDigestFn(trusted: TrustedDigestFn): DigestFn {
  return (bytes) => trusted.digest(bytes);
}
