/**
 * Structural RPC fixture validators for SPP harness (Fase 2.5).
 *
 * Authority: stellar-private-payments@0.2.1 upstream commit
 * b79107cd24327198f8eb2dbaf4bdc65a8a1e8cf1 — sdk/native/src/chain/rpc.rs
 * (Phase 2.4 SLSA provenance). These checks mirror serde field names/types in
 * TypeScript; they are NOT Rust serde or WASM deserialization.
 */

export type StructuralCheck = { ok: true } | { ok: false; reason: string };

function fail(reason: string): StructuralCheck {
  return { ok: false, reason };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Rust u32 JSON number bounds (serde typically accepts unsigned 32-bit). */
function isU32(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 0xffff_ffff;
}

/** Rust i64 as JSON number — structural only (no BigInt path in SPP JSON). */
function isI64Number(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && Number.isSafeInteger(v);
}

function exactKeys(obj: Record<string, unknown>, required: string[], optional: string[] = []): StructuralCheck {
  const allowed = new Set([...required, ...optional]);
  for (const k of Object.keys(obj)) {
    if (!allowed.has(k)) return fail(`unexpected field: ${k}`);
  }
  for (const k of required) {
    if (!(k in obj)) return fail(`missing required field: ${k}`);
  }
  return { ok: true };
}

/**
 * GetLatestLedgerResponse — all three fields required (no Option/default).
 * Request params in source: `{}`.
 */
export function assertGetLatestLedgerResult(result: unknown): StructuralCheck {
  if (!isPlainObject(result)) return fail('result must be an object');
  const keys = exactKeys(result, ['id', 'sequence', 'protocolVersion']);
  if (!keys.ok) return keys;
  if (typeof result.id !== 'string' || result.id.length === 0) return fail('id must be non-empty string');
  if (!isU32(result.sequence)) return fail('sequence must be u32');
  if (!isU32(result.protocolVersion)) return fail('protocolVersion must be u32');
  return { ok: true };
}

/**
 * LedgerEntryResult — key, xdr, lastModifiedLedgerSeq required when an entry is present.
 */
export function assertLedgerEntryResult(entry: unknown): StructuralCheck {
  if (!isPlainObject(entry)) return fail('entry must be an object');
  const keys = exactKeys(entry, ['key', 'xdr', 'lastModifiedLedgerSeq']);
  if (!keys.ok) return keys;
  if (typeof entry.key !== 'string') return fail('key must be string');
  if (typeof entry.xdr !== 'string') return fail('xdr must be string');
  if (!isU32(entry.lastModifiedLedgerSeq)) return fail('lastModifiedLedgerSeq must be u32');
  return { ok: true };
}

/**
 * GetLedgerEntriesResponse — entries may be null/omitted (Option) or an array;
 * latestLedger is i64 in Rust.
 */
export function assertGetLedgerEntriesResult(result: unknown): StructuralCheck {
  if (!isPlainObject(result)) return fail('result must be an object');
  const keys = exactKeys(result, ['latestLedger'], ['entries']);
  if (!keys.ok) return keys;
  if (!isI64Number(result.latestLedger)) return fail('latestLedger must be integer');
  if ('entries' in result) {
    if (result.entries === null) return { ok: true };
    if (!Array.isArray(result.entries)) return fail('entries must be array or null');
    for (let i = 0; i < result.entries.length; i++) {
      const e = assertLedgerEntryResult(result.entries[i]);
      if (!e.ok) return fail(`entries[${i}]: ${e.reason}`);
    }
  }
  return { ok: true };
}

/** Required GetEventsResponse fields (cursor required by indexer after deserialize). */
export const GET_EVENTS_REQUIRED_FIELDS = [
  'events',
  'latestLedger',
  'latestLedgerCloseTime',
  'oldestLedger',
  'oldestLedgerCloseTime',
  'cursor',
] as const;

/**
 * Structural check for a hypothetical getEvents success body.
 * Harness must NOT serve success fixtures until explicitly authorized;
 * this validator exists to reject incomplete invented shapes in tests.
 */
export function assertGetEventsResult(result: unknown): StructuralCheck {
  if (!isPlainObject(result)) return fail('result must be an object');
  for (const k of GET_EVENTS_REQUIRED_FIELDS) {
    if (!(k in result)) return fail(`missing required field: ${k}`);
  }
  if (!Array.isArray(result.events) && result.events !== null) {
    return fail('events must be array or null');
  }
  if (!isU32(result.latestLedger)) return fail('latestLedger must be u32');
  if (typeof result.latestLedgerCloseTime !== 'string') return fail('latestLedgerCloseTime must be string');
  if (!isU32(result.oldestLedger)) return fail('oldestLedger must be u32');
  if (typeof result.oldestLedgerCloseTime !== 'string') return fail('oldestLedgerCloseTime must be string');
  if (typeof result.cursor !== 'string') return fail('cursor must be string');
  return { ok: true };
}

/** GetTransactionResponse — only status + optional resultXdr (2-field SPP shape). */
export function assertGetTransactionResult(result: unknown): StructuralCheck {
  if (!isPlainObject(result)) return fail('result must be an object');
  const keys = exactKeys(result, ['status'], ['resultXdr']);
  if (!keys.ok) return keys;
  if (typeof result.status !== 'string') return fail('status must be string');
  if ('resultXdr' in result && result.resultXdr !== undefined && result.resultXdr !== null) {
    if (typeof result.resultXdr !== 'string') return fail('resultXdr must be string when present');
  }
  return { ok: true };
}

/** SimulateTransactionResponse — latestLedger required; other fields optional/defaulted. */
export function assertSimulateTransactionResult(result: unknown): StructuralCheck {
  if (!isPlainObject(result)) return fail('result must be an object');
  if (!('latestLedger' in result) || !isI64Number(result.latestLedger)) {
    return fail('latestLedger must be integer');
  }
  if ('results' in result && result.results !== null && !Array.isArray(result.results)) {
    return fail('results must be array or null');
  }
  if ('error' in result && result.error !== undefined && result.error !== null && typeof result.error !== 'string') {
    return fail('error must be string when present');
  }
  return { ok: true };
}

/**
 * SendTransactionResponse shape (for negative tests only).
 * Harness must never return this as a successful mock result.
 */
export function assertSendTransactionResult(result: unknown): StructuralCheck {
  if (!isPlainObject(result)) return fail('result must be an object');
  const keys = exactKeys(result, ['hash', 'status', 'latestLedger'], ['errorResultXdr']);
  if (!keys.ok) return keys;
  if (typeof result.hash !== 'string') return fail('hash must be string');
  if (typeof result.status !== 'string') return fail('status must be string');
  if (!isU32(result.latestLedger)) return fail('latestLedger must be u32');
  return { ok: true };
}

export const BLOCKED_SUCCESS_METHODS = [
  'getEvents',
  'getTransaction',
  'simulateTransaction',
  'sendTransaction',
] as const;
