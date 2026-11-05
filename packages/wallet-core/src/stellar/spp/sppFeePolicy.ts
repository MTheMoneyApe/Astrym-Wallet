/**
 * Centralized Testnet SPP fee ceilings (stroops).
 *
 * Honest basis:
 * - 2026-11-04 fee-sim evidence (`/opt/cursor/artifacts/preflight/fee-sim/`).
 * - 2026-11-05 deposit prove+simulate: Groth16 deposit 2.0 XLM succeeded with
 *   minResourceFee ≈ 8_718_236 on Nethermind pool CAMWBUWH….
 * - Fee optimization + storage audit: ~99.6% is persistent rent (2 Nullifier
 *   creates + Merkle TreeState rewrite/TTL). No safe client-side change fits
 *   under the deposit ceiling without changing proof/fingerprint/security.
 * - Pool protocol `get_fee` = 1_000_000 is application fee, not gas.
 *
 * Ceilings are DEFENSIBLE CAPS. Deposit stays at 8_000_000 and is NOT raised
 * here — deposits whose measured resource fee exceeds the ceiling stay blocked.
 */

export const SPP_FEE_POLICY_VERSION = '2026-11-05-deposit-rent-audit-v1' as const;

/** Inclusion-fee market reference (Soroban getFeeStats; p95 historically ≤ 200). */
export const SPP_SOROBAN_INCLUSION_FEE_P95 = 200;

/** Observed successful unsigned registry read simulation resource fee. */
export const SPP_REGISTRY_READ_MIN_RESOURCE_FEE = 6426;

export type SppFeeOperation =
  | 'register_public_keys'
  | 'deposit'
  | 'transfer'
  | 'withdraw';

/** Previous (v3 packet) ceilings — for comparison only. */
export const SPP_PREVIOUS_MAX_FEE_STROOPS: Record<SppFeeOperation, number> = {
  register_public_keys: 20_000_000,
  deposit: 15_000_000,
  transfer: 15_000_000,
  withdraw: 15_000_000,
};

/**
 * Policy ceilings (numbers unchanged — do not raise without explicit human approval).
 * register: defensive cap well above registry reads (~6.4k) and below prior 20M.
 * deposit/transfer/withdraw: 8_000_000. Deposit is known to need ~8.72M resource
 * fee on current Nethermind Testnet pool semantics; enforcement blocks those
 * deposits rather than silently raising this constant.
 */
export const SPP_PROPOSED_MAX_FEE_STROOPS: Record<SppFeeOperation, number> = {
  register_public_keys: 5_000_000,
  deposit: 8_000_000,
  transfer: 8_000_000,
  withdraw: 8_000_000,
};

/**
 * Highest successful deposit simulate minResourceFee observed in fee-opt
 * (assembled re-sim). Used for fail-closed deposit policy checks. Not a new
 * ceiling — evidence that the existing 8M deposit cap cannot cover current rent.
 */
export const SPP_OBSERVED_DEPOSIT_MIN_RESOURCE_FEE_STROOPS = 8_718_236;

/** Fingerprint of the unsigned 2.0 XLM deposit XDR that produced the observation. */
export const SPP_OBSERVED_DEPOSIT_TX_FINGERPRINT =
  '8983d1dfee435b4a056915e61cc5a20cc75df6f43bda359a89df78e6432c3044';

export function maxFeeStroopsForOperation(operation: SppFeeOperation): string {
  return String(SPP_PROPOSED_MAX_FEE_STROOPS[operation]);
}

export function maxFeeXlmForOperation(operation: SppFeeOperation): string {
  return (SPP_PROPOSED_MAX_FEE_STROOPS[operation] / 10_000_000).toFixed(7);
}

export function totalMaxFeeExposureStroops(
  operations: readonly SppFeeOperation[],
): number {
  return operations.reduce((sum, op) => sum + SPP_PROPOSED_MAX_FEE_STROOPS[op], 0);
}

