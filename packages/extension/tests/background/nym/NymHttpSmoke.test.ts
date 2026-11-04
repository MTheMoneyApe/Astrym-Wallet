/**
 * MixFetch HTTP smoke — mocked mixFetch only (no Mixnet / clearnet).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { runNymHttpSmoke } from '../../../src/background/nym/NymHttpSmoke.js';
import {
  NYM_HTTP_SMOKE_DEFAULT_URL,
  NYM_HTTP_SMOKE_PROBE_FIELD,
  extractEchoedProbeId,
  resolveNymHttpSmokeUrl,
  validateNymHttpSmokeUrl,
} from '../../../src/nym-offscreen/httpSmokeConfig.js';
import { MessageSchemas } from '../../../src/shared/ipcSchemas.js';

describe('httpSmokeConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('accepts default postman-echo https URL', () => {
    const r = validateNymHttpSmokeUrl(NYM_HTTP_SMOKE_DEFAULT_URL);
    expect(r.ok).toBe(true);
  });

  it('rejects an unapproved HTTPS host', () => {
    expect(validateNymHttpSmokeUrl('https://example.com/post').ok).toBe(false);
  });

  it('rejects HTTP', () => {
    expect(validateNymHttpSmokeUrl('http://example.com/post').ok).toBe(false);
  });

  it('rejects embedded URL credentials', () => {
    expect(
      validateNymHttpSmokeUrl('https://user:password@postman-echo.com/post').ok,
    ).toBe(false);
  });

  it('rejects an unapproved per-call override without falling back to the default', () => {
    const url = resolveNymHttpSmokeUrl('https://example.com/post');
    expect(url).toBe('https://example.com/post');
    expect(validateNymHttpSmokeUrl(url).ok).toBe(false);
  });

  it('rejects an unapproved environment override', () => {
    vi.stubEnv('VITE_NYM_HTTP_SMOKE_URL', 'https://example.com/post');
    const url = resolveNymHttpSmokeUrl();
    expect(url).toBe('https://example.com/post');
    expect(validateNymHttpSmokeUrl(url).ok).toBe(false);
  });

  it('extracts probe from postman-echo shaped JSON', () => {
    expect(
      extractEchoedProbeId({
        json: { [NYM_HTTP_SMOKE_PROBE_FIELD]: 'abc' },
        data: { [NYM_HTTP_SMOKE_PROBE_FIELD]: 'abc' },
      }),
    ).toBe('abc');
  });
});

describe('runNymHttpSmoke (mocked mixFetch)', () => {
  const probeId = 'solanym-test-probe-001';

  it('refuses an unapproved override without invoking MixFetch', async () => {
    const mixFetch = vi.fn(async () => new Response('unexpected'));
    const result = await runNymHttpSmoke({
      connected: true,
      mixFetch,
      randomId: () => probeId,
      request: { url: 'https://example.com/post' },
    });

    expect(result.state).toBe('error');
    expect(result.mixFetchInvoked).toBe(false);
    expect(result.message).toMatch(/not an approved destination/i);
    expect(mixFetch).not.toHaveBeenCalled();
  });

  it('requires a readiness token and accepts typed stale-readiness results with a fresh snapshot', () => {
    const schema = MessageSchemas.NYM_HTTP_SMOKE;
    expect(schema.request.safeParse({}).success).toBe(false);
    expect(
      schema.request.safeParse({
        readinessToken: { controllerEpoch: 'worker-a', readinessRevision: 3 },
      }).success,
    ).toBe(true);

    expect(
      schema.response.safeParse({
        state: 'error',
        code: 'STALE_READINESS',
        url: NYM_HTTP_SMOKE_DEFAULT_URL,
        probeId: '',
        durationMs: 0,
        httpStatus: null,
        httpOk: null,
        probeMatched: false,
        echoedProbeId: null,
        message: 'MixFetch readiness changed',
        mixFetchInvoked: false,
        snapshot: {
          state: 'disconnected',
          lastError: null,
          connected: false,
          implementation: 'mix-fetch-offscreen',
          mode: 'nym',
          documentReady: true,
          readinessToken: { controllerEpoch: 'worker-b', readinessRevision: 4 },
        },
      }).success,
    ).toBe(true);
  });

  it('success when echo matches via mixFetch', async () => {
    const mixFetch = vi.fn(async (_url: string, init?: RequestInit & { mode?: string }) => {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
      expect(body[NYM_HTTP_SMOKE_PROBE_FIELD]).toBe(probeId);
      expect(init?.mode).toBe('unsafe-ignore-cors');
      return new Response(
        JSON.stringify({
          json: { [NYM_HTTP_SMOKE_PROBE_FIELD]: probeId },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const result = await runNymHttpSmoke({
      connected: true,
      mixFetch,
      randomId: () => probeId,
      now: (() => {
        let t = 1000;
        return () => {
          t += 25;
          return t;
        };
      })(),
    });

    expect(mixFetch).toHaveBeenCalledOnce();
    expect(mixFetch.mock.calls[0]?.[0]).toBe(NYM_HTTP_SMOKE_DEFAULT_URL);
    expect(result.state).toBe('success');
    expect(result.probeMatched).toBe(true);
    expect(result.httpStatus).toBe(200);
    expect(result.mixFetchInvoked).toBe(true);
    expect(result.durationMs).toBeGreaterThan(0);
  });

  it('does not claim to block redirects reported by MixFetch', async () => {
    const redirectedResponse = new Response(
      JSON.stringify({
        json: { [NYM_HTTP_SMOKE_PROBE_FIELD]: probeId },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
    Object.defineProperties(redirectedResponse, {
      redirected: { value: true },
      url: { value: 'https://unapproved.example/redirected' },
    });
    const mixFetch = vi.fn(async () => redirectedResponse);

    const result = await runNymHttpSmoke({
      connected: true,
      mixFetch,
      randomId: () => probeId,
    });

    expect(mixFetch.mock.calls[0]?.[0]).toBe(NYM_HTTP_SMOKE_DEFAULT_URL);
    expect(result.state).toBe('success');
  });

  it('error on HTTP non-2xx', async () => {
    const mixFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: 'nope' }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        }),
    );

    const result = await runNymHttpSmoke({
      connected: true,
      mixFetch,
      randomId: () => probeId,
    });

    expect(result.state).toBe('error');
    expect(result.httpStatus).toBe(503);
    expect(result.probeMatched).toBe(false);
    expect(result.mixFetchInvoked).toBe(true);
    expect(result.message).toMatch(/HTTP 503/);
  });

  it('error on mixFetch network exception', async () => {
    const mixFetch = vi.fn(async () => {
      throw new Error('mixnet drop');
    });

    const result = await runNymHttpSmoke({
      connected: true,
      mixFetch,
      randomId: () => probeId,
    });

    expect(result.state).toBe('error');
    expect(result.httpStatus).toBe(null);
    expect(result.mixFetchInvoked).toBe(true);
    expect(result.message).toBe('mixnet drop');
  });

  it('timeout when mixFetch never settles', async () => {
    const mixFetch = vi.fn(
      () =>
        new Promise<Response>(() => {
          /* never resolves */
        }),
    );

    const result = await runNymHttpSmoke({
      connected: true,
      mixFetch,
      randomId: () => probeId,
      request: { timeoutMs: 30 },
      now: (() => {
        let t = 0;
        return () => {
          const v = t;
          t += 40;
          return v;
        };
      })(),
    });

    expect(result.state).toBe('timeout');
    expect(result.mixFetchInvoked).toBe(true);
    expect(result.message).toMatch(/timed out/i);
  });

  it('refuses when not connected without calling mixFetch', async () => {
    const mixFetch = vi.fn(async () => new Response('nope'));
    const result = await runNymHttpSmoke({
      connected: false,
      mixFetch,
      randomId: () => probeId,
    });
    expect(mixFetch).not.toHaveBeenCalled();
    expect(result.state).toBe('error');
    expect(result.mixFetchInvoked).toBe(false);
    expect(result.message).toMatch(/MixFetch not Ready/i);
  });

  it('error when JSON lacks echo field (unsupported format)', async () => {
    const mixFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const result = await runNymHttpSmoke({
      connected: true,
      mixFetch,
      randomId: () => probeId,
    });
    expect(result.state).toBe('error');
    expect(result.httpOk).toBe(true);
    expect(result.probeMatched).toBe(false);
    expect(result.message).toMatch(/missing|format/i);
  });
});
