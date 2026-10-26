/**
 * Fase 2.30 — Strict envelope + args validation for RO-1 broker.
 * Fail-closed. Rejects extra keys, functions, exotic prototypes.
 */

import { authorizeReadOnlyCall, isHarnessLoopbackRpcUrl } from '../readOnlyPolicy/policy.js';
import type { ReadOnlyCallRequest } from '../readOnlyPolicy/types.js';
import {
  RO1_BROKER_VERSION,
  type Ro1BrokerErrorCode,
  type Ro1BrokerMethod,
  type Ro1JsonValue,
  type Ro1RequestMessage,
  type Ro1ResponseMessage,
} from './types.js';

const ALLOWED_METHODS: ReadonlySet<string> = new Set([
  'Storage.open',
  'Client.new',
  'Client.aspState',
  'Client.allContractsData',
]);

const REQ_KEYS = new Set(['v', 'kind', 'sessionId', 'requestId', 'method', 'args']);
const RES_KEYS_OK = new Set(['v', 'kind', 'sessionId', 'requestId', 'ok', 'result']);
const RES_KEYS_ERR = new Set(['v', 'kind', 'sessionId', 'requestId', 'ok', 'error']);
const ERROR_KEYS = new Set(['code', 'message']);

export type SchemaFail = { ok: false; code: Ro1BrokerErrorCode; message: string };
export type SchemaOk<T> = { ok: true; value: T };

function fail(code: Ro1BrokerErrorCode, message: string): SchemaFail {
  return { ok: false, code, message };
}

/** Reject non-plain objects (arrays, null, Date, class instances, etc.). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function assertExactKeys(
  obj: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): SchemaFail | null {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      return fail('EXTRA_FIELD', `unexpected field: ${key}`);
    }
  }
  for (const key of allowed) {
    if (!(key in obj)) {
      // result optional on ok responses handled by caller; for requests all required
      if (key === 'result' || key === 'error') continue;
      return fail('MALFORMED', `missing field: ${key}`);
    }
  }
  return null;
}

/**
 * Deep check: JSON-safe values only. No functions, undefined, symbol, bigint.
 * Objects must be plain; arrays OK.
 */
export function assertRo1JsonValue(
  value: unknown,
  path = 'value',
): SchemaFail | SchemaOk<Ro1JsonValue> {
  if (value === null) return { ok: true, value: null };
  const t = typeof value;
  if (t === 'string' || t === 'boolean') return { ok: true, value: value as Ro1JsonValue };
  if (t === 'number') {
    if (!Number.isFinite(value as number)) {
      return fail('FORBIDDEN_VALUE', `${path}: non-finite number`);
    }
    return { ok: true, value: value as number };
  }
  if (t === 'function' || t === 'symbol' || t === 'bigint' || t === 'undefined') {
    return fail('FORBIDDEN_VALUE', `${path}: type ${t} forbidden`);
  }
  if (Array.isArray(value)) {
    const out: Ro1JsonValue[] = [];
    for (let i = 0; i < value.length; i++) {
      const inner = assertRo1JsonValue(value[i], `${path}[${i}]`);
      if (!inner.ok) return inner;
      out.push(inner.value);
    }
    return { ok: true, value: out };
  }
  if (!isPlainObject(value)) {
    return fail('FORBIDDEN_VALUE', `${path}: non-plain object`);
  }
  // Reject unexpected own props that are accessors with side effects? plain data only.
  const out: Record<string, Ro1JsonValue> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof k !== 'string') return fail('FORBIDDEN_VALUE', `${path}: non-string key`);
    const desc = Object.getOwnPropertyDescriptor(value, k);
    if (desc && (desc.get || desc.set)) {
      return fail('FORBIDDEN_VALUE', `${path}.${k}: accessor forbidden`);
    }
    if (typeof v === 'function') {
      return fail('FORBIDDEN_VALUE', `${path}.${k}: function forbidden`);
    }
    const inner = assertRo1JsonValue(v, `${path}.${k}`);
    if (!inner.ok) return inner;
    out[k] = inner.value;
  }
  return { ok: true, value: out };
}

function isNonEmptyId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 && !value.includes('\0');
}

export function parseRo1Request(raw: unknown): SchemaFail | SchemaOk<Ro1RequestMessage> {
  if (!isPlainObject(raw)) return fail('MALFORMED', 'request must be a plain object');
  const keyErr = assertExactKeys(raw, REQ_KEYS);
  if (keyErr) return keyErr;

  if (raw.v !== RO1_BROKER_VERSION) return fail('MALFORMED', 'unsupported v');
  if (raw.kind !== 'req') return fail('MALFORMED', 'kind must be req');
  if (!isNonEmptyId(raw.sessionId)) return fail('MALFORMED', 'invalid sessionId');
  if (!isNonEmptyId(raw.requestId)) return fail('MALFORMED', 'invalid requestId');
  if (typeof raw.method !== 'string') return fail('MALFORMED', 'method must be string');
  if (!ALLOWED_METHODS.has(raw.method)) {
    return fail('UNKNOWN_METHOD', `method not allowlisted: ${raw.method}`);
  }

  const argsCheck = assertRo1JsonValue(raw.args, 'args');
  if (!argsCheck.ok) return argsCheck;

  const method = raw.method as Ro1BrokerMethod;
  const argsPolicy = validateMethodArgs(method, argsCheck.value);
  if (!argsPolicy.ok) return argsPolicy;

  return {
    ok: true,
    value: {
      v: RO1_BROKER_VERSION,
      kind: 'req',
      sessionId: raw.sessionId,
      requestId: raw.requestId,
      method,
      args: argsCheck.value,
    },
  };
}

