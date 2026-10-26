import { describe, expect, it, vi } from 'vitest';
import {
  parseHorizonPublicHalBody,
  probeStellarHorizon,
} from '../../../src/background/nym/StellarHorizonProbe.js';
import {
  STELLAR_LOGICAL_TESTNET_HORIZON_URL,
  STELLAR_NYM_EFFECTIVE_TESTNET_HORIZON_DEFAULT,
} from '../../../src/background/nym/stellarHorizonNymConfig.js';

describe('parseHorizonPublicHalBody', () => {
  it('accepts fee_stats HAL with last_ledger', () => {
    const r = parseHorizonPublicHalBody(
      JSON.stringify({ last_ledger: '9', last_ledger_base_fee: '100' }),
      { expectFeeStats: true },
    );
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(r.lastLedger).toBe('9');
      expect(r.lastLedgerBaseFee).toBe('100');
    }
  });

  it('flags empty body', () => {
    expect(parseHorizonPublicHalBody('').kind).toBe('empty');
  });

  it('parses Horizon problem+json errors', () => {
    const r = parseHorizonPublicHalBody(
      JSON.stringify({
        type: 'https://stellar.org/horizon-errors/not_found',
        title: 'Resource Missing',
        status: 404,
        detail: 'nope',
      }),
    );
    expect(r.kind).toBe('horizon_error');
    if (r.kind === 'horizon_error') {
      expect(r.detail).toBe('nope');
    }
  });
});

describe('probeStellarHorizon (mocked transport)', () => {
  it('success records logical vs effective URLs for SDF fee_stats', async () => {
    const fetchViaStellarTransport = vi.fn(async (url: string) => {
      expect(url).toBe(`${STELLAR_LOGICAL_TESTNET_HORIZON_URL}/fee_stats`);
      return new Response(
        JSON.stringify({
          last_ledger: '12345',
          last_ledger_base_fee: '100',
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/hal+json; charset=utf-8' },
        },
      );
    });
    const result = await probeStellarHorizon({
      fetchViaStellarTransport,
      transport: 'nym',
      nymConnected: true,
    });
    expect(result.state).toBe('success');
    expect(result.httpStatus).toBe(200);
    expect(result.lastLedger).toBe('12345');
    expect(result.lastLedgerBaseFee).toBe('100');
    expect(result.logicalUrl).toContain('horizon-testnet.stellar.org');
    expect(result.effectiveUrl).toBe(
      `${STELLAR_NYM_EFFECTIVE_TESTNET_HORIZON_DEFAULT}/fee_stats`,
    );
    expect(result.urlRewritten).toBe(true);
    expect(result.rewriteReason).toBeTruthy();
    expect(result.contentType).toContain('hal+json');
    expect(result.transportFetchInvoked).toBe(true);
  });

  it('surfaces HTTP problem details without clearnet retry', async () => {
    const fetchViaStellarTransport = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          type: 'https://stellar.org/horizon-errors/bad_request',
          title: 'Bad Request',
          detail: 'invalid',
          status: 400,
        }),
        { status: 400, headers: { 'content-type': 'application/problem+json' } },
      );
    });
    const result = await probeStellarHorizon({
      fetchViaStellarTransport,
      transport: 'nym',
      nymConnected: true,
    });
    expect(result.state).toBe('error');
    expect(result.horizonErrorDetail).toBe('invalid');
    expect(result.message).toMatch(/no clearnet fallback/);
  });

  it('rejects empty HAL body on HTTP 200', async () => {
    const fetchViaStellarTransport = vi.fn(
      async () =>
        new Response('', {
          status: 200,
          headers: { 'content-type': 'application/hal+json' },
        }),
    );
    const result = await probeStellarHorizon({
      fetchViaStellarTransport,
      transport: 'nym',
      nymConnected: true,
    });
    expect(result.state).toBe('error');
    expect(result.message).toMatch(/empty body/);
  });

  it('refuses when nym not connected', async () => {
    const fetchViaStellarTransport = vi.fn(async () => new Response('no'));
    const result = await probeStellarHorizon({
      fetchViaStellarTransport,
      transport: 'nym',
      nymConnected: false,
    });
    expect(fetchViaStellarTransport).not.toHaveBeenCalled();
    expect(result.state).toBe('error');
  });

  it('surfaces transport errors without clearnet retry', async () => {
    const fetchViaStellarTransport = vi.fn(async () => {
      throw new Error('mixnet drop');
    });
    const result = await probeStellarHorizon({
      fetchViaStellarTransport,
      transport: 'nym',
      nymConnected: true,
    });
    expect(result.state).toBe('error');
    expect(result.message).toMatch(/mixnet drop/);
    expect(result.message).toMatch(/no clearnet fallback/);
  });
});
