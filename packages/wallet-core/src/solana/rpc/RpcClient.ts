/**
 * solana/rpc/RpcClient.ts — Devnet Solana RPC client and cluster verification.
 *
 * createRpcClient() wraps @solana/kit's createSolanaRpcFromTransport() and
 * narrows the exposed type to exactly the nine approved RPC methods. The
 * runtime allowlist in HttpTransport is the enforcement mechanism; this
 * narrowing makes any other method a compile-time error as well.
 *
 * assertDevnetCluster() verifies the connected cluster by genesis hash. It
 * fails closed: any mismatch, malformed value, or RPC error rejects. Results
 * are not cached — the extension layer decides when to call it.
 *
 * SECURITY INVARIANTS:
 *   INVARIANT 7 (plan): no imports from crypto/, vault/, signer/, keyManager/.
 *   INVARIANT 8 (plan): Devnet only — verified by genesis hash, not URL alone.
 *   INVARIANT 9 (extended): no console.* calls.
 */

import {
  createSolanaRpcFromTransport,
  type GetAccountInfoApi,
  type GetBalanceApi,
  type GetFeeForMessageApi,
  type GetGenesisHashApi,
  type GetLatestBlockhashApi,
  type GetMinimumBalanceForRentExemptionApi,
  type GetSignatureStatusesApi,
  type GetTokenAccountsByOwnerApi,
  type RpcDevnet,
  type RpcSendOptions,
  type SendTransactionApi,
} from '@solana/kit';
import type { DevnetRpcTransport } from '../transport/ITransport.js';
import { DEVNET_GENESIS_HASH } from './endpoints.js';

// ── Types ─────────────────────────────────────────────────────────────────────

/** The approved Solana RPC API surface (must match ALLOWED_RPC_METHODS). */
export type AllowedSolanaRpcApi = GetGenesisHashApi &
  GetBalanceApi &
  GetAccountInfoApi &
  GetLatestBlockhashApi &
  GetFeeForMessageApi &
  GetMinimumBalanceForRentExemptionApi &
  GetTokenAccountsByOwnerApi &
  SendTransactionApi &
  GetSignatureStatusesApi;

/** Devnet-tagged RPC client exposing only the approved methods. */
export type DevnetRpcClient = RpcDevnet<AllowedSolanaRpcApi>;

// ── Errors ────────────────────────────────────────────────────────────────────

/** Base58 alphabet, 32–44 chars: the shape of a genesis hash. */
const BASE58_HASH_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Thrown when the connected cluster's genesis hash is not the Devnet hash.
 *
 * The received hash is public data and is included only if it is a
 * well-formed base58 string; anything else is reported as malformed so that
 * arbitrary server-supplied content never reaches error messages.
 */
export class ClusterMismatchError extends Error {
  readonly expectedGenesisHash: string = DEVNET_GENESIS_HASH;
  readonly receivedGenesisHash: string | null;

  constructor(received: unknown) {
    const safeReceived =
      typeof received === 'string' && BASE58_HASH_PATTERN.test(received) ? received : null;
    super(
      `Connected cluster is not Devnet: expected genesis hash ${DEVNET_GENESIS_HASH}, ` +
        `received ${safeReceived ?? '<malformed>'}`,
    );
    this.name = 'ClusterMismatchError';
    this.receivedGenesisHash = safeReceived;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Create a Devnet RPC client over the given (guarded) transport.
 * The return type is narrowed to the approved methods only.
 */
export function createRpcClient(transport: DevnetRpcTransport): DevnetRpcClient {
  return createSolanaRpcFromTransport(transport);
}

/**
 * Verify that the RPC endpoint serves Devnet by comparing getGenesisHash()
 * against DEVNET_GENESIS_HASH. Fails closed. Not cached.
 *
 * @throws {ClusterMismatchError} if the hash differs or is malformed.
 * @throws Any transport/RPC error (timeout, HTTP error, JSON-RPC error) — the
 *         caller must treat these as "not verified".
 */
export async function assertDevnetCluster(
  rpc: Pick<DevnetRpcClient, 'getGenesisHash'>,
  options?: RpcSendOptions,
): Promise<void> {
  const received: unknown = await rpc.getGenesisHash().send(options);
  if (received !== DEVNET_GENESIS_HASH) {
    throw new ClusterMismatchError(received);
  }
}
