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

  it('computes total exposure for the planned E2E sequence', () => {
    const ops = [
      'register_public_keys',
      'register_public_keys',
      'deposit',
      'transfer',
      'withdraw',
    ] as const;
    expect(totalMaxFeeExposureStroops(ops)).toBe(5_000_000 + 5_000_000 + 8_000_000 + 8_000_000 + 8_000_000);
    expect(feeComparisonRow('register_public_keys').simulationStatus).toMatch(/partial/);
  });
});
