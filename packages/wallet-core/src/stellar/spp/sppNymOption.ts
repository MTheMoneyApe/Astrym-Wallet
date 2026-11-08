/**
 * Stellar Private Payments as a wallet option that exists only while Nym is on.
 * Soroban RPC for a private payment uses the Nym fetch and does not fall back
 * to clearnet.
 */

import { StrKey } from '@stellar/stellar-sdk';
import {
  assertAuthorizationFingerprint,
  beginPrivatePaymentExecution,
  privatePaymentFingerprint,
} from './sppExecutionGuard.js';
import { assertSppTestnetBroadcastAuthorized } from './sppBroadcastGate.js';
import { assertFeeWithinCeiling, maxFeeStroopsForOperation } from './sppFeePolicy.js';

export const STELLAR_SOROBAN_TESTNET_RPC = 'https://soroban-testnet.stellar.org';

export type SppNymMode = 'direct' | 'nym';

export type SppNymGate = {
  mode: SppNymMode;
  connected: boolean;
  selected: boolean;
};

export type SppOptionAvailability = 'requires_nym' | 'ready_to_enable';

export type SppPrivateOperation = 'deposit' | 'transfer' | 'withdraw';

export type SppPrivatePaymentRequest = {
  operation: SppPrivateOperation;
  poolContract: string;
  amountStroops: string;
  recipient?: string;
};

export type SppPrivatePoolResult = {
  txHash: string | null;
  /** Every hash from one SDK execute. Omitted by mocks that only set txHash. */
  txHashes?: readonly string[];
};

export type SppPrivatePool = {
  deposit(amount: bigint): Promise<SppPrivatePoolResult>;
  transfer(recipient: string, amount: bigint): Promise<SppPrivatePoolResult>;
  withdraw(amount: bigint, recipient: string | null): Promise<SppPrivatePoolResult>;
};

export type SppPrivatePaymentCode =
  | 'NYM_REQUIRED'
  | 'NOT_SELECTED'
  | 'INVALID_REQUEST'
  | 'SESSION_NOT_READY'
  | 'HOST_UNAVAILABLE'
  | 'RPC_FAILED'
  | 'EXECUTION_FAILED'
  | 'SUBMISSION_UNKNOWN'
  | 'DUPLICATE_EXECUTION'
  | 'UNAUTHORIZED'
  | 'BROADCAST_AWAITING_APPROVAL';

export class SppPrivatePaymentError extends Error {
  readonly code: SppPrivatePaymentCode;
  readonly txHashes: readonly string[];

  constructor(
    code: SppPrivatePaymentCode,
    message: string,
    options?: { cause?: unknown; txHashes?: readonly string[] },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'SppPrivatePaymentError';
    this.code = code;
    this.txHashes = options?.txHashes ?? [];
  }
}

function reportedPoolHashes(result: SppPrivatePoolResult): readonly string[] {
  if (result.txHashes) return result.txHashes;
  return result.txHash ? [result.txHash] : [];
}

