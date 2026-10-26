/**
 * Fase 2.30 — Typed RO-1 broker message types (harness only).
 *
 * Experimental IPC-shaped envelopes. NOT a browser security boundary by itself.
 * G8/G9 remain FAIL.
 */

import type { ReadOnlyAllowedMethod } from '../readOnlyPolicy/types.js';
import { G8_HOST_STATUS, G9_CONFIG_STATUS } from '../readOnlyPolicy/types.js';

export const RO1_BROKER_VERSION = 1 as const;

export type Ro1BrokerMethod = ReadOnlyAllowedMethod;

/** JSON-safe primitives only — no functions, undefined, symbols, bigint. */
export type Ro1JsonPrimitive = string | number | boolean | null;
export type Ro1JsonValue =
  | Ro1JsonPrimitive
  | Ro1JsonValue[]
  | { readonly [key: string]: Ro1JsonValue };

export type Ro1RequestMessage = {
  v: typeof RO1_BROKER_VERSION;
  kind: 'req';
  sessionId: string;
  requestId: string;
  method: Ro1BrokerMethod;
  args: Ro1JsonValue;
};

export type Ro1ResponseMessage = {
  v: typeof RO1_BROKER_VERSION;
  kind: 'res';
  sessionId: string;
  requestId: string;
  ok: boolean;
  /** Present only when ok === true; must be JSON-safe summary, never raw Client. */
  result?: Ro1JsonValue;
  /** Present only when ok === false. */
  error?: { code: string; message: string };
};

export type Ro1BrokerErrorCode =
  | 'MALFORMED'
  | 'UNKNOWN_METHOD'
  | 'EXTRA_FIELD'
  | 'INVALID_ARGS'
  | 'SESSION_CLOSED'
  | 'SESSION_UNKNOWN'
  | 'DUPLICATE_REQUEST'
  | 'LATE_OR_UNKNOWN_RESPONSE'
  | 'HANDLER_ERROR'
  | 'TRANSPORT'
  | 'FORBIDDEN_VALUE';

export type Ro1DispatchResult =
  | { ok: true; response: Ro1ResponseMessage }
  | { ok: false; response: Ro1ResponseMessage };

export type Ro1BrokerBackend = {
  /**
   * Execute an authorized RO-1 method. Must NEVER return a raw SDK Client
   * or live object graphs with methods.
   */
  execute(
    method: Ro1BrokerMethod,
    args: Ro1JsonValue,
  ): Promise<Ro1JsonValue>;
};

export { G8_HOST_STATUS, G9_CONFIG_STATUS };
