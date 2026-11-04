/**
 * Centralized Testnet SPP fee ceilings (stroops).
 *
 * Honest basis (2026-11-04 fee-sim evidence under
 * `/opt/cursor/artifacts/preflight/fee-sim/fee-simulation-evidence.json`):
 * - stellar-private-payments@0.2.1 public surface has NO simulate / dryRun /
 *   estimateFee / buildTx / maxFee API. `PrivatePool.estimate(amount)` returns
 *   only `{ txCount }` (spend planning), not fees.
 * - Successful unsigned READ sims (resource fee ≈ assembled resourceFee):
 *   registry `get_verifier` ≈ 6426; `get_kdf_domain` ≈ 6380;
 *   pool reads (`get_admin`, `get_fee`, `deposits_paused`, …) ≈ 6431–6851;
 *   pool `get_asp_non_membership_root` outlier ≈ 4.21M (documented, not success
 *   for deposit/transfer/withdraw).
 * - Registry `register` with dummy proof reaches host but fails crypto verify —
 *   no usable minResourceFee for a successful register (not claimed as success).
 * - Pool deposit/transfer/withdraw require Groth16 proofs + auth; cannot be
 *   honestly simulated without broadcasting / real prover output.
 * - Live Soroban inclusion ≈ 100–200; recent invoke fee_charged samples
 *   ≈ 3k–668k (p90 ≈ 80–96k); Horizon max_fee.p90 ≈ 1.0M, max_fee.p95 ≈ 10M.
 * - Pool protocol `get_fee` = 1_000_000 stroops is an application fee, not gas.
 *
 * Ceilings are DEFENSIBLE CAPS for fail-closed enforcement, not pretended
 * successful mutator simulations. Numbers unchanged after fee-sim pass
 * (still no successful register/deposit/transfer/withdraw sims).
 */

export const SPP_FEE_POLICY_VERSION = '2026-11-04-preflight-v1' as const;

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
 * Proposed ceilings after preflight + fee-sim evidence (numbers unchanged).
 * register: defensive cap well above registry reads (~6.4k) and below prior 20M;
 *   real KeyOwnershipProof success fee unknown.
 * mutators: below prior 15M; above pool read outlier (~4.2M resource fee) with
 *   headroom for ZK verify + writes; NOT successful deposit/transfer/withdraw sims.
 */
export const SPP_PROPOSED_MAX_FEE_STROOPS: Record<SppFeeOperation, number> = {
  register_public_keys: 5_000_000,
  deposit: 8_000_000,
  transfer: 8_000_000,
  withdraw: 8_000_000,
};

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
  const simulationStatus =
    operation === 'register_public_keys'
      ? 'partial: unsigned register reached verify_sig_ed25519 with dummy proof (no success fee); registry reads minResourceFee≈6426; SDK has no dryRun/estimateFee'
      : 'blocked: PrivatePool.estimate is txCount-only; no dryRun; ZK proof + PrivatePool mutators cannot be simulated without real prover/broadcast';
  return {
    operation,
    previousMaxFeeStroops: previous,
    previousMaxFeeXlm: (previous / 10_000_000).toFixed(7),
    proposedMaxFeeStroops: proposed,
    proposedMaxFeeXlm: (proposed / 10_000_000).toFixed(7),
    simulationStatus,
  };
}
