/**
 * Operation-scoped authorization for Testnet `deposit` only.
 *
 * Independent of {@link isSppTestnetBroadcastAuthorized} (global mutator gate)
 * and of {@link isSppRegistrationBroadcastAuthorized}. Approving a deposit must
 * never authorize registration, private transfer, or withdrawal.
 *
 * Default OFF. Authorizes only the exact approved account, pool, amount,
 * sequence, network, fee ceiling, and transaction fingerprint.
 */

import { assertFeeWithinCeiling } from './sppFeePolicy.js';

export const SPP_DEPOSIT_AUTH_VERSION = '2026-11-05-deposit-v1' as const;

export type SppDepositApprovedTx = {
  step: 1;
  role: 'sender';
  operation: 'deposit';
  sourceAddress: string;
  poolContract: string;
  amountStroops: string;
  amountXlm: string;
  sequenceAtApproval: string;
  networkPassphrase: string;
  maxFeeStroops: string;
  transactionFingerprint: string;
};

export type SppDepositApprovalPacket = {
  version: typeof SPP_DEPOSIT_AUTH_VERSION;
  network: 'testnet';
  networkPassphrase: string;
  kdf_domain: 'Nethermind';
  poolContract: string;
  registryContract: string;
  transport: 'nym';
  operations: readonly SppDepositApprovedTx[];
  totalMaxFeeExposureStroops: string;
  preparedAt: string;
};

export type SppDepositSubmitIntent = {
  step: 1;
  role: 'sender';
  sourceAddress: string;
  poolContract: string;
  amountStroops: string;
  freshSequence: string;
  networkPassphrase: string;
  maxFeeStroops: string;
  transactionFingerprint: string;
  /** Must be deposit — any other op is rejected. */
  operation: 'deposit';
};

export type SppDepositAuthResult =
  | { ok: true; approved: SppDepositApprovedTx }
  | { ok: false; code: string; message: string };

let depositAuthorized = false;
let approvedPacket: SppDepositApprovalPacket | null = null;

export function isSppDepositBroadcastAuthorized(): boolean {
  return depositAuthorized;
}

export function setSppDepositBroadcastAuthorized(value: boolean): void {
  depositAuthorized = value === true;
}

export function rememberSppDepositApprovalPacket(
  packet: SppDepositApprovalPacket,
): SppDepositApprovalPacket {
  approvedPacket = packet;
  return packet;
}

export function getSppDepositApprovalPacket(): SppDepositApprovalPacket | null {
  return approvedPacket;
}

export function resetSppDepositAuthorizationForTests(): void {
  depositAuthorized = false;
  approvedPacket = null;
}

function mismatch(field: string, expected: string, actual: string): SppDepositAuthResult {
  return {
    ok: false,
    code: 'PACKET_MISMATCH',
    message: `${field} mismatch: approved=${expected} intent=${actual}`,
  };
}

/**
 * Validate a deposit submit intent against the remembered approval packet.
 * Requires deposit-scoped gate ON. Never consults the global mutator gate or
 * the registration-scoped gate.
 */
export function validateSppDepositSubmitIntent(
  intent: SppDepositSubmitIntent,
  packet: SppDepositApprovalPacket | null = approvedPacket,
): SppDepositAuthResult {
  if (!depositAuthorized) {
    return {
      ok: false,
      code: 'DEPOSIT_AWAITING_APPROVAL',
      message: 'Deposit-scoped broadcast gate is OFF — refusing deposit submit.',
    };
  }
  if (!packet) {
    return {
      ok: false,
      code: 'NO_APPROVAL_PACKET',
      message: 'No deposit approval packet remembered.',
    };
  }
  if (intent.operation !== 'deposit') {
    return {
      ok: false,
      code: 'OPERATION_NOT_DEPOSIT',
      message: `Refusing non-deposit operation under deposit gate: ${intent.operation}`,
    };
  }
  if (packet.network !== 'testnet') {
    return { ok: false, code: 'NETWORK', message: 'Deposit packet must be testnet' };
  }
  if (intent.networkPassphrase !== packet.networkPassphrase) {
    return mismatch('networkPassphrase', packet.networkPassphrase, intent.networkPassphrase);
  }
  if (intent.poolContract !== packet.poolContract) {
    return mismatch('poolContract', packet.poolContract, intent.poolContract);
  }

  const approved = packet.operations.find((op) => op.step === intent.step);
  if (!approved) {
    return { ok: false, code: 'UNKNOWN_STEP', message: `No approved deposit step ${intent.step}` };
  }
  if (approved.role !== intent.role) {
    return mismatch('role', approved.role, intent.role);
  }
  if (approved.sourceAddress !== intent.sourceAddress) {
    return mismatch('sourceAddress', approved.sourceAddress, intent.sourceAddress);
  }
  if (approved.poolContract !== intent.poolContract) {
    return mismatch('op.poolContract', approved.poolContract, intent.poolContract);
  }
  if (approved.amountStroops !== intent.amountStroops) {
    return mismatch('amountStroops', approved.amountStroops, intent.amountStroops);
  }

  try {
    assertFeeWithinCeiling('deposit', intent.maxFeeStroops);
  } catch (cause) {
    return {
      ok: false,
      code: 'FEE_CEILING',
      message: cause instanceof Error ? cause.message : 'Fee ceiling violated',
    };
  }
  if (approved.maxFeeStroops !== intent.maxFeeStroops) {
    return mismatch('maxFeeStroops', approved.maxFeeStroops, intent.maxFeeStroops);
  }
  if (approved.transactionFingerprint !== intent.transactionFingerprint) {
    return mismatch(
      'transactionFingerprint',
      approved.transactionFingerprint,
      intent.transactionFingerprint,
    );
  }
  if (intent.freshSequence !== approved.sequenceAtApproval) {
    return {
      ok: false,
      code: 'SEQUENCE_DRIFT',
      message: `Unexpected sequence for ${intent.sourceAddress}: expected=${approved.sequenceAtApproval} fresh=${intent.freshSequence}`,
    };
  }

  return { ok: true, approved };
}

export function assertSppDepositBroadcastAuthorized(intent: SppDepositSubmitIntent): void {
  const result = validateSppDepositSubmitIntent(intent);
  if (!result.ok) {
    throw new Error(`SPP_DEPOSIT_AWAITING_APPROVAL: ${result.code} — ${result.message}`);
  }
}
