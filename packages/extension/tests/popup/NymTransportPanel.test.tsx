import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { NymTransportPanel } from '../../src/popup/NymTransportPanel.js';

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

  it('Ready only when connected=true and state=connected', () => {
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
    expect(markup).toMatch(/Ready \(Mixnet\)/);
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

  it('keeps only the 2-option privacy selector on the main card and moves Connect/Disconnect + diagnostics into the accordion', () => {
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
        onSetMode: () => undefined,
        onConnect: () => undefined,
        onDisconnect: () => undefined,
        onStellarHorizonProbe: () => undefined,
        advancedChildren: React.createElement('div', { 'data-testid': 'spp-slot' }, 'SPP'),
      }),
    );
    expect(markup).toContain('Bloqueo automático de protección');
    expect(markup).toContain('<details class="advanced-accordion" data-testid="nym-advanced-diagnostics">');
    expect(markup).toContain('Opciones avanzadas y diagnóstico');
    expect(markup).toContain('data-testid="nym-stellar-horizon-panel"');
    expect(markup).toContain('data-testid="spp-slot"');

    const [mainCard, advancedSection] = markup.split('data-testid="nym-advanced-diagnostics"');
    expect(mainCard).toContain('data-testid="nym-mode-direct"');
    expect(mainCard).toContain('data-testid="nym-mode-nym"');
    expect(mainCard).not.toContain('data-testid="nym-connect"');
    expect(mainCard).not.toContain('data-testid="nym-disconnect"');
    expect(advancedSection).toContain('data-testid="nym-connect"');
    expect(advancedSection).toContain('data-testid="nym-disconnect"');
  });
});