export function assertFeeWithinCeiling(
  operation: SppFeeOperation,
  proposedMaxFeeStroops: string | number | bigint,
): void {
  const proposed = BigInt(proposedMaxFeeStroops);
  const ceiling = BigInt(SPP_PROPOSED_MAX_FEE_STROOPS[operation]);
  if (proposed <= 0n) {
    throw new Error(`Fee ceiling must be positive for ${operation}`);
  }
  if (proposed > ceiling) {
    throw new Error(
      `maxFeeStroops ${proposed.toString()} exceeds policy ceiling ${ceiling.toString()} for ${operation} (${SPP_FEE_POLICY_VERSION})`,
    );
  }
}

/**
 * True when a required Soroban minResourceFee cannot fit under the operation
 * policy ceiling. For deposit, defaults to the observed successful-sim fee.
 */
export function requiredResourceFeeExceedsPolicy(
  operation: SppFeeOperation,
  requiredMinResourceFeeStroops:
    | string
    | number
    | bigint = SPP_OBSERVED_DEPOSIT_MIN_RESOURCE_FEE_STROOPS,
): boolean {
  const required = BigInt(requiredMinResourceFeeStroops);
  const ceiling = BigInt(SPP_PROPOSED_MAX_FEE_STROOPS[operation]);
  return required > ceiling;
}

/** Deposit-only: measured resource fee exceeds the unchanged 8M policy cap. */
export function depositResourceFeeExceedsPolicy(
  requiredMinResourceFeeStroops:
    | string
    | number
    | bigint = SPP_OBSERVED_DEPOSIT_MIN_RESOURCE_FEE_STROOPS,
): boolean {
  return requiredResourceFeeExceedsPolicy('deposit', requiredMinResourceFeeStroops);
}

export function depositFeePolicyUserMessage(): string {
  const required = SPP_OBSERVED_DEPOSIT_MIN_RESOURCE_FEE_STROOPS;
  const ceiling = SPP_PROPOSED_MAX_FEE_STROOPS.deposit;
  return (
    `Depósito bloqueado por la política de resource fee de Soroban ` +
    `(minResourceFee medido ${required} stroops > techo ${ceiling}). ` +
    `No es un fallo de conexión Nym ni de la wallet. ` +
    `El alquiler persistente del pool (nullifiers + Merkle TreeState) es requerido por el protocolo; ` +
    `el techo 8_000_000 no se ha subido.`
  );
}

export function assertDepositResourceFeeWithinPolicy(
  requiredMinResourceFeeStroops:
    | string
    | number
    | bigint = SPP_OBSERVED_DEPOSIT_MIN_RESOURCE_FEE_STROOPS,
): void {
  if (depositResourceFeeExceedsPolicy(requiredMinResourceFeeStroops)) {
    throw new Error(depositFeePolicyUserMessage());
  }
}

export function feeComparisonRow(operation: SppFeeOperation): {
  operation: SppFeeOperation;
  previousMaxFeeStroops: number;
  previousMaxFeeXlm: string;
  proposedMaxFeeStroops: number;
  proposedMaxFeeXlm: string;
  simulationStatus: string;
} {
  const previous = SPP_PREVIOUS_MAX_FEE_STROOPS[operation];
  const proposed = SPP_PROPOSED_MAX_FEE_STROOPS[operation];
  let simulationStatus: string;
  switch (operation) {
    case 'register_public_keys':
      simulationStatus =
        'partial: unsigned register reached verify; registry reads minResourceFee≈6426; success fees from ledger-confirmed registers ~1.32M';
      break;
    case 'deposit':
      simulationStatus =
        `succeeded_sim_exceeds_policy: Groth16 deposit minResourceFee≈${SPP_OBSERVED_DEPOSIT_MIN_RESOURCE_FEE_STROOPS} (rent-dominated); policy ceiling ${proposed} unchanged — deposits blocked`;
      break;
    case 'transfer':
    case 'withdraw':
      simulationStatus =
        'no_successful_mutator_sim_under_policy: same pool storage model likely rent-heavy; ceiling unchanged';
      break;
    default: {
      const unexpected: never = operation;
      simulationStatus = String(unexpected);
      break;
    }
  }
  return {
    operation,
    previousMaxFeeStroops: previous,
    previousMaxFeeXlm: (previous / 10_000_000).toFixed(7),
    proposedMaxFeeStroops: proposed,
    proposedMaxFeeXlm: (proposed / 10_000_000).toFixed(7),
    simulationStatus,
  };
}
