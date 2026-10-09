/**
 * solana/transport/HttpTransport.ts — Guarded Devnet HTTP transport.
 *
 * Wraps @solana/kit's createDefaultRpcTransport() (fetch-based, bigint-safe
 * JSON handling, request coalescing) with three additional guarantees:
 *
 *   1. FIXED URL      — the URL is re-validated through resolveNetworkConfig()
 *                       and bound once at construction. Callers cannot change it.
 *   2. METHOD ALLOWLIST — every payload must be a single JSON-RPC 2.0 request
 *                       whose method is in ALLOWED_RPC_METHODS. Anything else
 *                       (including requestAirdrop and batch arrays) is rejected
 *                       BEFORE any network request is made.
 *   3. TIMEOUT        — each request is bounded by
 *                       AbortSignal.any([AbortSignal.timeout(timeoutMs), callerSignal]).
 *                       Default 30 000 ms. No timers are created manually.
 *
 * No automatic retries: Kit's transport performs none and this wrapper adds none.
 * No custom headers: nothing is passed in `headers`. Kit itself adds
 * `accept`, `content-type` and the non-secret `solana-client: js/8.3.0`
 * (plus `accept-encoding` in Node builds only). fetch() sends no cookies to
 * this cross-origin endpoint under its default credentials mode.
 *
 * SECURITY INVARIANTS:
 *   INVARIANT 7 (plan): no imports from crypto/, vault/, signer/, keyManager/.
 *   INVARIANT 8 (plan): Devnet only (fixed, allowlisted URL).
 *   INVARIANT 9 (extended): no console.* calls.
 *   Error messages never include request payloads, parameters, or transaction data.
 */

import { createDefaultRpcTransport, devnet, isJsonRpcPayload, type RpcTransport } from '@solana/kit';
import { NetworkConfigError, resolveNetworkConfig, type NetworkConfig } from '../rpc/endpoints.js';
import type { DevnetRpcTransport } from './ITransport.js';

// ── Policy constants ──────────────────────────────────────────────────────────

/** Default (and maximum) per-request timeout. */
export const DEFAULT_RPC_TIMEOUT_MS = 30_000;

/** The only JSON-RPC methods this wallet may send. requestAirdrop is intentionally absent. */
export const ALLOWED_RPC_METHODS = Object.freeze([
  'getGenesisHash',
  'getBalance',
  'getAccountInfo',
  'getLatestBlockhash',
  'getFeeForMessage',
  'getMinimumBalanceForRentExemption',
  'getTokenAccountsByOwner',
  'sendTransaction',
  'getSignatureStatuses',
] as const);

/** Union of the approved RPC method names. */
export type AllowedRpcMethod = (typeof ALLOWED_RPC_METHODS)[number];

const ALLOWED_METHOD_SET: ReadonlySet<string> = new Set<string>(ALLOWED_RPC_METHODS);

// ── Errors ────────────────────────────────────────────────────────────────────

/**
 * Thrown when a payload is not a single JSON-RPC 2.0 request for an allowlisted
 * method. Raised before any network request.
 *
 * SECURITY: the message is generic — it does not include the method name,
 * parameters, or any other part of the rejected payload.
 */
export class RpcMethodNotAllowedError extends Error {
  constructor() {
    super('RPC request rejected: method is not permitted by the Devnet transport allowlist');
    this.name = 'RpcMethodNotAllowedError';
  }
}

/** Thrown when a request exceeds its timeout. Contains only the timeout value. */
export class RpcTimeoutError extends Error {
  readonly timeoutMs: number;
  constructor(timeoutMs: number) {
    super(`RPC request timed out after ${timeoutMs} ms`);
    this.name = 'RpcTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

// ── Options ───────────────────────────────────────────────────────────────────

export interface HttpTransportOptions {
  /**
   * Per-request timeout in milliseconds. Exists ONLY to make unit tests
   * practical; production callers should omit it. Must be a positive integer
   * no greater than DEFAULT_RPC_TIMEOUT_MS (the timeout can be shortened,
   * never extended).
   */
  readonly timeoutMs?: number;
}

type TransportRequest = Readonly<{ payload: unknown; signal?: AbortSignal }>;

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create the guarded Devnet transport.
 *
 * @param config  - A NetworkConfig. It is re-validated here so a hand-built
 *                  object cannot bypass the URL allowlist.
 * @param options - Test-only timeout override.
 *
 * @throws {NetworkConfigError} if the config is not an allowed Devnet config.
 * @throws {RangeError} if timeoutMs is out of range.
 */
export function createHttpTransport(
  config: NetworkConfig,
  options: HttpTransportOptions = {},
): DevnetRpcTransport {
  if (config.network !== 'devnet') {
    throw new NetworkConfigError('network must be devnet');
  }
  const validated = resolveNetworkConfig(config.rpcUrl);

  const timeoutMs = options.timeoutMs ?? DEFAULT_RPC_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > DEFAULT_RPC_TIMEOUT_MS) {
    throw new RangeError(
      `timeoutMs must be an integer between 1 and ${DEFAULT_RPC_TIMEOUT_MS}`,
    );
  }

  // Kit's default transport: fetch POST, bigint-safe JSON, request coalescing.
  // No headers are supplied by us.
  const inner = createDefaultRpcTransport({ url: devnet(validated.rpcUrl) });

  const guarded: RpcTransport = async <TResponse>({ payload, signal }: TransportRequest) => {
    // 1. Allowlist — single JSON-RPC 2.0 request only (arrays/batches fail here).
    if (!isJsonRpcPayload(payload) || !ALLOWED_METHOD_SET.has(payload.method)) {
      throw new RpcMethodNotAllowedError();
    }

    // 2. Timeout composed with the caller's signal.
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signals: AbortSignal[] = signal ? [timeoutSignal, signal] : [timeoutSignal];
    const combinedSignal = AbortSignal.any(signals);

    if (combinedSignal.aborted) {
      throw combinedSignal.reason;
    }

    // 3. Single attempt — no retries.
    try {
      return await inner<TResponse>({ payload, signal: combinedSignal });
    } catch (error) {
      // Map our own timeout to a typed error. If the caller aborted, their
      // abort reason propagates unchanged.
      if (timeoutSignal.aborted && !(signal?.aborted ?? false)) {
        throw new RpcTimeoutError(timeoutMs);
      }
      throw error;
    }
  };

  // Kit's '~cluster' tag is type-only; the runtime function never carries it.
  return guarded as DevnetRpcTransport;
}
