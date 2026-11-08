/**
 * Host-side write-pool handle for private payments.
 *
 * The real SDK surface (verified in stellar-private-payments@0.2.1):
 *   Client.account(options, signer) → Account
 *   Account.derivePrivacyKeys()
 *   Account.pool({ poolContract }) → PrivatePool
 *   PrivatePool.deposit / transfer / withdraw → PoolExecuteResult.hashes
 *
 * This module stores the in-page write {@link SppPrivatePool} adapter created by
 * {@link initializeSppHostWritePool}. Execute fails closed with SESSION_NOT_READY
 * until that registration completes. WalletSigner IPC is remote via SW.
 */

import { Networks } from '@stellar/stellar-sdk';
import type {
  SppPrivateOperation,
  SppPrivatePool,
  SppPrivatePoolResult,
} from '@solanym/wallet-core/src/stellar/spp/sppNymOption.js';
import { assertSppTestnetBroadcastAuthorized } from '@solanym/wallet-core/src/stellar/spp/sppBroadcastGate.js';
import { maxFeeStroopsForOperation } from '@solanym/wallet-core/src/stellar/spp/sppFeePolicy.js';
import { runWithSppHostFeeScope } from './sppHostFeeScope.js';
import {
  SppMultiAccountSequenceTracker,
  abortSppAccountOperation,
  assertFreshSequenceMatchesExpected,
  beginSppAccountOperation,
  confirmSppAccountOperation,
} from '@solanym/wallet-core/src/stellar/spp/sppAccountSequenceTracker.js';
import { privatePaymentFingerprint } from '@solanym/wallet-core/src/stellar/spp/sppExecutionGuard.js';
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

type SequenceInFlight = {
  address: string;
  fingerprint: string;
};

let writePool: SppPrivatePool | null = null;
let boundPoolContract: string | null = null;
let generation = 0;
let lifecycleListener: ((event: SppHostLifecycleEvent) => void) | null = null;
let sequenceTracker = new SppMultiAccountSequenceTracker();

export function setSppHostLifecyclePublisher(
  publish: ((event: SppHostLifecycleEvent) => void) | null,
): void {
  lifecycleListener = publish;
}

/** Inject a tracker (tests) or replace the module singleton. */
export function setSppHostSequenceTracker(tracker: SppMultiAccountSequenceTracker): void {
  sequenceTracker = tracker;
}

export function getSppHostSequenceTracker(): SppMultiAccountSequenceTracker {
  return sequenceTracker;
}

