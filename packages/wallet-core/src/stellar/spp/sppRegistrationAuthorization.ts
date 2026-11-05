/**
 * Operation-scoped authorization for Testnet `register_public_keys` only.
 *
 * Independent of {@link isSppTestnetBroadcastAuthorized} (global deposit/transfer/
 * withdraw gate). Approving registration must never authorize mutators.
 *
 * Default OFF. Authorizes only the exact approved accounts, sequences,
 * registry, network, fee ceilings, and transaction fingerprints.
 */

import { assertFeeWithinCeiling } from './sppFeePolicy.js';

export const SPP_REGISTRATION_AUTH_VERSION = '2026-11-04-register-v1' as const;

export type SppRegistrationApprovedTx = {
  step: 1 | 2;
  role: 'sender' | 'recipient';
  sourceAddress: string;
  /** Horizon sequence at packet freeze (account.sequence before this submit). */
  sequenceAtApproval: string;
  /** Public key registry contract C… */
  registryContract: string;
  networkPassphrase: string;
  maxFeeStroops: string;
  /**
   * Fingerprint of approved unsigned/prepared transaction contents
   * (e.g. sha256 of simulate XDR or envelope hash hex). Required for submit.
   */
  transactionFingerprint: string;
};

export type SppRegistrationApprovalPacket = {
  version: typeof SPP_REGISTRATION_AUTH_VERSION;
  network: 'testnet';
  networkPassphrase: string;
  kdf_domain: 'Nethermind';
  poolContract: string;
  registryContract: string;
  transport: 'nym';
  operations: readonly SppRegistrationApprovedTx[];
  totalMaxFeeExposureStroops: string;
  preparedAt: string;
};

export type SppRegistrationSubmitIntent = {
  step: 1 | 2;
  role: 'sender' | 'recipient';
  sourceAddress: string;
  freshSequence: string;
  registryContract: string;
  networkPassphrase: string;
  maxFeeStroops: string;
  transactionFingerprint: string;
  /** Must be register_public_keys — any other op is rejected. */
  operation: 'register_public_keys';
};

export type SppRegistrationAuthResult =
  | { ok: true; approved: SppRegistrationApprovedTx }
  | { ok: false; code: string; message: string };

/** Process-local registration authorization (independent of global broadcast gate). */
let registrationAuthorized = false;
let approvedPacket: SppRegistrationApprovalPacket | null = null;

export function isSppRegistrationBroadcastAuthorized(): boolean {
  return registrationAuthorized;
}

export function setSppRegistrationBroadcastAuthorized(value: boolean): void {
  registrationAuthorized = value === true;
}

export function rememberSppRegistrationApprovalPacket(
  packet: SppRegistrationApprovalPacket,
): SppRegistrationApprovalPacket {
  approvedPacket = packet;
  return packet;
}

export function getSppRegistrationApprovalPacket(): SppRegistrationApprovalPacket | null {
  return approvedPacket;
}

export function resetSppRegistrationAuthorizationForTests(): void {
  registrationAuthorized = false;
  approvedPacket = null;
}

function mismatch(field: string, expected: string, actual: string): SppRegistrationAuthResult {
  return {
    ok: false,
    code: 'PACKET_MISMATCH',
    message: `${field} mismatch: approved=${expected} intent=${actual}`,
  };
}

/**
 * Validate a registration submit intent against the remembered approval packet.
 * Requires registration-scoped gate ON. Never consults the global mutator gate.
 */
export function validateSppRegistrationSubmitIntent(
  intent: SppRegistrationSubmitIntent,
  packet: SppRegistrationApprovalPacket | null = approvedPacket,
): SppRegistrationAuthResult {
  if (!registrationAuthorized) {
    return {
      ok: false,
      code: 'REGISTRATION_AWAITING_APPROVAL',
      message:
        'Registration-scoped broadcast gate is OFF — refusing register_public_keys submit.',
    };
  }
  if (!packet) {
    return {
      ok: false,
      code: 'NO_APPROVAL_PACKET',
      message: 'No registration approval packet remembered.',
    };
  }
  if (intent.operation !== 'register_public_keys') {
    return {
      ok: false,
      code: 'OPERATION_NOT_REGISTRATION',
      message: `Refusing non-registration operation under registration gate: ${intent.operation}`,
    };
  }
  if (packet.network !== 'testnet') {
    return { ok: false, code: 'NETWORK', message: 'Registration packet must be testnet' };
  }
  if (intent.networkPassphrase !== packet.networkPassphrase) {
    return mismatch('networkPassphrase', packet.networkPassphrase, intent.networkPassphrase);
  }
  if (intent.registryContract !== packet.registryContract) {
    return mismatch('registryContract', packet.registryContract, intent.registryContract);
  }

  const approved = packet.operations.find((op) => op.step === intent.step);
  if (!approved) {
    return { ok: false, code: 'UNKNOWN_STEP', message: `No approved registration step ${intent.step}` };
  }
  if (approved.role !== intent.role) {
    return mismatch('role', approved.role, intent.role);
  }
  if (approved.sourceAddress !== intent.sourceAddress) {
    return mismatch('sourceAddress', approved.sourceAddress, intent.sourceAddress);
  }
  if (approved.registryContract !== intent.registryContract) {
    return mismatch('op.registryContract', approved.registryContract, intent.registryContract);
  }
  // Policy fee ceiling before packet field equality — excess fees must not be
  // reported as a mere packet mismatch.
  try {
    assertFeeWithinCeiling('register_public_keys', intent.maxFeeStroops);
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

/**
 * Fail-closed assert before any registerPublicKeys broadcast.
 * Does NOT flip or consult the global mutator broadcast gate.
 */
export function assertSppRegistrationBroadcastAuthorized(
  intent: SppRegistrationSubmitIntent,
): void {
  const result = validateSppRegistrationSubmitIntent(intent);
  if (!result.ok) {
    throw new Error(`SPP_REGISTRATION_AWAITING_APPROVAL: ${result.code} — ${result.message}`);
  }
}

/**
 * Resolve the approved registration step for a source address and validate intent.
 */
export function assertSppRegistrationAuthorizedForAddress(input: {
  sourceAddress: string;
  freshSequence: string;
  registryContract: string;
  networkPassphrase: string;
  maxFeeStroops: string;
  transactionFingerprint: string;
}): SppRegistrationApprovedTx {
  if (!registrationAuthorized || !approvedPacket) {
    throw new Error(
      'SPP_REGISTRATION_AWAITING_APPROVAL: registration-scoped gate OFF or no packet remembered',
    );
  }
  const approved = approvedPacket.operations.find(
    (op) => op.sourceAddress === input.sourceAddress,
  );
  if (!approved) {
    throw new Error(
      `SPP_REGISTRATION_AWAITING_APPROVAL: address ${input.sourceAddress} not in approval packet`,
    );
  }
  const intent: SppRegistrationSubmitIntent = {
    step: approved.step,
    role: approved.role,
    sourceAddress: input.sourceAddress,
    freshSequence: input.freshSequence,
    registryContract: input.registryContract,
    networkPassphrase: input.networkPassphrase,
    maxFeeStroops: input.maxFeeStroops,
    transactionFingerprint: input.transactionFingerprint,
    operation: 'register_public_keys',
  };
  assertSppRegistrationBroadcastAuthorized(intent);
  return approved;
}
