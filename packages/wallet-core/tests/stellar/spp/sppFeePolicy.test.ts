import { describe, expect, it } from 'vitest';
import {
  SPP_PREVIOUS_MAX_FEE_STROOPS,
  SPP_PROPOSED_MAX_FEE_STROOPS,
  assertFeeWithinCeiling,
  feeComparisonRow,
  maxFeeStroopsForOperation,
  totalMaxFeeExposureStroops,
} from '../../../src/stellar/spp/sppFeePolicy.js';

describe('sppFeePolicy', () => {
  it('keeps register below the old packet and payments at 1.5 XLM', () => {
    expect(SPP_PROPOSED_MAX_FEE_STROOPS.register_public_keys).toBe(5_000_000);
    expect(SPP_PROPOSED_MAX_FEE_STROOPS.register_public_keys).toBeLessThan(
      SPP_PREVIOUS_MAX_FEE_STROOPS.register_public_keys,
    );
    expect(SPP_PROPOSED_MAX_FEE_STROOPS.deposit).toBe(15_000_000);
    expect(SPP_PROPOSED_MAX_FEE_STROOPS.transfer).toBe(15_000_000);
    expect(SPP_PROPOSED_MAX_FEE_STROOPS.withdraw).toBe(15_000_000);
    expect(maxFeeStroopsForOperation('transfer')).toBe('15000000');
  });

  it('accepts the Testnet deposit tx.fee and rejects a fee above 1.5 XLM', () => {
    expect(() => assertFeeWithinCeiling('deposit', '13418332')).not.toThrow();
    expect(() => assertFeeWithinCeiling('transfer', '15000000')).not.toThrow();
    expect(() => assertFeeWithinCeiling('withdraw', '15000001')).toThrow(/exceeds policy ceiling/);
  });

  it('computes total exposure for the planned E2E sequence', () => {
    const ops = [
      'register_public_keys',
      'register_public_keys',
      'deposit',
      'transfer',
      'withdraw',
    ] as const;
    expect(totalMaxFeeExposureStroops(ops)).toBe(5_000_000 + 5_000_000 + 15_000_000 + 15_000_000 + 15_000_000);
    expect(feeComparisonRow('register_public_keys').simulationStatus).toMatch(/partial/);
  });
});