/** Test helper — clears account-scoped sequence state. */
export function resetSppHostSequenceTrackerForTests(): void {
  sequenceTracker = new SppMultiAccountSequenceTracker();
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

function failureResult(
  id: string,
  code: Extract<SppHostExecuteResult, { ok: false }>['code'],
  message: string,
  txHashes: readonly string[] = [],
): SppHostExecuteResult {
  return {
    channel: SPP_HOST_BRIDGE_CHANNEL,
    type: 'SPP_HOST_EXECUTE_PRIVATE_PAYMENT_RESULT',
    id,
    ok: false,
    code,
    message: message.slice(0, 500),
    ...(txHashes.length > 0 ? { txHashes: [...txHashes] } : {}),
  };
}

function hashesOf(result: SppPrivatePoolResult): readonly string[] {
  if (result.txHashes) return result.txHashes;
  return result.txHash ? [result.txHash] : [];
}

function hashesFromCause(cause: unknown): readonly string[] {
  if (!cause || typeof cause !== 'object' || !('txHashes' in cause)) return [];
  const value = (cause as { txHashes?: unknown }).txHashes;
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

function abortSequenceInFlight(begun: SequenceInFlight | null): void {
  if (!begun) return;
  const state = sequenceTracker.get(begun.address);
  if (!state) return;
  const aborted = abortSppAccountOperation(state, begun.fingerprint);
  if (aborted.ok) sequenceTracker.replace(aborted.state);
}

/**
 * Validate against the multi-account tracker and mark the op in-flight.
 * Caller must pass when both signingAccount and freshSequence are present.
 */
function beginSequenceTracking(
  payload: SppHostExecuteRequest['payload'] & {
    signingAccount: string;
    freshSequence: string;
  },
): { ok: true; begun: SequenceInFlight } | { ok: false; message: string } {
  const { signingAccount, freshSequence } = payload;

  const fingerprint =
    payload.operationFingerprint ??
    privatePaymentFingerprint({
      operation: payload.operation,
      poolContract: payload.poolContract,
      amountStroops: payload.amountStroops,
      recipient: payload.recipient ?? null,
    });

  let state = sequenceTracker.get(signingAccount);
  if (!state) {
    state = sequenceTracker.seed(signingAccount, freshSequence);
  }

  const seqCheck = assertFreshSequenceMatchesExpected(state, freshSequence);
  if (!seqCheck.ok) {
    return { ok: false, message: seqCheck.message };
  }

  const begin = beginSppAccountOperation(seqCheck.state, fingerprint);
  if (!begin.ok) {
    return { ok: false, message: begin.message };
  }
  sequenceTracker.replace(begin.state);
  return { ok: true, begun: { address: signingAccount, fingerprint } };
}

function confirmOrAbortSequence(
  begun: SequenceInFlight,
  txHash: string | null,
  nextFreshSequence: string | undefined,
): void {
  const state = sequenceTracker.get(begun.address);
  if (!state) return;

  if (txHash && nextFreshSequence !== undefined) {
    const confirmed = confirmSppAccountOperation(state, {
      fingerprint: begun.fingerprint,
      txHash,
      nextFreshSequence,
    });
    if (confirmed.ok) {
      sequenceTracker.replace(confirmed.state);
      return;
    }
  }
  // Success without hash/next sequence, or confirm rejected → clear in-flight, do not advance.
  abortSequenceInFlight(begun);
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
    return failureResult(
      id,
      'NYM_REQUIRED',
      'spp-host refuse: Nym must be connected and SPP selected (fail-closed).',
    );
  }

  if (!writePool || !boundPoolContract) {
    return failureResult(
      id,
      'SESSION_NOT_READY',
      'Write PrivatePool no está registrado en spp-host. La sesión RO no ejecuta deposit/transfer/withdraw.',
    );
  }

  if (payload.poolContract !== boundPoolContract) {
    return failureResult(
      id,
      'INVALID_REQUEST',
      'poolContract no coincide con el PrivatePool registrado en el host.',
    );
  }

  const activePool = writePool;
  const amount = BigInt(payload.amountStroops);
  const operation: SppPrivateOperation = payload.operation;
  const maxFeeStroops = maxFeeStroopsForOperation(operation);

  let sequenceBegun: SequenceInFlight | null = null;

  if (payload.signingAccount !== undefined && payload.freshSequence !== undefined) {
    const begun = beginSequenceTracking({
      ...payload,
      signingAccount: payload.signingAccount,
      freshSequence: payload.freshSequence,
    });
    if (!begun.ok) {
      return failureResult(id, 'INVALID_REQUEST', begun.message);
    }
    sequenceBegun = begun.begun;
  }

  try {
    assertSppTestnetBroadcastAuthorized({
      network: 'testnet',
      operation,
      poolContract: payload.poolContract,
      amountXlm: (Number(amount) / 10_000_000).toFixed(7),
      amountStroops: payload.amountStroops,
      senderAddress: payload.signingAccount ?? null,
      recipientAddress: payload.recipient ?? null,
      feeNote:
        'Inclusion + Soroban resources; SDK may set fee at submit but must not exceed maxFeeStroops.',
      maxFeeStroops,
      rpcUrl: payload.rpcUrl,
      transport: 'nym',
      preparedAt: new Date().toISOString(),
    });
  } catch (cause) {
    abortSequenceInFlight(sequenceBegun);
    return failureResult(
      id,
      'UNAUTHORIZED',
      cause instanceof Error ? cause.message : 'Broadcast blocked',
    );
  }

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
    // The fee scope makes the remote signer enforce tx.fee / minResourceFee
    // with the same helper the service worker uses. There is no self-check
    // of the ceiling against itself.
    const result = await runWithSppHostFeeScope(
      {
        operation,
        approvedMaxFeeStroops: maxFeeStroops,
        minResourceFeeStroops: null,
        allowedContractId: payload.poolContract,
        networkPassphrase: Networks.TESTNET,
      },
      () => withSppHostNymFetchProxy(payload.rpcUrl, run),
    );
    const mapped = mapPoolResult(result);
    const hashes = hashesOf(mapped);
    if (hashes.length !== 1) {
      abortSequenceInFlight(sequenceBegun);
      return failureResult(
        id,
        'EXECUTION_FAILED',
        `SPP execute returned ${hashes.length} hash(es); not confirming one and not retrying. hashes=${hashes.join(',')}`,
        hashes,
      );
    }

    if (sequenceBegun) {
      confirmOrAbortSequence(sequenceBegun, hashes[0] ?? null, payload.nextFreshSequence);
    }

    return {
      channel: SPP_HOST_BRIDGE_CHANNEL,
      type: 'SPP_HOST_EXECUTE_PRIVATE_PAYMENT_RESULT',
      id,
      ok: true,
      operation,
      txHash: hashes[0] ?? null,
      txHashes: [...hashes],
      rpcRoutedViaNym: true,
    };
  } catch (cause) {
    abortSequenceInFlight(sequenceBegun);
    const code =
      cause && typeof cause === 'object' && (cause as { code?: string }).code === 'INVALID_REQUEST'
        ? 'INVALID_REQUEST'
        : 'EXECUTION_FAILED';
    const recovered = hashesFromCause(cause);
    const message = cause instanceof Error ? cause.message : 'WASM/private pool execution failed';
    return failureResult(id, code, message, recovered);
  }
}
