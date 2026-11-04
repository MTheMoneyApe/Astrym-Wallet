/**
 * Host-side write-pool handle for private payments.
 *
 * The real SDK surface (verified in stellar-private-payments@0.2.1):
 *   Client.account(options, signer) → Account
 *   Account.derivePrivacyKeys()
 *   Account.pool({ poolContract }) → PrivatePool
 *   PrivatePool.deposit / transfer / withdraw → PoolExecuteResult.hashes
 *
 * This module stores an optional injected {@link SppPrivatePool}-compatible
 * adapter. It does NOT invent a PrivatePool. Until a write runtime + WalletSigner
 * IPC is wired, execute fails closed with SESSION_NOT_READY.
 */

import type {
  SppPrivateOperation,
  SppPrivatePool,
  SppPrivatePoolResult,
} from '@solanym/wallet-core/src/stellar/spp/sppNymOption.js';
import {
  SPP_HOST_BRIDGE_CHANNEL,
  type SppHostExecuteRequest,
  type SppHostExecuteResult,
  type SppHostLifecycleEvent,
} from '../shared/sppHostBridge.js';
import { withSppHostNymFetchProxy } from './sppHostNymFetchProxy.js';

export type SppHostWritePoolStatus = {
  hasWritePool: boolean;
  poolContract: string | null;
  generation: number;
};

let writePool: SppPrivatePool | null = null;
let boundPoolContract: string | null = null;
let generation = 0;
let lifecycleListener: ((event: SppHostLifecycleEvent) => void) | null = null;

export function setSppHostLifecyclePublisher(
  publish: ((event: SppHostLifecycleEvent) => void) | null,
): void {
  lifecycleListener = publish;
}

function publish(state: SppHostLifecycleEvent['state'], message?: string): void {
  generation += 1;
  const event: SppHostLifecycleEvent = {
    channel: SPP_HOST_BRIDGE_CHANNEL,
    type: 'SPP_HOST_POOL_LIFECYCLE',
    generation,
    state,
    ...(message !== undefined ? { message } : {}),
  };
  lifecycleListener?.(event);
}

export function getSppHostWritePoolStatus(): SppHostWritePoolStatus {
  return {
    hasWritePool: writePool !== null,
    poolContract: boundPoolContract,
    generation,
  };
}

/**
 * Register a write pool adapter created inside this page (tests or future
 * Client.account().pool() wiring). Clears previous handle.
 */
export function registerSppHostWritePool(input: {
  pool: SppPrivatePool;
  poolContract: string;
}): void {
  writePool = input.pool;
  boundPoolContract = input.poolContract;
  publish('write_pool_ready');
}

export function clearSppHostWritePool(reason?: string): void {
  writePool = null;
  boundPoolContract = null;
  publish('cleared', reason);
}

export function noteSppHostReadonlySessionReady(): void {
  if (writePool) return;
  publish('session_ready_readonly', 'RO session ready; write PrivatePool not bound yet');
}

function mapPoolResult(result: SppPrivatePoolResult): { txHash: string | null } {
  return { txHash: result.txHash };
}

/**
 * Execute a private payment against the in-page write pool.
 * Fail-closed: no clearnet, no invented success, no global fetch mutation here.
 */
export async function executeSppHostWritePool(
  request: SppHostExecuteRequest,
): Promise<SppHostExecuteResult> {
  const { id, payload } = request;

  if (payload.nymMode !== 'nym' || !payload.nymConnected || payload.sppSelected !== true) {
    return {
      channel: SPP_HOST_BRIDGE_CHANNEL,
      type: 'SPP_HOST_EXECUTE_PRIVATE_PAYMENT_RESULT',
      id,
      ok: false,
      code: 'NYM_REQUIRED',
      message: 'spp-host refuse: Nym must be connected and SPP selected (fail-closed).',
    };
  }

  if (!writePool || !boundPoolContract) {
    return {
      channel: SPP_HOST_BRIDGE_CHANNEL,
      type: 'SPP_HOST_EXECUTE_PRIVATE_PAYMENT_RESULT',
      id,
      ok: false,
      code: 'SESSION_NOT_READY',
      message:
        'Write PrivatePool no está registrado en spp-host. La sesión RO no ejecuta deposit/transfer/withdraw.',
    };
  }

  if (payload.poolContract !== boundPoolContract) {
    return {
      channel: SPP_HOST_BRIDGE_CHANNEL,
      type: 'SPP_HOST_EXECUTE_PRIVATE_PAYMENT_RESULT',
      id,
      ok: false,
      code: 'INVALID_REQUEST',
      message: 'poolContract no coincide con el PrivatePool registrado en el host.',
    };
  }

  const activePool = writePool;
  const amount = BigInt(payload.amountStroops);
  const operation: SppPrivateOperation = payload.operation;

  try {
    const run = async (): Promise<SppPrivatePoolResult> => {
      switch (operation) {
        case 'deposit':
          if (payload.recipient) {
            throw Object.assign(new Error('Un depósito SPP no lleva destinatario.'), {
              code: 'INVALID_REQUEST',
            });
          }
          return activePool.deposit(amount);
        case 'transfer':
          if (!payload.recipient) {
            throw Object.assign(
              new Error('La transferencia privada necesita destinatario G….'),
              { code: 'INVALID_REQUEST' },
            );
          }
          return activePool.transfer(payload.recipient, amount);
        case 'withdraw':
          return activePool.withdraw(amount, payload.recipient ?? null);
        default: {
          const unexpected: never = operation;
          throw Object.assign(new Error(`Operación desconocida: ${String(unexpected)}`), {
            code: 'INVALID_REQUEST',
          });
        }
      }
    };

    // SDK RPC from this page must go through SW Nym fetch — no silent clearnet.
    const result = await withSppHostNymFetchProxy(payload.rpcUrl, run);
    const mapped = mapPoolResult(result);
    return {
      channel: SPP_HOST_BRIDGE_CHANNEL,
      type: 'SPP_HOST_EXECUTE_PRIVATE_PAYMENT_RESULT',
      id,
      ok: true,
      operation,
      txHash: mapped.txHash,
      rpcRoutedViaNym: true,
    };
  } catch (cause) {
    const code =
      cause && typeof cause === 'object' && (cause as { code?: string }).code === 'INVALID_REQUEST'
        ? 'INVALID_REQUEST'
        : 'EXECUTION_FAILED';
    const message = cause instanceof Error ? cause.message : 'WASM/private pool execution failed';
    return {
      channel: SPP_HOST_BRIDGE_CHANNEL,
      type: 'SPP_HOST_EXECUTE_PRIVATE_PAYMENT_RESULT',
      id,
      ok: false,
      code,
      message: message.slice(0, 500),
    };
  }
}
