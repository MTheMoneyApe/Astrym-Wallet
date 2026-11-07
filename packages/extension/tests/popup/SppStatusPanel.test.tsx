/**
 * Fase 5F — presentational SPP status panel (no SDK / IPC).
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// The panel renders SppAccountPanel, which imports ipc.ts. That module
// imports webextension-polyfill at load time, and the polyfill throws unless
// chrome.runtime.id exists. This file renders markup only, so both the
// browser API and the IPC client stay mocked.
vi.mock('webextension-polyfill', () => ({
  default: {
    runtime: { sendMessage: vi.fn() },
  },
}));

vi.mock('../../src/popup/ipc.js', () => ({
  sendIpcMessage: vi.fn(async () => ({ success: false })),
}));

import { SppStatusPanel } from '../../src/popup/SppStatusPanel.js';
import type { SppIntegrationSnapshot } from '@solanym/wallet-core/src/stellar/spp/SppIntegrationStatus.js';

function snap(partial: Partial<SppIntegrationSnapshot>): SppIntegrationSnapshot {
  return {
    availability: 'not_initialized',
    facadePackaged: true,
    sessionState: null,
    error: null,
    capabilities: {
      read_only_session: false,
      private_payments: false,
      storage_lab_host: false,
    },
    ...partial,
  };
}

describe('SppStatusPanel', () => {
  it('shows not-initialized packaged state without payment actions', () => {
    const markup = renderToStaticMarkup(
      React.createElement(SppStatusPanel, { snapshot: snap({}) }),
    );
    expect(markup).toContain('data-testid="spp-status-panel"');
    expect(markup).toContain('data-spp-availability="not_initialized"');
    expect(markup).toContain('SPP instalado, pero no inicializado');
    expect(markup).toContain('Pagos privados: no disponibles');
    expect(markup).toContain('data-testid="spp-prepare-phase"');
    expect(markup).toContain('data-spp-session="none"');
    expect(markup).not.toContain('Preparar sesión SPP');
    expect(markup).not.toContain('spp-host.html');
    expect(markup).not.toContain('Client.new');
    expect(markup).not.toContain('Deposit');
  });

  it('shows probing label without inventing readiness', () => {
    const markup = renderToStaticMarkup(
      React.createElement(SppStatusPanel, { snapshot: snap({}), probing: true }),
    );
    expect(markup).toContain('data-spp-availability="probing"');
    expect(markup).toContain('Comprobando assets SPP');
  });

  it('shows unavailable and error copy when provided', () => {
    const unavailable = renderToStaticMarkup(
      React.createElement(SppStatusPanel, {
        snapshot: snap({
          availability: 'unavailable',
          facadePackaged: false,
          error: { code: 'FACADE_UNAVAILABLE', message: 'SPP facade is not packaged for this surface' },
        }),
      }),
    );
    expect(unavailable).toContain('SPP no disponible');
    expect(unavailable).toContain('data-spp-error="FACADE_UNAVAILABLE"');

    const errored = renderToStaticMarkup(
      React.createElement(SppStatusPanel, {
        snapshot: snap({
          availability: 'error',
          error: { code: 'SESSION_ERROR', message: 'session failed' },
        }),
      }),
    );
    expect(errored).toContain('Error de integración SPP');
    expect(errored).toContain('session failed');
  });

  it('does not advertise private payments even when read-only is active', () => {
    const markup = renderToStaticMarkup(
      React.createElement(SppStatusPanel, {
        snapshot: snap({
          availability: 'ready',
          sessionState: 'ready',
          capabilities: {
            read_only_session: true,
            private_payments: false,
            storage_lab_host: false,
          },
        }),
      }),
    );
    expect(markup).toContain('SPP listo (solo lectura)');
    expect(markup).toContain('Sesión solo lectura: activa');
    expect(markup).toContain('Pagos privados: no disponibles');
  });

  it('keeps the private-payments option closed until Nym is connected', () => {
    const closed = renderToStaticMarkup(
      React.createElement(SppStatusPanel, {
        snapshot: snap({}),
        nymMode: 'direct',
        nymConnected: false,
        sppSelected: true,
        onToggleSpp: () => undefined,
      }),
    );
    expect(closed).toContain('data-spp-nym-gate="closed"');
    expect(closed).toContain('requieren conectar Nym');
    expect(closed).toContain('disabled');

    const open = renderToStaticMarkup(
      React.createElement(SppStatusPanel, {
        snapshot: snap({
          availability: 'ready',
          sessionState: 'ready',
          capabilities: {
            read_only_session: true,
            private_payments: true,
            storage_lab_host: false,
          },
        }),
        nymMode: 'nym',
        nymConnected: true,
        sppSelected: true,
        onToggleSpp: () => undefined,
      }),
    );
    expect(open).toContain('data-spp-nym-gate="open"');
    expect(open).toContain('data-testid="spp-option-toggle"');
    expect(open).toContain('checked');
    expect(open).toContain('data-testid="spp-pool-contract"');
    expect(open).not.toContain('Preparar sesión SPP');
    expect(open).toContain('Pagos privados: disponibles');
  });

  it('labels uninitialized session as constructed not initialized', () => {
    const markup = renderToStaticMarkup(
      React.createElement(SppStatusPanel, {
        snapshot: snap({
          availability: 'not_initialized',
          sessionState: 'uninitialized',
        }),
        sessionGeneration: 3,
      }),
    );
    expect(markup).toContain('data-spp-session-state="uninitialized"');
    expect(markup).toContain('construida, no inicializada');
    expect(markup).toContain('data-spp-generation="3"');
    expect(markup).toContain('Pagos privados: no disponibles');
  });
});