export function parseRo1Response(raw: unknown): SchemaFail | SchemaOk<Ro1ResponseMessage> {
  if (!isPlainObject(raw)) return fail('MALFORMED', 'response must be a plain object');
  if (raw.v !== RO1_BROKER_VERSION) return fail('MALFORMED', 'unsupported v');
  if (raw.kind !== 'res') return fail('MALFORMED', 'kind must be res');
  if (!isNonEmptyId(raw.sessionId)) return fail('MALFORMED', 'invalid sessionId');
  if (!isNonEmptyId(raw.requestId)) return fail('MALFORMED', 'invalid requestId');
  if (typeof raw.ok !== 'boolean') return fail('MALFORMED', 'ok must be boolean');

  if (raw.ok === true) {
    const keyErr = assertExactKeys(raw, RES_KEYS_OK);
    if (keyErr) return keyErr;
    if (!('result' in raw)) return fail('MALFORMED', 'ok response requires result');
    const resultCheck = assertRo1JsonValue(raw.result, 'result');
    if (!resultCheck.ok) return resultCheck;
    return {
      ok: true,
      value: {
        v: RO1_BROKER_VERSION,
        kind: 'res',
        sessionId: raw.sessionId,
        requestId: raw.requestId,
        ok: true,
        result: resultCheck.value,
      },
    };
  }

  const keyErr = assertExactKeys(raw, RES_KEYS_ERR);
  if (keyErr) return keyErr;
  if (!isPlainObject(raw.error)) return fail('MALFORMED', 'error must be plain object');
  const ek = assertExactKeys(raw.error, ERROR_KEYS);
  if (ek) return ek;
  if (typeof raw.error.code !== 'string' || typeof raw.error.message !== 'string') {
    return fail('MALFORMED', 'error.code/message must be strings');
  }
  return {
    ok: true,
    value: {
      v: RO1_BROKER_VERSION,
      kind: 'res',
      sessionId: raw.sessionId,
      requestId: raw.requestId,
      ok: false,
      error: { code: raw.error.code, message: raw.error.message },
    },
  };
}

function validateMethodArgs(
  method: Ro1BrokerMethod,
  args: Ro1JsonValue,
): SchemaFail | SchemaOk<true> {
  // Normalize empty object for methods that take no args
  let request: ReadOnlyCallRequest;
  if (method === 'Storage.open') {
    if (args === null || typeof args !== 'object' || Array.isArray(args)) {
      return fail('INVALID_ARGS', 'Storage.open args must be object');
    }
    request = { method, args: args as { workerUrl?: string } };
  } else if (method === 'Client.new') {
    if (args === null || typeof args !== 'object' || Array.isArray(args)) {
      return fail('INVALID_ARGS', 'Client.new args must be object');
    }
    const a = args as Record<string, Ro1JsonValue>;
    const wireKeys = new Set([
      'rpcUrl',
      'contractConfig',
      'storageWorkerUrl',
      'circuitsBaseUrl',
      'circuitLock',
      'proverWorkerUrl',
    ]);
    for (const k of Object.keys(a)) {
      if (!wireKeys.has(k)) {
        return fail('INVALID_ARGS', `Client.new unsupported/forbidden key: ${k}`);
      }
    }
    if (typeof a.rpcUrl !== 'string' || !isHarnessLoopbackRpcUrl(a.rpcUrl)) {
      return fail('INVALID_ARGS', 'Client.new.rpcUrl must be harness loopback');
    }
    if (
      a.contractConfig === null ||
      typeof a.contractConfig !== 'object' ||
      Array.isArray(a.contractConfig)
    ) {
      return fail('INVALID_ARGS', 'Client.new.contractConfig object required');
    }
    request = {
      method,
      args: {
        rpcUrl: a.rpcUrl,
        contractConfig: a.contractConfig as Record<string, unknown>,
        ...(typeof a.storageWorkerUrl === 'string'
          ? { storageWorkerUrl: a.storageWorkerUrl }
          : {}),
        ...(typeof a.circuitsBaseUrl === 'string' ? { circuitsBaseUrl: a.circuitsBaseUrl } : {}),
        ...(a.circuitLock !== undefined ? { circuitLock: a.circuitLock } : {}),
        ...(typeof a.proverWorkerUrl === 'string' ? { proverWorkerUrl: a.proverWorkerUrl } : {}),
      },
    };
  } else if (method === 'Client.aspState' || method === 'Client.allContractsData') {
    if (
      args !== null &&
      (typeof args !== 'object' || Array.isArray(args) || Object.keys(args as object).length > 0)
    ) {
      // allow {} or null-as-empty → treat null as invalid; require {}
      if (args === null || Array.isArray(args)) {
        return fail('INVALID_ARGS', `${method} args must be empty object`);
      }
      if (Object.keys(args as object).length > 0) {
        return fail('INVALID_ARGS', `${method} takes no arguments`);
      }
    }
    if (args === null || typeof args !== 'object' || Array.isArray(args)) {
      return fail('INVALID_ARGS', `${method} args must be empty object`);
    }
    request = { method, args: {} };
  } else {
    return fail('UNKNOWN_METHOD', method);
  }

  const decision = authorizeReadOnlyCall(request);
  if (!decision.ok) {
    return fail(
      decision.reason.includes('not allowlisted') || decision.reason.includes('denied')
        ? 'UNKNOWN_METHOD'
        : 'INVALID_ARGS',
      decision.reason,
    );
  }
  return { ok: true, value: true };
}

export function isAllowedBrokerMethod(method: string): method is Ro1BrokerMethod {
  return ALLOWED_METHODS.has(method);
}
