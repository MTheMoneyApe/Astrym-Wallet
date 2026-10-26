/**
 * Fase 5G.2 — optional bound SppSession slot on SppHostController.
 * Doubles only: no real SppSession construction, SDK, WASM, Storage, or Client.
 */

import { describe, expect, it, vi } from 'vitest';

import { SppHostController } from '../../src/spp-host/hostController.js';
import { readHostLabSppIntegrationSnapshot } from '../../src/spp-host/sppIntegrationProbe.js';
import type { SppSessionStatusHandle } from '@solanym/wallet-core/src/stellar/spp/SppIntegrationStatus.js';

const EXT_ID = 'abcdefghijklmnopqrstuvwxyzabcdef';

function fakeGetURL(path: string): string {
  const cleaned = path.replace(/^\//, '');
  return `chrome-extension://${EXT_ID}/${cleaned}`;
}

function sessionDouble(
  state: SppSessionStatusHandle['state'],
  lastErrorMessage: string | null = null,
  extras: Record<string, unknown> = {},
): SppSessionStatusHandle & Record<string, unknown> {
  return {
    state,
    lastErrorMessage,
    initialize: vi.fn(async () => undefined),
    dispose: vi.fn(),
    aspState: vi.fn(async () => ({})),
    allContractsData: vi.fn(async () => ({})),
    ...extras,
  };
}

function integrationFrom(controller: SppHostController) {
  return readHostLabSppIntegrationSnapshot(
    () => {
      const s = controller.snapshot();
      return {
        phase: s.phase,
        wasmPhase: s.wasmPhase,
        wasmInitialized: s.wasmInitialized,
        sdkInitialized: s.sdkInitialized,
        sessionInitializeEnabled: s.sessionInitializeEnabled,
        sessionBound: s.sessionBound,
        sessionState: s.sessionState,
      };
    },
    { getSession: () => controller.readBoundSessionStatus() },
  );
}

describe('SppHostController session slot (5G.2)', () => {
  it('starts unbound → snapshot not ready and probe not_initialized', () => {
    const controller = new SppHostController({ getURL: fakeGetURL });
    const snap = controller.snapshot();
    expect(snap.sessionBound).toBe(false);
    expect(snap.sessionState).toBeNull();
    expect(snap.sdkInitialized).toBe(false);
    expect(snap.sessionInitializeEnabled).toBe(false);
    expect(controller.readBoundSessionStatus()).toBeNull();
    expect(controller.getBoundSessionForHost()).toBeNull();

    const integration = integrationFrom(controller);
    expect(integration.availability).toBe('not_initialized');
    expect(integration.sessionState).toBeNull();
    expect(integration.capabilities.read_only_session).toBe(false);
    expect(integration.capabilities.private_payments).toBe(false);
    expect(integration.capabilities.storage_lab_host).toBe(true);
  });

  it('bound uninitialized session → not_initialized, sdkInitialized false', () => {
    const controller = new SppHostController({ getURL: fakeGetURL });
    const session = sessionDouble('uninitialized');
    controller.attachExistingSession(session);

    expect(controller.hasBoundSession).toBe(true);
    expect(controller.snapshot().sessionState).toBe('uninitialized');
    expect(controller.snapshot().sdkInitialized).toBe(false);
    expect(controller.snapshot().sessionInitializeEnabled).toBe(false);

    const integration = integrationFrom(controller);
    expect(integration.availability).toBe('not_initialized');
    expect(integration.sessionState).toBe('uninitialized');
    expect(integration.capabilities.read_only_session).toBe(false);
    expect(integration.capabilities.private_payments).toBe(false);
  });

  it('bound ready session → ready + read_only_session, payments still off', () => {
    const controller = new SppHostController({ getURL: fakeGetURL });
    controller.attachExistingSession(sessionDouble('ready'));

    expect(controller.snapshot().sdkInitialized).toBe(true);
    expect(controller.snapshot().sessionBound).toBe(true);
    expect(controller.snapshot().sessionState).toBe('ready');
    expect(controller.snapshot().sessionInitializeEnabled).toBe(false);

    const integration = integrationFrom(controller);
    expect(integration.availability).toBe('ready');
    expect(integration.sessionState).toBe('ready');
    expect(integration.capabilities.read_only_session).toBe(true);
    expect(integration.capabilities.private_payments).toBe(false);
    expect(integration.error).toBeNull();
  });

  it('status read does not invoke initialize, dispose, Storage, Client, or RO methods', () => {
    const controller = new SppHostController({ getURL: fakeGetURL });
    const session = sessionDouble('ready');
    controller.attachExistingSession(session);

    void controller.readBoundSessionStatus();
    void controller.snapshot();
    void integrationFrom(controller);
    void controller.getBoundSessionForHost();

    expect(session.initialize).not.toHaveBeenCalled();
    expect(session.dispose).not.toHaveBeenCalled();
    expect(session.aspState).not.toHaveBeenCalled();
    expect(session.allContractsData).not.toHaveBeenCalled();
  });

  it('rejects a second attach (no duplicate session slot)', () => {
    const controller = new SppHostController({ getURL: fakeGetURL });
    const first = sessionDouble('uninitialized');
    const second = sessionDouble('ready');
    controller.attachExistingSession(first);
    expect(() => controller.attachExistingSession(second)).toThrow(/already holds a bound session/);
    expect(controller.getBoundSessionForHost()).toBe(first);
    expect(second.initialize).not.toHaveBeenCalled();
  });

  it('clearBoundSession drops the reference without dispose', () => {
    const controller = new SppHostController({ getURL: fakeGetURL });
    const session = sessionDouble('ready');
    controller.attachExistingSession(session);
    controller.clearBoundSession();
    expect(session.dispose).not.toHaveBeenCalled();
    expect(controller.hasBoundSession).toBe(false);
    expect(controller.snapshot().sdkInitialized).toBe(false);
    expect(integrationFrom(controller).availability).toBe('not_initialized');
  });

  it('normalizes session error messages without leaking oversized payloads', () => {
    const controller = new SppHostController({ getURL: fakeGetURL });
    const secretBlob = `seed=${'x'.repeat(400)}`;
    controller.attachExistingSession(
      sessionDouble('error', `INITIALIZE_FAILED: ${secretBlob}`),
    );

    const integration = integrationFrom(controller);
    expect(integration.availability).toBe('error');
    expect(integration.error?.code).toBe('SESSION_ERROR');
    expect(integration.error?.message.length).toBeLessThanOrEqual(161);
    expect(integration.error?.message).toMatch(/INITIALIZE_FAILED/);
    expect(integration.capabilities.private_payments).toBe(false);
    expect(integration.capabilities.read_only_session).toBe(false);
  });

  it('getBoundSessionForHost returns the same reference (host-internal)', () => {
    const controller = new SppHostController({ getURL: fakeGetURL });
    const session = sessionDouble('initializing');
    controller.attachExistingSession(session);
    expect(controller.getBoundSessionForHost()).toBe(session);
    expect(controller.readBoundSessionStatus()).toEqual({
      state: 'initializing',
      lastErrorMessage: null,
    });
    expect(controller.readBoundSessionStatus()).not.toBe(session);
  });

  it('notifies onBoundSessionChange on attach and clear without initializing', () => {
    const seen: Array<{ state: string | null; generation: number }> = [];
    const controller = new SppHostController({
      getURL: fakeGetURL,
      onBoundSessionChange: (h, meta) => {
        seen.push({ state: h?.state ?? null, generation: meta.generation });
      },
    });
    controller.attachExistingSession(sessionDouble('ready'));
    controller.clearBoundSession();
    expect(seen).toEqual([
      { state: 'ready', generation: 1 },
      { state: null, generation: 2 },
    ]);
  });
});
