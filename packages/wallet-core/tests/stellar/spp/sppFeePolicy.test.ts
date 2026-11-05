import { describe, expect, it } from 'vitest';
import {
  SPP_FEE_POLICY_VERSION,
  SPP_OBSERVED_DEPOSIT_MIN_RESOURCE_FEE_STROOPS,
  SPP_OBSERVED_DEPOSIT_TX_FINGERPRINT,
  SPP_PREVIOUS_MAX_FEE_STROOPS,
  SPP_PROPOSED_MAX_FEE_STROOPS,
  assertDepositResourceFeeWithinPolicy,
  assertFeeWithinCeiling,
  depositFeePolicyUserMessage,
  depositResourceFeeExceedsPolicy,
  feeComparisonRow,
  maxFeeStroopsForOperation,
  requiredResourceFeeExceedsPolicy,
  totalMaxFeeExposureStroops,
} from '../../../src/stellar/spp/sppFeePolicy.js';

describe('sppFeePolicy', () => {
  it('keeps deposit ceiling at 8M and does not raise it for observed rent', () => {
    expect(SPP_PROPOSED_MAX_FEE_STROOPS.deposit).toBe(8_000_000);
    expect(SPP_OBSERVED_DEPOSIT_MIN_RESOURCE_FEE_STROOPS).toBeGreaterThan(
      SPP_PROPOSED_MAX_FEE_STROOPS.deposit,
    );
    expect(SPP_OBSERVED_DEPOSIT_TX_FINGERPRINT).toHaveLength(64);
    expect(SPP_FEE_POLICY_VERSION).toMatch(/deposit-rent-audit/);
  });

  it('tightens ceilings vs previous packet defaults', () => {
    expect(SPP_PROPOSED_MAX_FEE_STROOPS.register_public_keys).toBeLessThan(
      SPP_PREVIOUS_MAX_FEE_STROOPS.register_public_keys,
    );
    expect(SPP_PROPOSED_MAX_FEE_STROOPS.deposit).toBeLessThan(
      SPP_PREVIOUS_MAX_FEE_STROOPS.deposit,
    );
    expect(maxFeeStroopsForOperation('transfer')).toBe('8000000');
  });

  it('rejects fees above the ceiling and accepts policy defaults', () => {
    expect(() => assertFeeWithinCeiling('deposit', '8000000')).not.toThrow();
    expect(() => assertFeeWithinCeiling('deposit', '15000000')).toThrow(/exceeds policy ceiling/);
  });

  it('flags observed deposit resource fee as exceeding policy without raising the cap', () => {
    expect(depositResourceFeeExceedsPolicy()).toBe(true);
    expect(requiredResourceFeeExceedsPolicy('deposit')).toBe(true);
    expect(requiredResourceFeeExceedsPolicy('deposit', 7_000_000)).toBe(false);
    expect(requiredResourceFeeExceedsPolicy('transfer', SPP_OBSERVED_DEPOSIT_MIN_RESOURCE_FEE_STROOPS)).toBe(
      true,
    );
    expect(() => assertDepositResourceFeeWithinPolicy()).toThrow(/resource fee/);
    expect(depositFeePolicyUserMessage()).toMatch(/No es un fallo de conexión Nym/);
    expect(depositFeePolicyUserMessage()).toMatch(/8_000_000 no se ha subido/);
  });

  it('computes total exposure for the planned E2E sequence', () => {
    const ops = [
      'register_public_keys',
      'register_public_keys',
      'deposit',
      'transfer',
      'withdraw',
    ] as const;
    expect(totalMaxFeeExposureStroops(ops)).toBe(5_000_000 + 5_000_000 + 8_000_000 + 8_000_000 + 8_000_000);
    expect(feeComparisonRow('deposit').simulationStatus).toMatch(/succeeded_sim_exceeds_policy/);
    expect(feeComparisonRow('deposit').proposedMaxFeeStroops).toBe(8_000_000);
  });
});
