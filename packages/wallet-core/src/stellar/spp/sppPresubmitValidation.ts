/**
 * Final pre-submit validation against an approved Testnet packet +
 * account-scoped sequence tracker.
 *
 * Supports multi-step runs: after step N confirms, expected sequence advances;
 * step N+1 must match the tracker, not the frozen packet sequence alone.
 * Does not broadcast.
 */

import { assertFeeWithinCeiling, type SppFeeOperation } from './sppFeePolicy.js';
import { isSppTestnetBroadcastAuthorized } from './sppBroadcastGate.js';
import {
  SppMultiAccountSequenceTracker,
  assertFreshSequenceMatchesExpected,
  beginSppAccountOperation,
  type SppAccountSequenceState,
} from './sppAccountSequenceTracker.js';

export type SppApprovedOperation = {
  step: number;
  operation: SppFeeOperation;
  amountStroops: string | null;
  senderAddress: string | null;
  recipientAddress: string | null;
  poolContract: string;
  maxFeeStroops: string;
  /**
   * Horizon sequence at packet freeze for the signing account of this step.
   * Used to seed the tracker; later steps rely on confirmed advances.
   */
  sequenceAtApproval: string | null;
};

export type SppApprovalPacketSnapshot = {
  networkPassphrase: string;
  poolContract: string;
  operations: readonly SppApprovedOperation[];
};

export type SppPresubmitIntent = {
  step: number;
  operation: SppFeeOperation;
  amountStroops: string | null;
  senderAddress: string | null;
  recipientAddress: string | null;
  poolContract: string;
  maxFeeStroops: string;
  /** Fresh Horizon sequence for the signing account. */
  freshSequence: string;
  networkPassphrase: string;
  /** Deterministic fingerprint of the authorized payment (same as execution guard). */
  fingerprint: string;
};

export type SppPresubmitValidationResult =
  | {
      ok: true;
      approved: SppApprovedOperation;
      signingAddress: string;
      sequenceState: SppAccountSequenceState;
    }
  | { ok: false; code: string; message: string };

function mismatch(field: string, expected: string, actual: string): SppPresubmitValidationResult {
  return {
    ok: false,
    code: 'PACKET_MISMATCH',
    message: `${field} mismatch: approved=${expected} intent=${actual}`,
  };
}

function signingAddressFor(op: SppApprovedOperation): string | null {
  // deposit/register/withdraw source is sender; transfer source is sender.
  return op.senderAddress ?? null;
}

/**
 * Seed tracker from packet initial sequences (call once when packet is approved).
 * Sender and recipient are independent.
 */
export function seedSequenceTrackerFromPacket(
  packet: SppApprovalPacketSnapshot,
  tracker: SppMultiAccountSequenceTracker,
): void {
  for (const op of packet.operations) {
    const addr = signingAddressFor(op);
    if (!addr || !op.sequenceAtApproval) continue;
    if (!tracker.get(addr)) {
      tracker.seed(addr, op.sequenceAtApproval);
    }
  }
}

/**
 * Structural + fee + sequence validation against an approved packet.
 * Does not require the broadcast gate — used to prepare / dry-check packets.
 * Does not mark success for on-chain submission; callers must still pass
 * {@link validateSppPresubmitIntent} (gate ON) before any broadcast.
 */
export function dryValidateSppPresubmitIntent(
  packet: SppApprovalPacketSnapshot,
  intent: SppPresubmitIntent,
  tracker: SppMultiAccountSequenceTracker,
): SppPresubmitValidationResult {
  if (intent.networkPassphrase !== packet.networkPassphrase) {
    return mismatch('networkPassphrase', packet.networkPassphrase, intent.networkPassphrase);
  }
  if (intent.poolContract !== packet.poolContract) {
    return mismatch('poolContract', packet.poolContract, intent.poolContract);
  }

  const approved = packet.operations.find((op) => op.step === intent.step);
  if (!approved) {
    return {
      ok: false,
      code: 'UNKNOWN_STEP',
      message: `No approved operation for step ${intent.step}`,
    };
  }

  if (approved.operation !== intent.operation) {
    return mismatch('operation', approved.operation, intent.operation);
  }
  if (approved.poolContract !== intent.poolContract) {
    return mismatch('op.poolContract', approved.poolContract, intent.poolContract);
  }
  if ((approved.amountStroops ?? null) !== (intent.amountStroops ?? null)) {
    return mismatch(
      'amountStroops',
      approved.amountStroops ?? 'null',
      intent.amountStroops ?? 'null',
    );
  }
  if ((approved.senderAddress ?? null) !== (intent.senderAddress ?? null)) {
    return mismatch(
      'senderAddress',
      approved.senderAddress ?? 'null',
      intent.senderAddress ?? 'null',
    );
  }
  if ((approved.recipientAddress ?? null) !== (intent.recipientAddress ?? null)) {
    return mismatch(
      'recipientAddress',
      approved.recipientAddress ?? 'null',
      intent.recipientAddress ?? 'null',
    );
  }
  if (approved.maxFeeStroops !== intent.maxFeeStroops) {
    return mismatch('maxFeeStroops', approved.maxFeeStroops, intent.maxFeeStroops);
  }

  try {
    assertFeeWithinCeiling(intent.operation, intent.maxFeeStroops);
  } catch (cause) {
    return {
      ok: false,
      code: 'FEE_CEILING',
      message: cause instanceof Error ? cause.message : 'Fee ceiling violated',
    };
  }

  if (!/^[0-9]+$/.test(intent.freshSequence)) {
    return {
      ok: false,
      code: 'INVALID_SEQUENCE',
      message: 'freshSequence must be a non-negative integer string',
    };
  }

  const signingAddress = intent.senderAddress;
  if (!signingAddress) {
    return {
      ok: false,
      code: 'INVALID_REQUEST',
      message: 'Signing account (senderAddress) required for sequence tracking',
    };
  }

  let state = tracker.get(signingAddress);
  if (!state) {
    if (!approved.sequenceAtApproval) {
      return {
        ok: false,
        code: 'SEQUENCE_UNSEEDED',
        message: `No sequence tracker seed for ${signingAddress}`,
      };
    }
    state = tracker.seed(signingAddress, approved.sequenceAtApproval);
  }

  const seqCheck = assertFreshSequenceMatchesExpected(state, intent.freshSequence);
  if (!seqCheck.ok) return seqCheck;

  const begin = beginSppAccountOperation(seqCheck.state, intent.fingerprint);
  if (!begin.ok) return begin;
  tracker.replace(begin.state);

  return {
    ok: true,
    approved,
    signingAddress,
    sequenceState: begin.state,
  };
}

/**
 * Validate an intent against the approved packet + live sequence tracker.
 * Requires broadcast gate ON — fail-closed when unauthorized.
 */
export function validateSppPresubmitIntent(
  packet: SppApprovalPacketSnapshot,
  intent: SppPresubmitIntent,
  tracker: SppMultiAccountSequenceTracker,
): SppPresubmitValidationResult {
  if (!isSppTestnetBroadcastAuthorized()) {
    return {
      ok: false,
      code: 'BROADCAST_AWAITING_APPROVAL',
      message: 'Broadcast gate is OFF — refusing pre-submit validation success path.',
    };
  }
  return dryValidateSppPresubmitIntent(packet, intent, tracker);
}
