/**
 * Deterministic length-prefixed encoding for semantic plan fields.
 * Not JSON.stringify. Not a signature. Requires an injected DigestFn.
 */

import type { ApprovedIntent, DigestFn, DigestHex, ExactAmount, FeeLine } from './types.js';
import { assertExactUnits } from './amount.js';

const te = new TextEncoder();

function u32be(n: number): Uint8Array {
  if (!Number.isInteger(n) || n < 0 || n > 0xffff_ffff) {
    throw new Error('u32 out of range');
  }
  const out = new Uint8Array(4);
  out[0] = (n >>> 24) & 0xff;
  out[1] = (n >>> 16) & 0xff;
  out[2] = (n >>> 8) & 0xff;
  out[3] = n & 0xff;
  return out;
}

function encStr(s: string): Uint8Array {
  const b = te.encode(s);
  const out = new Uint8Array(4 + b.length);
  out.set(u32be(b.length), 0);
  out.set(b, 4);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function encAmount(a: ExactAmount): Uint8Array {
  return concat([encStr(a.units), u32be(a.decimals)]);
}

function encFees(fees: FeeLine[]): Uint8Array {
  const parts: Uint8Array[] = [u32be(fees.length)];
  for (const f of fees) {
    parts.push(encStr(f.certainty));
    parts.push(encStr(f.units ?? ''));
    parts.push(encStr(f.note));
  }
  return concat(parts);
}

function encDest(intent: ApprovedIntent): Uint8Array {
  const d = intent.destination;
  if (d.mode === 'none') return encStr('none');
  if (d.mode === 'self') return encStr('self');
  if (d.mode === 'g_address') return concat([encStr('g_address'), encStr(d.gAddress)]);
  return concat([
    encStr('privacy_keys'),
    encStr(d.notePublicKeyHex),
    encStr(d.encryptionPublicKeyHex ?? ''),
  ]);
}

function encAsset(intent: ApprovedIntent): Uint8Array {
  const a = intent.asset;
  return concat([
    encStr(a.kind),
    encStr(a.symbol ?? ''),
    encStr(a.contractId ?? ''),
    encStr(a.code ?? ''),
    encStr(a.issuer ?? ''),
  ]);
}

/**
 * Fields that define the semantic plan fingerprint (excludes intentId, timestamps,
 * digests themselves, publicEffects/privacyLimits copy, unknownCritical).
 */
export function encodePlanPayload(intent: ApprovedIntent): Uint8Array {
  if (!assertExactUnits(intent.amount.units).ok) {
    throw new Error('cannot encode plan: invalid amount.units');
  }
  return concat([
    encStr(`schema:${intent.schemaVersion}`),
    encStr(intent.op),
    encStr(intent.account),
    encStr(intent.networkPassphrase),
    encStr(intent.poolContractId),
    encAsset(intent),
    encAmount(intent.amount),
    encDest(intent),
    encFees(intent.fees),
  ]);
}

export function computePlanDigest(intent: ApprovedIntent, digestFn: DigestFn): DigestHex {
  return digestFn(encodePlanPayload(intent));
}

/** Digest arbitrary operation/XDR bytes with the same DigestFn. */
export function computeOperationDigest(operationBytes: Uint8Array, digestFn: DigestFn): DigestHex {
  return digestFn(operationBytes);
}

export function isDigestHex(v: unknown): v is DigestHex {
  return typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
}
