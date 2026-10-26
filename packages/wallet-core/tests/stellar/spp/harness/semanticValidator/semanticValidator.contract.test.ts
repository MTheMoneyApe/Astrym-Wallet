/**
 * Fase 2.21 — adversarial tests for the result contract.
 * Ensures legacy `verifiable_complete` cannot authorize alone.
 */
import { describe, expect, it } from 'vitest';
import {
  FIXTURE_ACCOUNT,
  FIXTURE_NETWORK,
  FIXTURE_POOL,
  FIXTURE_TOKEN,
  acceptAsFullProtocolSafety,
  acceptByLegacyStatusAlone,
  acceptSurfaceVerification,
  buildDepositEvidence,
  buildWithdrawEvidence,
  computeBindingId,
  legacyVerifiableCompleteMeaning,
  parseValidationResult,
  validateSemanticConcordance,
  type ExpectedSemanticIntent,
  type SemanticValidationResult,
} from './index.js';

function depositIntent(over: Partial<ExpectedSemanticIntent> = {}): ExpectedSemanticIntent {
  return {
    op: 'deposit',
    account: FIXTURE_ACCOUNT,
    networkPassphrase: FIXTURE_NETWORK,
    poolContractId: FIXTURE_POOL,
    tokenContractId: FIXTURE_TOKEN,
    amountUnits: '10000000',
    destination: { mode: 'none' },
    planTxCount: 1,
    ...over,
  };
}

function withdrawIntent(): ExpectedSemanticIntent {
  return {
    op: 'withdraw',
    account: FIXTURE_ACCOUNT,
    networkPassphrase: FIXTURE_NETWORK,
    poolContractId: FIXTURE_POOL,
    tokenContractId: FIXTURE_TOKEN,
    amountUnits: '5000000',
    destination: { mode: 'self' },
    planTxCount: 1,
  };
}

