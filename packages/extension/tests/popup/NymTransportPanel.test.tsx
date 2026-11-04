import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { NymTransportPanel } from '../../src/popup/NymTransportPanel.js';

const baseSnapshot = {
  state: 'disconnected' as const,
  lastError: null,
  connected: false,
  implementation: 'mix-fetch-offscreen',
  mode: 'direct' as const,
  preferredMode: null,
  preferenceLoaded: true,
  preferenceError: null,
  documentReady: false,
  readinessToken: { controllerEpoch: 'test-worker', readinessRevision: 1 },
};

describe('NymTransportPanel', () => {
  it('shows disconnected / not ready without claiming connection', () => {
    const markup = renderToStaticMarkup(
      React.createElement(NymTransportPanel, {
        snapshot: {
          state: 'disconnected',
          lastError: null,
          connected: false,
          implementation: 'mix-fetch-offscreen',
          mode: 'direct',
          documentReady: false,
        },
      }),
    );
    expect(markup).toContain('data-testid="nym-transport-panel"');
    expect(markup).toContain('data-nym-connected="false"');
    expect(markup).toContain('data-nym-impl="mix-fetch-offscreen"');
    expect(markup).not.toContain('data-nym-connected="true"');
    expect(markup).toMatch(/Disconnected|desconectado/i);
  });

  it('Ready only when connected, state=connected, and readiness token is present', () => {
    const markup = renderToStaticMarkup(
      React.createElement(NymTransportPanel, {
        snapshot: {
          state: 'connected',
          lastError: null,
          connected: true,
          implementation: 'mix-fetch-offscreen',
          mode: 'nym',
          documentReady: true,
          readinessToken: { controllerEpoch: 'test-worker', readinessRevision: 1 },
        },
        readinessCurrent: true,
      }),
    );
    expect(markup).toContain('data-nym-connected="true"');
    expect(markup).toContain('data-nym-mixfetch-ready="true"');
    expect(markup).toMatch(/Ready \(Mixnet\)/);
  });

  it('does not show MixFetch Ready for an unversioned connected snapshot', () => {
    const markup = renderToStaticMarkup(
      React.createElement(NymTransportPanel, {
        snapshot: {
          state: 'connected',
          lastError: null,
          connected: true,
          implementation: 'mix-fetch-offscreen',
          mode: 'nym',
          documentReady: true,
        },
      }),
    );
    expect(markup).toContain('data-nym-connected="true"');
    expect(markup).toContain('data-nym-mixfetch-ready="false"');
  });

  it('does not show MixFetch Ready when readinessCurrent is omitted', () => {
    const markup = renderToStaticMarkup(
      React.createElement(NymTransportPanel, {
        snapshot: {
          state: 'connected',
          lastError: null,
          connected: true,
          implementation: 'mix-fetch-offscreen',
          mode: 'nym',
          documentReady: true,
          readinessToken: { controllerEpoch: 'test-worker', readinessRevision: 1 },
        },
      }),
    );
    expect(markup).toContain('data-nym-mixfetch-ready="false"');
    expect(markup).not.toContain('Ready (Mixnet)');
  });

  it('documentReady alone is not Ready', () => {
    const markup = renderToStaticMarkup(
      React.createElement(NymTransportPanel, {
        snapshot: {
          state: 'connecting',
          lastError: null,
          connected: false,
          implementation: 'mix-fetch-offscreen',
          mode: 'nym',
          documentReady: true,
        },
      }),
    );
    expect(markup).toContain('data-nym-document-ready="true"');
    expect(markup).toContain('data-nym-connected="false"');
    expect(markup).not.toMatch(/Ready \(Mixnet\)/);
  });

  it('shows Nym preference independently from a disconnected Mixnet connection', () => {
    const markup = renderToStaticMarkup(
      React.createElement(NymTransportPanel, {
        snapshot: {
          ...baseSnapshot,
          preferredMode: 'nym',
          mode: 'nym',
        },
        onConnect: () => undefined,
        onDisconnect: () => undefined,
      }),
    );

    expect(markup).toContain('data-nym-preferred-mode="nym"');
    expect(markup).toContain('data-nym-connected="false"');
    expect(markup).toContain('Transporte preferido: Nym');
    expect(markup).toContain('Modo del router: nym');
    expect(markup).toContain('Protected Stellar Horizon/Friendbot requests stay blocked');
  });

  it('shows Nym preference and Mixnet readiness as separate states when connected', () => {
    const markup = renderToStaticMarkup(
      React.createElement(NymTransportPanel, {
        snapshot: {
          ...baseSnapshot,
          state: 'connected',
          connected: true,
          mode: 'nym',
          preferredMode: 'nym',
          documentReady: true,
          readinessToken: { controllerEpoch: 'test-worker', readinessRevision: 1 },
        },
        readinessCurrent: true,
      }),
    );

    expect(markup).toContain('Transporte preferido: Nym');
    expect(markup).toContain('Ready (Mixnet)');
    expect(markup).toContain('Modo del router: nym');
  });

  it('keeps preferred Direct distinct from a historically connected Nym router', () => {
    const markup = renderToStaticMarkup(
      React.createElement(NymTransportPanel, {
        snapshot: {
          ...baseSnapshot,
          state: 'connected',
          connected: true,
          mode: 'nym',
          preferredMode: 'direct',
          documentReady: true,
          readinessToken: { controllerEpoch: 'test-worker', readinessRevision: 1 },
        },
        readinessCurrent: true,
      }),
    );

    expect(markup).toContain('data-nym-preferred-mode="direct"');
    expect(markup).toContain('Transporte preferido: Direct');
    expect(markup).toContain('Modo del router: nym');
    expect(markup).toContain('Ready (Mixnet)');
  });

  it('does not infer preferred Nym from the applied router mode', () => {
    const markup = renderToStaticMarkup(
      React.createElement(NymTransportPanel, {
        snapshot: { ...baseSnapshot, mode: 'nym' },
      }),
    );

    expect(markup).toContain('data-nym-preferred-mode="unselected"');
    expect(markup).toContain('Transporte preferido: No seleccionado');
    expect(markup).toContain('Modo del router: nym');
  });

  it('renders only the sanitized preference error code and explanation', () => {
    const markup = renderToStaticMarkup(
      React.createElement(NymTransportPanel, {
        snapshot: {
          ...baseSnapshot,
          preferredMode: 'nym',
          preferenceError: 'STORAGE_WRITE_FAILED',
        },
      }),
    );

    expect(markup).toContain('data-preference-error="STORAGE_WRITE_FAILED"');
    expect(markup).toContain('Could not save the transport preference. Please retry.');
    expect(markup).not.toContain('raw exception');
  });

  it('keeps network controls disabled until a preference is confirmed while exposing explicit choices', () => {
    const markup = renderToStaticMarkup(
      React.createElement(NymTransportPanel, {
        snapshot: {
          ...baseSnapshot,
          preferenceLoaded: false,
          preferenceError: 'STORAGE_READ_FAILED',
        },
        onConnect: () => undefined,
        onSetMode: () => undefined,
        onHttpSmoke: () => undefined,
        onPublicDataFetch: () => undefined,
        onStellarHorizonProbe: () => undefined,
      }),
    );

    expect(markup).toContain('data-testid="nym-mode-nym"');
    expect(markup).toContain('data-testid="nym-mode-direct"');
    expect(markup).toMatch(/<button(?=[^>]*data-testid="nym-connect")(?=[^>]*disabled="")[^>]*>/);
    expect(markup).toMatch(/<button(?=[^>]*data-testid="nym-http-smoke")(?=[^>]*disabled="")[^>]*>/);
    expect(markup).toMatch(/<button(?=[^>]*data-testid="nym-public-data-fetch")(?=[^>]*disabled="")[^>]*>/);
    expect(markup).toMatch(/<button(?=[^>]*data-testid="nym-stellar-horizon-probe")(?=[^>]*disabled="")[^>]*>/);
  });

  it('keeps the selected Nym preference when diagnostics use a one-off Direct transport', () => {
    const markup = renderToStaticMarkup(
      React.createElement(NymTransportPanel, {
        snapshot: {
          ...baseSnapshot,
          mode: 'nym',
          preferredMode: 'nym',
        },
        onPublicDataFetch: () => undefined,
        publicDataResult: {
          state: 'success',
          transport: 'direct',
          url: 'https://example.test/echo',
          probeId: 'probe-1',
          durationMs: 1,
          httpStatus: 200,
          httpOk: true,
          probeMatched: true,
          echoedProbeId: 'probe-1',
          responsePreview: null,
          message: 'ok',
          transportFetchInvoked: true,
        },
      }),
    );

    expect(markup).toContain('data-nym-preferred-mode="nym"');
    expect(markup).toContain('Modo del router: nym');
    expect(markup).toContain('Public data: success — transporte: direct');
  });
});
