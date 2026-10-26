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
});
