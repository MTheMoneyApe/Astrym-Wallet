/**
 * Fase 5G.1–5G.2 — host lab SPP integration probe (doubles only; no SDK/WASM/Storage).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

import {
  createHostLabSppIntegrationProbe,
  readHostLabSppIntegrationSnapshot,
  type SppHostStatusView,
} from '../../src/spp-host/sppIntegrationProbe.js';
import { STORAGE_LAB_EXECUTION_AUTHORIZED } from '../../src/spp-host/storageLabPrep.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXT_ROOT = join(__dirname, '../..');

function idleHostView(
  overrides: Partial<SppHostStatusView> = {},
): SppHostStatusView {
  return {
    phase: 'idle',
    wasmPhase: 'idle',
    wasmInitialized: false,
    sdkInitialized: false,
    sessionInitializeEnabled: false,
    ...overrides,
  };
}

describe('createHostLabSppIntegrationProbe', () => {
  it('reports not_initialized with storage_lab_host and payments off (no session)', () => {
    const getHostStatus = vi.fn(() => idleHostView({ phase: 'ready', wasmPhase: 'ready' }));
    const probe = createHostLabSppIntegrationProbe(getHostStatus);
    expect(probe.getSession?.()).toBeNull();
    expect(probe.isPrivatePaymentsEnabled?.()).toBe(false);
    expect(probe.isStorageLabHostSurface?.()).toBe(true);
    expect(probe.isFacadePackaged()).toBe(true);
    expect(getHostStatus).toHaveBeenCalled();
  });

  it('does not invent ready availability when host facade/wasm phases are ready', () => {
    const snap = readHostLabSppIntegrationSnapshot(() =>
      idleHostView({
        phase: 'ready',
        wasmPhase: 'ready',
        wasmInitialized: true,
      }),
    );
    expect(snap.availability).toBe('not_initialized');
    expect(snap.sessionState).toBeNull();
    expect(snap.facadePackaged).toBe(true);
    expect(snap.capabilities.read_only_session).toBe(false);
    expect(snap.capabilities.private_payments).toBe(false);
    expect(snap.capabilities.storage_lab_host).toBe(true);
    expect(snap.error).toBeNull();
  });

  it('maps an injected ready session handle without calling host mutators', () => {
    const getSession = vi.fn(() => ({
      state: 'ready' as const,
      lastErrorMessage: null,
    }));
    const snap = readHostLabSppIntegrationSnapshot(() => idleHostView(), { getSession });
    expect(getSession).toHaveBeenCalled();
    expect(snap.availability).toBe('ready');
    expect(snap.capabilities.read_only_session).toBe(true);
    expect(snap.capabilities.private_payments).toBe(false);
  });

  it('reads getHostStatus only synchronously and never constructs a session', () => {
    const getHostStatus = vi.fn(() => idleHostView());
    const snap = readHostLabSppIntegrationSnapshot(getHostStatus);
    expect(getHostStatus).toHaveBeenCalledTimes(1);
    expect(snap.sessionState).toBeNull();
    expect(snap.availability).not.toBe('ready');
  });
});

describe('Fase 5G.2 surface guarantees (static)', () => {
  it('probe source does not open Storage, Client, WASM, or flip auth', () => {
    const src = readFileSync(join(EXT_ROOT, 'src/spp-host/sppIntegrationProbe.ts'), 'utf8');
    expect(src).not.toMatch(/Storage\.open/);
    expect(src).not.toMatch(/Client\.new/);
    expect(src).not.toMatch(/stellar-private-payments/);
    expect(src).not.toMatch(/new SppSession/);
    expect(src).not.toMatch(/STORAGE_LAB_EXECUTION_AUTHORIZED\s*=\s*true/);
  });

  it('controller constructs a session and initializes it only through the Nym gate', () => {
    const src = readFileSync(join(EXT_ROOT, 'src/spp-host/hostController.ts'), 'utf8');
    expect(src).toMatch(/attachExistingSession/);
    expect(src).toMatch(/readBoundSessionStatus/);
    expect(src).toMatch(/initializeBoundSessionForNym/);
    expect(src).toMatch(/Stellar Private Payments requiere Nym conectado/);
    expect(src).toMatch(/_sessionInitializeEnabled = false/);
    expect(src).not.toMatch(/new SppSession\b/);
  });

  it('main wires integrationSnapshot getSession from readBoundSessionStatus and asks Nym before init', () => {
    const src = readFileSync(join(EXT_ROOT, 'src/spp-host/main.ts'), 'utf8');
    expect(src).toMatch(/getSession:\s*\(\)\s*=>\s*controller\.readBoundSessionStatus\(\)/);
    expect(src).toMatch(/NYM_STATUS/);
    expect(src).toMatch(/initializeBoundSessionForNym/);
    expect(src).not.toMatch(/new SppSession/);
    expect(src).not.toMatch(/attachExistingSession/);
  });

  it('keeps STORAGE_LAB_EXECUTION_AUTHORIZED false', () => {
    expect(STORAGE_LAB_EXECUTION_AUTHORIZED).toBe(false);
  });
});
