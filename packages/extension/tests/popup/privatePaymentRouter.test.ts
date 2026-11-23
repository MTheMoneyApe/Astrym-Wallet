import { describe, expect, it } from 'vitest';
import { routePrivatePayment } from '../../src/popup/privatePaymentRouter.js';

describe('routePrivatePayment', () => {
  const base = {
    nymConnected: true,
    nymMode: 'nym' as const,
    sppSelected: true,
    preparePhase: 'ready',
    operation: 'transfer' as const,
    hasDestination: true,
    hasAmount: true,
    authorized: false,
    inFlight: false,
    lastTxHash: null,
    lastErrorCode: null,
    lastErrorMessage: null,
  };

  it('blocks when Nym is off', () => {
    const route = routePrivatePayment({ ...base, nymConnected: false, nymMode: 'direct' });
    expect(route.status).toBe('idle');
    expect(route.canSubmit).toBe(false);
    expect(route.blockPublicFallback).toBe(true);
  });

  it('reports initializing until prepare is ready', () => {
    const route = routePrivatePayment({ ...base, preparePhase: 'probing_assets' });
    expect(route.status).toBe('initializing');
    expect(route.canAuthorize).toBe(false);
  });

  it('requires authorization before submit', () => {
    const route = routePrivatePayment(base);
    expect(route.status).toBe('awaiting_authorization');
    expect(route.canAuthorize).toBe(true);
    expect(route.canSubmit).toBe(false);
  });

  it('allows submit after authorization', () => {
    const route = routePrivatePayment({ ...base, authorized: true });
    expect(route.status).toBe('ready');
    expect(route.canSubmit).toBe(true);
  });

  it('never suggests public fallback on failure', () => {
    const route = routePrivatePayment({
      ...base,
      lastErrorCode: 'EXECUTION_FAILED',
      lastErrorMessage: 'pool failed',
    });
    expect(route.status).toBe('failed');
    expect(route.blockPublicFallback).toBe(true);
    expect(route.message).toBe('pool failed');
  });

  it('marks ambiguous outcomes as unknown', () => {
    const route = routePrivatePayment({
      ...base,
      lastErrorCode: 'unknown',
      lastErrorMessage: 'timeout',
    });
    expect(route.status).toBe('unknown');
    expect(route.canSubmit).toBe(false);
  });

  it('propagates SUBMISSION_UNKNOWN and multiple hashes as unknown', () => {
    const unknown = routePrivatePayment({
      ...base,
      lastErrorCode: 'SUBMISSION_UNKNOWN',
      lastErrorMessage: 'two hashes',
    });
    expect(unknown.status).toBe('unknown');
    expect(unknown.canAuthorize).toBe(false);
    expect(unknown.canSubmit).toBe(false);
    const multi = routePrivatePayment({
      ...base,
      lastErrorCode: 'EXECUTION_FAILED',
      lastTxHashes: ['hash-1', 'hash-2'],
    });
    expect(multi.status).toBe('unknown');
    expect(multi.canAuthorize).toBe(false);
  });

  it('keeps a returned hash submitted until ledger confirmation', () => {
    const submitted = routePrivatePayment({ ...base, lastTxHash: 'hash-1' });
    expect(submitted.status).toBe('submitted');
    expect(submitted.canAuthorize).toBe(false);
    expect(submitted.canSubmit).toBe(false);
    const confirmed = routePrivatePayment({
      ...base,
      lastTxHash: 'hash-1',
      ledgerConfirmation: 'confirmed',
    });
    expect(confirmed.status).toBe('confirmed');
    expect(confirmed.canAuthorize).toBe(false);
  });

  it('blocks submit when proving keys or contract config are missing', () => {
    expect(
      routePrivatePayment({ ...base, preparePhase: 'missing_proving_keys' }).status,
    ).toBe('failed');
    expect(
      routePrivatePayment({ ...base, preparePhase: 'missing_configuration' }).canSubmit,
    ).toBe(false);
  });
});
