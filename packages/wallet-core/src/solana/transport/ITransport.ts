/**
 * solana/transport/ITransport.ts — Transport type for the Solana RPC layer.
 *
 * ITransport is deliberately a direct alias of @solana/kit's RpcTransport.
 * There is no parallel abstraction: any Kit-compatible transport is an
 * ITransport, and every ITransport can be passed to createSolanaRpcFromTransport().
 *
 * Kit 8.3.0 shape (from @solana/rpc-spec):
 *   type RpcTransport = {
 *     <TResponse>(config: Readonly<{ payload: unknown; signal?: AbortSignal }>):
 *       Promise<RpcResponse<TResponse>>;
 *   };
 *
 * SECURITY INVARIANT 7 (plan):
 *   Transport modules have zero import dependencies on crypto/, vault/,
 *   signer/, or keyManager/. Only public JSON-RPC payloads (method names,
 *   base58 addresses, encoded signed transactions) may cross this boundary.
 */

import type { RpcTransport, RpcTransportDevnet } from '@solana/kit';

/** Approved transport abstraction: exactly Kit's RpcTransport. */
export type ITransport = RpcTransport;

/**
 * A transport tagged (at the type level only) as talking to Devnet.
 * Kit's `'~cluster'` tag is type-only: the runtime function has no such property.
 */
export type DevnetRpcTransport = RpcTransportDevnet;