describe('2.21 contract — authoritative acceptance', () => {
  it('1. accepting solely by verifiable_complete is refused', () => {
    const evidence = buildDepositEvidence();
    const result = validateSemanticConcordance(depositIntent(), evidence);
    expect(result.status).toBe('verifiable_complete');

    // Anti-pattern consumer
    const byStatusAlone = acceptByLegacyStatusAlone(result.status);
    expect(byStatusAlone.ok).toBe(false);
    expect(byStatusAlone.reason).toMatch(/legacy status alone|not authoritative/i);

    // Correct path
    const accepted = acceptSurfaceVerification(result, depositIntent(), evidence);
    expect(accepted.ok).toBe(true);
    if (accepted.ok) {
      expect(accepted.authorizesSigning).toBe(false);
      expect(accepted.fullProtocolSafety).toBe(false);
    }
  });

  it('2. result without classification rejected', () => {
    const evidence = buildDepositEvidence();
    const result = validateSemanticConcordance(depositIntent(), evidence);
    const { classification: _c, ...rest } = result;
    const parsed = parseValidationResult(rest);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toMatch(/missing authoritative classification/i);
    expect(acceptSurfaceVerification(rest, depositIntent(), evidence).ok).toBe(false);
  });

  it('3. missing or wrong safetyClaim rejected', () => {
    const evidence = buildDepositEvidence();
    const result = validateSemanticConcordance(depositIntent(), evidence);
    const missing = { ...result, safetyClaim: undefined };
    expect(parseValidationResult(missing).ok).toBe(false);

    const wrong = { ...result, safetyClaim: 'fully_secure' };
    const p = parseValidationResult(wrong);
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.reason).toMatch(/safetyClaim/i);
  });

  it('4. partial / forged classification presented as complete rejected', () => {
    const evidence = buildDepositEvidence();
    const result = validateSemanticConcordance(depositIntent(), evidence);
    const forged = {
      ...result,
      classification: 'surface_verified_with_opaque_remainder',
      status: 'rejected', // inconsistent
    };
    expect(parseValidationResult(forged).ok).toBe(false);

    const emptyOpaque = {
      ...result,
      unverifiedFields: [],
    };
    expect(parseValidationResult(emptyOpaque).ok).toBe(false);
  });

  it('5. bindingId for another intent refused', () => {
    const evidence = buildDepositEvidence();
    const intentA = depositIntent();
    const result = validateSemanticConcordance(intentA, evidence);
    const intentB = depositIntent({ amountUnits: '1' });
    const accepted = acceptSurfaceVerification(result, intentB, evidence);
    expect(accepted.ok).toBe(false);
    if (!accepted.ok) expect(accepted.reason).toMatch(/bindingId|reuse|mix/i);
  });

  it('6. result mutated after validation fails freeze / acceptance', () => {
    const evidence = buildDepositEvidence();
    const result = validateSemanticConcordance(depositIntent(), evidence);
    expect(Object.isFrozen(result)).toBe(true);
    expect(() => {
      (result as { classification: string }).classification = 'rejected';
    }).toThrow();
    expect(() => {
      (result.verifiedFields as string[]).push('evil');
    }).toThrow();

    // Unfrozen clone with tampered classification after copy
    const tampered = {
      ...result,
      classification: 'rejected' as const,
      status: 'verifiable_complete' as const,
      unverifiedFields: [...result.unverifiedFields],
      verifiedFields: [...result.verifiedFields],
      rejectionReasons: [...result.rejectionReasons],
      fieldVerdicts: [...result.fieldVerdicts],
    };
    expect(parseValidationResult(tampered).ok).toBe(false);
  });

  it('7. rejection presented as success refused', () => {
    const evidence = buildDepositEvidence({ amount: 1n });
    const rejected = validateSemanticConcordance(depositIntent(), evidence);
    expect(rejected.classification).toBe('rejected');
    expect(acceptSurfaceVerification(rejected, depositIntent(), evidence).ok).toBe(false);

    // Forge a surface-looking object for the same failing intent+evidence pair.
    const disguised: SemanticValidationResult = {
      status: 'verifiable_complete',
      classification: 'surface_verified_with_opaque_remainder',
      safetyClaim: 'not_full_protocol_safety',
      summary: 'forged success',
      rejectionReasons: [],
      unverifiedFields: [{ field: 'proof', reason: 'opaque' }],
      verifiedFields: ['op'],
      fieldVerdicts: [
        { field: 'proof', status: 'unverified', reason: 'opaque' },
        { field: 'op', status: 'verified' },
      ],
      bindingId: computeBindingId(depositIntent(), evidence),
      extracted: rejected.extracted,
    };
    expect(parseValidationResult(disguised).ok).toBe(true);
    const forged = acceptSurfaceVerification(disguised, depositIntent(), evidence);
    expect(forged.ok).toBe(false);
    if (!forged.ok) expect(forged.reason).toMatch(/live re-validation|forged|stale/i);
  });

  it('8. unknown / malformed result objects rejected', () => {
    expect(parseValidationResult(null).ok).toBe(false);
    expect(parseValidationResult(undefined).ok).toBe(false);
    expect(parseValidationResult('verifiable_complete').ok).toBe(false);
    expect(parseValidationResult({ classification: 'totally_secure' }).ok).toBe(false);
    expect(
      parseValidationResult({
        classification: 'surface_verified_with_opaque_remainder',
        safetyClaim: 'not_full_protocol_safety',
        status: 'verifiable_complete',
        // missing bindingId
      }).ok,
    ).toBe(false);
  });

  it('9. deposit result cannot authorize withdraw intent (and vice versa)', () => {
    const depEv = buildDepositEvidence();
    const depIntent = depositIntent();
    const depResult = validateSemanticConcordance(depIntent, depEv);
    expect(acceptSurfaceVerification(depResult, depIntent, depEv).ok).toBe(true);
    expect(acceptSurfaceVerification(depResult, withdrawIntent(), depEv).ok).toBe(false);

    const wdEv = buildWithdrawEvidence();
    const wdIntent = withdrawIntent();
    const wdResult = validateSemanticConcordance(wdIntent, wdEv);
    expect(acceptSurfaceVerification(wdResult, wdIntent, wdEv).ok).toBe(true);
    expect(acceptSurfaceVerification(wdResult, depIntent, wdEv).ok).toBe(false);
  });

  it('10. prototype result is never full protocol safety', () => {
    const evidence = buildDepositEvidence();
    const result = validateSemanticConcordance(depositIntent(), evidence);
    expect(acceptAsFullProtocolSafety(result).ok).toBe(false);
    expect(legacyVerifiableCompleteMeaning()).toEqual({
      authoritative: false,
      aliasOf: 'surface_verified_with_opaque_remainder',
      authorizesSigning: false,
      fullProtocolSafety: false,
    });
    const accepted = acceptSurfaceVerification(result, depositIntent(), evidence);
    expect(accepted.ok).toBe(true);
    if (accepted.ok) {
      expect(accepted.fullProtocolSafety).toBe(false);
      expect(accepted.authorizesSigning).toBe(false);
    }
  });
});

describe('2.21 reject path still carries bindingId', () => {
  it('rejected results include bindingId and fail surface accept', () => {
    const evidence = buildDepositEvidence({ amount: 1n });
    const result = validateSemanticConcordance(depositIntent(), evidence);
    expect(result.classification).toBe('rejected');
    expect(result.bindingId).toMatch(/^[0-9a-f]{64}$/);
    expect(result.bindingId).toBe(computeBindingId(depositIntent(), evidence));
    expect(Object.isFrozen(result)).toBe(true);
    expect(acceptSurfaceVerification(result, depositIntent(), evidence).ok).toBe(false);
  });
});
