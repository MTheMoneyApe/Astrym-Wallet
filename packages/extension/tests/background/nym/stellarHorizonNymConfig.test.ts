import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STELLAR_NYM_HORIZON_CONFIG,
  SDF_HORIZON_MIXFETCH_REWRITE_REASON,
  STELLAR_LOGICAL_TESTNET_HORIZON_URL,
  STELLAR_NYM_EFFECTIVE_TESTNET_HORIZON_DEFAULT,
  resolveHorizonUrlForNym,
  validateNymHorizonEffectiveBase,
  validateStellarNymHorizonConfig,
} from '../../../src/background/nym/stellarHorizonNymConfig.js';

describe('stellarHorizonNymConfig', () => {
  it('resolves SDF testnet logical URL onto documented Ankr effective base', () => {
    const r = resolveHorizonUrlForNym(
      `${STELLAR_LOGICAL_TESTNET_HORIZON_URL}/fee_stats`,
    );
    expect(r.rewritten).toBe(true);
    expect(r.logicalUrl).toContain('horizon-testnet.stellar.org');
    expect(r.effectiveUrl).toBe(
      `${STELLAR_NYM_EFFECTIVE_TESTNET_HORIZON_DEFAULT}/fee_stats`,
    );
    expect(r.reason).toBe(SDF_HORIZON_MIXFETCH_REWRITE_REASON);
  });

  it('does not rewrite when effective base is set back to SDF (explicit opt-in)', () => {
    const r = resolveHorizonUrlForNym(
      `${STELLAR_LOGICAL_TESTNET_HORIZON_URL}/fee_stats`,
      {
        ...DEFAULT_STELLAR_NYM_HORIZON_CONFIG,
        testnetEffectiveBase: STELLAR_LOGICAL_TESTNET_HORIZON_URL,
      },
    );
    expect(r.rewritten).toBe(false);
    expect(r.effectiveUrl).toBe(`${STELLAR_LOGICAL_TESTNET_HORIZON_URL}/fee_stats`);
  });

  it('rejects non-allowlisted effective bases', () => {
    const bad = validateNymHorizonEffectiveBase('https://evil.example/horizon');
    expect(bad.ok).toBe(false);
  });

  it('accepts allowlisted Ankr testnet base', () => {
    const ok = validateNymHorizonEffectiveBase(
      STELLAR_NYM_EFFECTIVE_TESTNET_HORIZON_DEFAULT,
    );
    expect(ok).toEqual({
      ok: true,
      base: STELLAR_NYM_EFFECTIVE_TESTNET_HORIZON_DEFAULT,
    });
  });

  it('validateStellarNymHorizonConfig merges and validates', () => {
    const r = validateStellarNymHorizonConfig({
      testnetEffectiveBase: STELLAR_LOGICAL_TESTNET_HORIZON_URL,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.config.testnetEffectiveBase).toBe(STELLAR_LOGICAL_TESTNET_HORIZON_URL);
      expect(r.config.mainnetEffectiveBase).toBe(
        DEFAULT_STELLAR_NYM_HORIZON_CONFIG.mainnetEffectiveBase,
      );
    }
  });
});