function hashesCarriedBy(cause: unknown): readonly string[] {
  if (!cause || typeof cause !== 'object' || !('txHashes' in cause)) return [];
  const value = (cause as { txHashes?: unknown }).txHashes;
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

export type SppRpcFetch = (url: string, init?: RequestInit) => Promise<Response>;

export function sppOptionAvailability(input: {
  mode: SppNymMode;
  connected: boolean;
}): SppOptionAvailability {
  if (input.mode === 'nym' && input.connected) return 'ready_to_enable';
  return 'requires_nym';
}

export function sppPrivatePaymentsAllowed(gate: SppNymGate): boolean {
  return gate.selected && sppOptionAvailability(gate) === 'ready_to_enable';
}

export function xlmToStroops(amountXlm: string): string {
  const trimmed = amountXlm.trim();
  if (!/^\d+(\.\d{1,7})?$/.test(trimmed)) {
    throw new SppPrivatePaymentError(
      'INVALID_REQUEST',
      'El importe debe ser un número positivo de XLM con hasta 7 decimales.',
    );
  }
  const [whole, frac = ''] = trimmed.split('.');
  const stroops = BigInt(whole ?? '0') * 10_000_000n + BigInt((frac + '0000000').slice(0, 7));
  if (stroops <= 0n) {
    throw new SppPrivatePaymentError('INVALID_REQUEST', 'El importe debe ser mayor que cero.');
  }
  return stroops.toString();
}

function assertRequest(request: SppPrivatePaymentRequest): {
  operation: SppPrivateOperation;
  poolContract: string;
  amount: bigint;
  recipient: string | null;
} {
  if (!StrKey.isValidContract(request.poolContract)) {
    throw new SppPrivatePaymentError(
      'INVALID_REQUEST',
      'El contrato del pool debe ser un StrKey C… de Stellar.',
    );
  }
  if (!/^[1-9][0-9]*$/.test(request.amountStroops)) {
    throw new SppPrivatePaymentError('INVALID_REQUEST', 'amountStroops debe ser un entero positivo.');
  }
  const amount = BigInt(request.amountStroops);
  const recipient = request.recipient?.trim() ? request.recipient.trim() : null;
  if (recipient && !StrKey.isValidEd25519PublicKey(recipient)) {
    throw new SppPrivatePaymentError('INVALID_REQUEST', 'El destinatario debe ser una cuenta Stellar G….');
  }
  switch (request.operation) {
    case 'deposit':
      if (recipient) {
        throw new SppPrivatePaymentError('INVALID_REQUEST', 'Un depósito SPP no lleva destinatario.');
      }
      return { operation: 'deposit', poolContract: request.poolContract, amount, recipient: null };
    case 'transfer':
      if (!recipient) {
        throw new SppPrivatePaymentError(
          'INVALID_REQUEST',
          'La transferencia privada necesita un destinatario G….',
        );
      }
      return { operation: 'transfer', poolContract: request.poolContract, amount, recipient };
    case 'withdraw':
      return { operation: 'withdraw', poolContract: request.poolContract, amount, recipient };
    default: {
      const unexpected: never = request.operation;
      throw new SppPrivatePaymentError(
        'INVALID_REQUEST',
        `Operación SPP desconocida: ${String(unexpected)}`,
      );
    }
  }
}

function sameOrigin(url: string, rpcUrl: string): boolean {
  return new URL(url).origin === new URL(rpcUrl).origin;
}

function asUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** Serial queue so legacy SDK paths that still need a temporary fetch wrap never race. */
let sppTransportTail: Promise<unknown> = Promise.resolve();

/**
 * Build a fetch that routes same-origin Soroban RPC through Nym and rejects
 * every other origin. Does not touch `globalThis.fetch`.
 */
export function createSppNymScopedFetch(rpcUrl: string, nymFetch: SppRpcFetch): SppRpcFetch {
  return async (url, init) => {
    if (!sameOrigin(url, rpcUrl)) {
      throw new SppPrivatePaymentError(
        'RPC_FAILED',
        `SPP solo puede llamar al origen del RPC Soroban (${new URL(rpcUrl).origin}); se bloqueó ${url}.`,
      );
    }
    return nymFetch(url, init);
  };
}

/**
 * @deprecated Prefer pools / hosts that accept `createSppNymScopedFetch` injection.
 * Last-resort serialized wrap for SDKs that hard-code `globalThis.fetch`.
 */
export async function withSppRpcThroughNym<T>(
  rpcUrl: string,
  nymFetch: SppRpcFetch,
  fn: () => Promise<T>,
): Promise<T> {
  const run = async (): Promise<T> => {
    const previous = globalThis.fetch;
    const routed: typeof fetch = async (input, init) => {
      const url = asUrl(input);
      if (sameOrigin(url, rpcUrl)) return nymFetch(url, init);
      return previous.call(globalThis, input, init);
    };
    globalThis.fetch = routed;
    try {
      return await fn();
    } finally {
      globalThis.fetch = previous;
    }
  };
  const next = sppTransportTail.then(run, run);
  sppTransportTail = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

async function probeSorobanRpc(rpcUrl: string, nymFetch: SppRpcFetch): Promise<void> {
  let response: Response;
  try {
    response = await nymFetch(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
    });
  } catch (cause) {
    throw new SppPrivatePaymentError(
      'RPC_FAILED',
      'El RPC de Soroban no salió por Nym. No hay reintento por clearnet.',
      { cause },
    );
  }
  if (!response.ok) {
    throw new SppPrivatePaymentError(
      'RPC_FAILED',
      `Soroban RPC vía Nym respondió HTTP ${response.status}. No hay reintento por clearnet.`,
    );
  }
}

export async function executeSppPrivatePayment(input: {
  gate: SppNymGate;
  request: SppPrivatePaymentRequest;
  rpcUrl: string;
  nymFetch: SppRpcFetch;
  pool: SppPrivatePool | null;
  /**
   * When true (default), skip mutating globalThis.fetch and only probe + run the
   * pool. Prefer this when the pool already routes RPC via Nym (host proxy / tests).
   */
  preferInjectedTransport?: boolean;
  /** Required: must match privatePaymentFingerprint of the request. */
  authorizationFingerprint: string;
  /** Active Stellar G… for the approval packet (optional but recommended). */
  senderAddress?: string | null;
  /** Explicit max fee ceiling in stroops (never unbounded). */
  maxFeeStroops?: string | null;
}): Promise<{
  operation: SppPrivateOperation;
  txHash: string | null;
  txHashes: readonly string[];
  rpcRoutedViaNym: true;
  confirmation: 'confirmed' | 'unknown';
}> {
  if (sppOptionAvailability(input.gate) !== 'ready_to_enable') {
    throw new SppPrivatePaymentError(
      'NYM_REQUIRED',
      'Stellar Private Payments requiere Nym conectado. En modo direct el pago privado queda cerrado.',
    );
  }
  if (!input.gate.selected) {
    throw new SppPrivatePaymentError('NOT_SELECTED', 'Activa Stellar Private Payments en el panel de Nym.');
  }
  const request = assertRequest(input.request);
  if (!input.pool) {
    throw new SppPrivatePaymentError(
      'SESSION_NOT_READY',
      'Inicializa la sesión SPP con Nym conectado antes de depositar, transferir o retirar.',
    );
  }

  try {
    assertAuthorizationFingerprint(
      {
        operation: request.operation,
        poolContract: request.poolContract,
        amountStroops: request.amount.toString(),
        recipient: request.recipient,
      },
      input.authorizationFingerprint,
    );
  } catch (cause) {
    throw new SppPrivatePaymentError(
      'UNAUTHORIZED',
      cause instanceof Error ? cause.message : 'Autorización inválida',
      { cause },
    );
  }

  const fingerprint = privatePaymentFingerprint({
    operation: request.operation,
    poolContract: request.poolContract,
    amountStroops: request.amount.toString(),
    recipient: request.recipient,
  });
  let release: (opts?: { completed?: boolean }) => void;
  try {
    ({ release } = beginPrivatePaymentExecution(fingerprint));
  } catch (cause) {
    throw new SppPrivatePaymentError(
      'DUPLICATE_EXECUTION',
      cause instanceof Error ? cause.message : 'Ejecución duplicada',
      { cause },
    );
  }

  const maxFeeStroops =
    input.maxFeeStroops?.trim() || maxFeeStroopsForOperation(request.operation);
  try {
    assertFeeWithinCeiling(request.operation, maxFeeStroops);
  } catch (cause) {
    release();
    throw new SppPrivatePaymentError(
      'INVALID_REQUEST',
      cause instanceof Error ? cause.message : 'Fee ceiling violated',
      { cause },
    );
  }
  try {
    assertSppTestnetBroadcastAuthorized({
      network: 'testnet',
      operation: request.operation,
      poolContract: request.poolContract,
      amountXlm: (Number(request.amount) / 10_000_000).toFixed(7),
      amountStroops: request.amount.toString(),
      senderAddress: input.senderAddress?.trim() || null,
      recipientAddress: request.recipient,
      feeNote:
        'Inclusion + Soroban resources; SDK may set fee at submit but must not exceed maxFeeStroops.',
      maxFeeStroops,
      rpcUrl: input.rpcUrl,
      transport: 'nym',
      preparedAt: new Date().toISOString(),
    });
  } catch (cause) {
    release();
    throw new SppPrivatePaymentError(
      'BROADCAST_AWAITING_APPROVAL',
      cause instanceof Error ? cause.message : 'Broadcast blocked pending approval',
      { cause },
    );
  }

  const pool = input.pool;
  const preferInjected = input.preferInjectedTransport !== false;
  let completed = false;

  const run = async () => {
    await probeSorobanRpc(input.rpcUrl, input.nymFetch);
    try {
      const result = await runPool(pool, request);
      const hashes = reportedPoolHashes(result);
      if (hashes.length !== 1) {
        throw new SppPrivatePaymentError(
          'SUBMISSION_UNKNOWN',
          `El SDK devolvió ${hashes.length} hash(es). No se confirma solo el primero y no hay reintento. hashes=${hashes.join(',')}`,
          { txHashes: hashes },
        );
      }
      completed = true;
      return {
        operation: request.operation,
        txHash: hashes[0] ?? null,
        txHashes: hashes,
        rpcRoutedViaNym: true as const,
        confirmation: 'confirmed' as const,
      };
    } catch (cause) {
      if (cause instanceof SppPrivatePaymentError) throw cause;
      const message = cause instanceof Error ? cause.message : 'El pago privado SPP falló';
      const recovered = hashesCarriedBy(cause);
      throw new SppPrivatePaymentError(
        'EXECUTION_FAILED',
        recovered.length > 0 ? `${message} completedHashes=${recovered.join(',')}` : message,
        { cause, txHashes: recovered },
      );
    }
  };

  try {
    if (preferInjected) {
      return await run();
    }
    return await withSppRpcThroughNym(input.rpcUrl, input.nymFetch, run);
  } finally {
    release(completed ? { completed: true } : undefined);
  }
}

async function runPool(
  pool: SppPrivatePool,
  request: { operation: SppPrivateOperation; amount: bigint; recipient: string | null },
): Promise<SppPrivatePoolResult> {
  switch (request.operation) {
    case 'deposit':
      return pool.deposit(request.amount);
    case 'transfer':
      return pool.transfer(request.recipient ?? '', request.amount);
    case 'withdraw':
      return pool.withdraw(request.amount, request.recipient);
    default: {
      const unexpected: never = request.operation;
      throw new SppPrivatePaymentError('INVALID_REQUEST', `Operación SPP desconocida: ${String(unexpected)}`);
    }
  }
}
