/**
 * Fase 5F — offline unit tests for SppIntegrationStatus.
 * Injected probes only; must not import or call the SPP SDK runtime.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

import {
  SppIntegrationStatus,
  applyStoredSppSessionClearIfNewer,
  createPopupSppIntegrationProbe,
  describeSppIntegrationAvailability,
  parseStoredSppSessionStatus,
  probeSppFacadePackaged,
  readSppSessionStatusHandle,
  toStoredSppSessionClear,
  toStoredSppSessionStatus,
  type SppIntegrationProbe,
} from '../../../src/stellar/spp/SppIntegrationStatus.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('SppIntegrationStatus', () => {
  it('throws without isFacadePackaged probe', () => {
    expect(() => new SppIntegrationStatus({} as SppIntegrationProbe)).toThrow(
      /isFacadePackaged/,
    );
  });

  it('reports unavailable when facade is not packaged', () => {
    const status = new SppIntegrationStatus({
      isFacadePackaged: () => false,
    });
    const snap = status.snapshot();
    expect(snap.availability).toBe('unavailable');
    expect(snap.facadePackaged).toBe(false);
    expect(snap.capabilities.private_payments).toBe(false);
    expect(snap.capabilities.read_only_session).toBe(false);
    expect(snap.error?.code).toBe('FACADE_UNAVAILABLE');
  });

  it('defaults popup probe to facade not packaged (no false success)', () => {
    const snap = new SppIntegrationStatus(createPopupSppIntegrationProbe()).snapshot();
    expect(snap.availability).toBe('unavailable');
    expect(snap.facadePackaged).toBe(false);
    expect(snap.error?.code).toBe('FACADE_UNAVAILABLE');
  });

  it('reports not_initialized when packaged but no session is bound', () => {
    const status = new SppIntegrationStatus(
      createPopupSppIntegrationProbe({ isFacadePackaged: () => true }),
    );
    const snap = status.snapshot();
    expect(snap.availability).toBe('not_initialized');
    expect(snap.facadePackaged).toBe(true);
    expect(snap.sessionState).toBeNull();
    expect(snap.capabilities.read_only_session).toBe(false);
    expect(snap.capabilities.private_payments).toBe(false);
    expect(snap.error).toBeNull();
  });

  it('never enables private_payments from packaging alone', () => {
    const status = new SppIntegrationStatus({
      isFacadePackaged: () => true,
      isPrivatePaymentsEnabled: () => true,
      getSession: () => null,
    });
    const snap = status.snapshot();
    expect(snap.capabilities.private_payments).toBe(false);
    expect(snap.availability).toBe('not_initialized');
  });

  it('maps bound session error to availability error with sanitized message', () => {
    const status = new SppIntegrationStatus({
      isFacadePackaged: () => true,
      getSession: () => ({
        state: 'error',
        lastErrorMessage: 'INITIALIZE_FAILED: boom',
      }),
    });
    const snap = status.snapshot();
    expect(snap.availability).toBe('error');
    expect(snap.sessionState).toBe('error');
    expect(snap.capabilities.read_only_session).toBe(false);
    expect(snap.error?.code).toBe('SESSION_ERROR');
    expect(snap.error?.message).toContain('INITIALIZE_FAILED');
  });

  it('maps ready session to ready with read_only only (payments still off)', () => {
    const status = new SppIntegrationStatus({
      isFacadePackaged: () => true,
      isPrivatePaymentsEnabled: () => true,
      getSession: () => ({ state: 'ready', lastErrorMessage: null }),
    });
    const snap = status.snapshot();
    expect(snap.availability).toBe('ready');
    expect(snap.capabilities.read_only_session).toBe(true);
    expect(snap.capabilities.private_payments).toBe(false);
    expect(snap.error).toBeNull();
  });

  it('enables private_payments only when the session is ready, the option is on, and Nym is connected', () => {
    const ready = () => ({ state: 'ready' as const, lastErrorMessage: null });
    const on = new SppIntegrationStatus({
      isFacadePackaged: () => true,
      isPrivatePaymentsEnabled: () => true,
      isNymTransportActive: () => true,
      getSession: ready,
    }).snapshot();
    expect(on.capabilities.private_payments).toBe(true);

    const nymOff = new SppIntegrationStatus({
      isFacadePackaged: () => true,
      isPrivatePaymentsEnabled: () => true,
      isNymTransportActive: () => false,
      getSession: ready,
    }).snapshot();
    expect(nymOff.capabilities.private_payments).toBe(false);
  });

  it('treats uninitialized/initializing/disposed session as not_initialized', () => {
    for (const state of ['uninitialized', 'initializing', 'disposed'] as const) {
      const snap = new SppIntegrationStatus({
        isFacadePackaged: () => true,
        getSession: () => ({ state, lastErrorMessage: null }),
      }).snapshot();
      expect(snap.availability).toBe('not_initialized');
      expect(snap.sessionState).toBe(state);
      expect(snap.capabilities.read_only_session).toBe(false);
    }
  });

  it('returns error when facade probe throws (no SDK call)', () => {
    const snap = new SppIntegrationStatus({
      isFacadePackaged: () => {
        throw new Error('probe boom');
      },
    }).snapshot();
    expect(snap.availability).toBe('error');
    expect(snap.error?.code).toBe('INTEGRATION_PROBE_FAILED');
  });

  it('does not call getSession during construction', () => {
    const getSession = vi.fn(() => null);
    new SppIntegrationStatus({
      isFacadePackaged: () => true,
      getSession,
    });
    expect(getSession).not.toHaveBeenCalled();
  });

  it('does not invent readiness without an explicit ready session', () => {
    const snap = new SppIntegrationStatus({
      isFacadePackaged: () => true,
      getSession: () => ({ state: 'uninitialized', lastErrorMessage: null }),
    }).snapshot();
    expect(snap.availability).not.toBe('ready');
    expect(snap.capabilities.private_payments).toBe(false);
  });
});

describe('readSppSessionStatusHandle', () => {
  it('returns null without inventing a session', () => {
    expect(readSppSessionStatusHandle(null)).toBeNull();
    expect(readSppSessionStatusHandle(undefined)).toBeNull();
  });

  it('mirrors sync getters on an already-existing handle (no initialize/dispose)', () => {
    const handle = { state: 'ready' as const, lastErrorMessage: null };
    const mirrored = readSppSessionStatusHandle(handle);
    expect(mirrored).toEqual({ state: 'ready', lastErrorMessage: null });
    expect(mirrored).not.toBe(handle);
  });
});

describe('describeSppIntegrationAvailability', () => {
  it('returns Spanish UI labels for each availability', () => {
    expect(describeSppIntegrationAvailability('unavailable')).toMatch(/no disponible/i);
    expect(describeSppIntegrationAvailability('not_initialized')).toMatch(/no inicializado/i);
    expect(describeSppIntegrationAvailability('ready')).toMatch(/listo/i);
    expect(describeSppIntegrationAvailability('error')).toMatch(/Error/i);
  });
});

describe('SppIntegrationStatus surface guarantees (static)', () => {
  it('source has no SDK package import and no runtime factory wiring', () => {
    const src = readFileSync(
      join(__dirname, '../../../src/stellar/spp/SppIntegrationStatus.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/from ['"]stellar-private-payments['"]/);
    expect(src).not.toMatch(/createSppSdkRuntime/);
    expect(src).not.toMatch(/initWasm\s*\(/);
    expect(src).not.toMatch(/deps\.Storage/);
    expect(src).not.toMatch(/deps\.Client/);
  });
});

describe('probeSppFacadePackaged + stored session mirror', () => {
  it('returns true only when fetch ok', async () => {
    const okFetch = vi.fn(async () => ({ ok: true }) as Response);
    const badFetch = vi.fn(async () => ({ ok: false }) as Response);
    const throwFetch = vi.fn(async () => {
      throw new Error('network');
    });
    expect(await probeSppFacadePackaged('chrome-extension://x/spp/SPP_ASSET_META.json', okFetch)).toBe(
      true,
    );
    expect(await probeSppFacadePackaged('chrome-extension://x/spp/SPP_ASSET_META.json', badFetch)).toBe(
      false,
    );
    expect(await probeSppFacadePackaged('chrome-extension://x/spp/SPP_ASSET_META.json', throwFetch)).toBe(
      false,
    );
    expect(await probeSppFacadePackaged('', okFetch)).toBe(false);
  });

  it('round-trips stored session without inventing ready from garbage', () => {
    expect(toStoredSppSessionStatus(null, { generation: 1 })).toBeNull();
    expect(
      parseStoredSppSessionStatus({
        state: 'ready',
        lastErrorMessage: null,
        generation: 2,
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
    ).toEqual({
      state: 'ready',
      lastErrorMessage: null,
    });
    expect(parseStoredSppSessionStatus({ state: 'totally-ready', generation: 1 })).toBeNull();
    expect(parseStoredSppSessionStatus({ state: 'ready' })).toBeNull(); // missing generation
    expect(parseStoredSppSessionStatus(null)).toBeNull();
  });

  it('rejects obsolete publishes with lower generation', () => {
    const stored = toStoredSppSessionStatus(
      { state: 'uninitialized', lastErrorMessage: null },
      { generation: 5, updatedAt: '2026-01-01T00:00:05.000Z' },
    );
    expect(stored?.generation).toBe(5);

    const stale = applyStoredSppSessionClearIfNewer(
      { state: 'ready', lastErrorMessage: null, generation: 3, updatedAt: '2026-01-01T00:00:03.000Z' },
      { handle: { state: 'uninitialized', lastErrorMessage: null }, generation: 5 },
    );
    expect(stale.applied).toBe(false);
    expect(stale.handle?.state).toBe('uninitialized');

    const newer = applyStoredSppSessionClearIfNewer(stored, {
      handle: { state: 'uninitialized', lastErrorMessage: null },
      generation: 4,
    });
    expect(newer.applied).toBe(true);
    expect(newer.handle?.state).toBe('uninitialized');
    expect(newer.generation).toBe(5);

    const cleared = applyStoredSppSessionClearIfNewer(toStoredSppSessionClear({ generation: 6 }), {
      handle: { state: 'uninitialized', lastErrorMessage: null },
      generation: 5,
    });
    expect(cleared.applied).toBe(true);
    expect(cleared.handle).toBeNull();
    expect(cleared.generation).toBe(6);
  });
});
