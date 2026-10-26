/**
 * Fase 5E.8 / 5E.10 — deterministic unit tests for the CDP harness core.
 * Uses fake transport / injectable deps only: no Chrome, no network, no SPP SDK.
 */

import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CdpConnection,
  HOST_PROBE_CLICK_EXPRESSION,
  HOST_UI_SNAPSHOT_EXPRESSION,
  HOST_WASM_CLICK_EXPRESSION,
  MemoryLog,
  NdjsonLog,
  PHASE_LABELS,
  RUNNER_FORBIDDEN_ACTIONS,
  assertSmokeHostUiGates,
  assertWasmOnlySafetyGates,
  collectAuditedCommandEvidence,
  killProcessTree,
  parseArgs,
  resolveEventSessionFields,
  runSmokeCleanup,
  runWasmOnlyPhaseSequence,
  sanitizeCommandParams,
  writePhaseMarker,
} from '../../scripts/spp-cdp-harness.mjs';

function autoRespondTransport(
  cdp: CdpConnection,
  handler?: (payload: Record<string, unknown>) => unknown,
) {
  return {
    send(data: string) {
      const payload = JSON.parse(data) as {
        id: number;
        method: string;
        params?: Record<string, unknown>;
        sessionId?: string;
      };
      const result =
        handler?.(payload) ??
        (payload.method === 'Target.getTargets'
          ? { targetInfos: [] }
          : payload.method === 'Extensions.loadUnpacked'
            ? { id: 'maahkmkolfdbdlpbddmlmeanjknjfdid' }
            : payload.method === 'Target.createTarget'
              ? { targetId: 'HOST_TARGET_1' }
              : {});
      // Respond asynchronously so dispatcher is never re-entered from send()
      queueMicrotask(() => {
        cdp.onMessage(
          JSON.stringify({
            id: payload.id,
            sessionId: payload.sessionId,
            result,
          }),
        );
      });
    },
    close() {
      /* no-op */
    },
  };
}

function errorTransport(cdp: CdpConnection, message = 'boom') {
  return {
    send(data: string) {
      const payload = JSON.parse(data) as { id: number; sessionId?: string };
      queueMicrotask(() => {
        cdp.onMessage(
          JSON.stringify({
            id: payload.id,
            sessionId: payload.sessionId,
            error: { message, code: -32000 },
          }),
        );
      });
    },
    close() {
      /* no-op */
    },
  };
}

const tempDirs: string[] = [];
afterEach(() => {
  while (tempDirs.length) {
    const d = tempDirs.pop();
    if (d) rmSync(d, { recursive: true, force: true });
  }
});

describe('resolveEventSessionFields', () => {
  it('promotes params.sessionId for attachedToTarget and keeps messageSessionId distinct', () => {
    const sessions = new Map([
      [
        'ATTACHED_SID',
        {
          targetId: 'T1',
          type: 'page',
          url: 'chrome-extension://x/spp-host.html',
          configured: false,
        },
      ],
    ]);
    const fields = resolveEventSessionFields(
      {
        method: 'Target.attachedToTarget',
        sessionId: null,
        params: {
          sessionId: 'ATTACHED_SID',
          targetInfo: {
            targetId: 'T1',
            type: 'page',
            url: 'chrome-extension://x/spp-host.html',
          },
          waitingForDebugger: true,
        },
      },
      sessions,
    );
    expect(fields.messageSessionId).toBeNull();
    expect(fields.attachedSessionId).toBe('ATTACHED_SID');
    expect(fields.sessionId).toBe('ATTACHED_SID');
    expect(fields.targetId).toBe('T1');
    expect(fields.targetType).toBe('page');
  });

  it('uses message sessionId for Network events', () => {
    const sessions = new Map([
      [
        'MSG_SID',
        {
          targetId: 'T2',
          type: 'service_worker',
          url: 'chrome-extension://x/background.js',
          configured: true,
        },
      ],
    ]);
    const fields = resolveEventSessionFields(
      {
        method: 'Network.responseReceived',
        sessionId: 'MSG_SID',
        params: {
          requestId: '1',
          response: { url: 'chrome-extension://x/background.js', status: 200 },
        },
      },
      sessions,
    );
    expect(fields.messageSessionId).toBe('MSG_SID');
    expect(fields.attachedSessionId).toBeNull();
    expect(fields.sessionId).toBe('MSG_SID');
    expect(fields.targetId).toBe('T2');
  });
});

describe('CdpConnection command audit', () => {
  it('logs successful audited command request and result', async () => {
    const log = new MemoryLog();
    const cdp = new CdpConnection(null, log, {});
    cdp.useFakeTransport(autoRespondTransport(cdp));
    await cdp.send('Target.setDiscoverTargets', { discover: true });
    const cmds = log.ofKind('cdp-command');
    const results = log.ofKind('cdp-result');
    expect(cmds).toHaveLength(1);
    expect(cmds[0]?.method).toBe('Target.setDiscoverTargets');
    expect(cmds[0]?.commandId).toBe(1);
    expect(results).toHaveLength(1);
    expect(results[0]?.ok).toBe(true);
  });

  it('logs command errors without throwing away correlation ids', async () => {
    const log = new MemoryLog();
    const cdp = new CdpConnection(null, log, {});
    cdp.useFakeTransport(errorTransport(cdp, 'attach failed'));
    await expect(
      cdp.send('Target.attachToTarget', { targetId: 'X', flatten: true }),
    ).rejects.toThrow(/attach failed/);
    const results = log.ofKind('cdp-result');
    expect(results).toHaveLength(1);
    expect(results[0]?.ok).toBe(false);
    expect(String(results[0]?.error)).toMatch(/attach failed/);
    expect(results[0]?.commandId).toBe(1);
  });
});

describe('CdpConnection attach dedup and setup order', () => {
  it('configures domains before resume when waitingForDebugger is true', async () => {
    const log = new MemoryLog();
    const cdp = new CdpConnection(null, log, {});
    const order: string[] = [];
    cdp.useFakeTransport({
      send(data: string) {
        const payload = JSON.parse(data) as {
          id: number;
          method: string;
          sessionId?: string;
        };
        order.push(payload.method);
        queueMicrotask(() => {
          cdp.onMessage(
            JSON.stringify({
              id: payload.id,
              sessionId: payload.sessionId,
              result: {},
            }),
          );
        });
      },
      close() {},
    });

    cdp.handleEvent({
      method: 'Target.attachedToTarget',
      sessionId: null,
      params: {
        sessionId: 'SID_WAIT',
        waitingForDebugger: true,
        targetInfo: {
          targetId: 'TW',
          type: 'page',
          url: 'chrome-extension://abc/spp-host.html',
        },
      },
    });

    await cdp.waitForPendingSetups();

    const enableIdx = order.indexOf('Runtime.enable');
    const logIdx = order.indexOf('Log.enable');
    const netIdx = order.indexOf('Network.enable');
    const resumeIdx = order.indexOf('Runtime.runIfWaitingForDebugger');
    expect(enableIdx).toBeGreaterThanOrEqual(0);
    expect(logIdx).toBeGreaterThan(enableIdx);
    expect(netIdx).toBeGreaterThan(logIdx);
    expect(resumeIdx).toBeGreaterThan(netIdx);

    const evt = log
      .entries()
      .find((e) => e.kind === 'event' && e.method === 'Target.attachedToTarget');
    expect(evt?.sessionId).toBe('SID_WAIT');
    expect(evt?.attachedSessionId).toBe('SID_WAIT');
    expect(evt?.messageSessionId).toBeNull();
    expect(cdp.configuredSessions.has('SID_WAIT')).toBe(true);
  });

  it('skips duplicate attach for the same sessionId but allows a distinct session on same target', async () => {
    const log = new MemoryLog();
    const cdp = new CdpConnection(null, log, {});
    cdp.useFakeTransport(autoRespondTransport(cdp));

    const targetInfo = {
      targetId: 'T_SAME',
      type: 'service_worker',
      url: 'chrome-extension://x/background.js',
    };

    cdp.handleEvent({
      method: 'Target.attachedToTarget',
      params: { sessionId: 'S1', waitingForDebugger: false, targetInfo },
    });
    await cdp.waitForPendingSetups();

    cdp.handleEvent({
      method: 'Target.attachedToTarget',
      params: { sessionId: 'S1', waitingForDebugger: false, targetInfo },
    });
    await cdp.waitForPendingSetups();

    cdp.handleEvent({
      method: 'Target.attachedToTarget',
      params: { sessionId: 'S2', waitingForDebugger: false, targetInfo },
    });
    await cdp.waitForPendingSetups();

    const skips = log.ofKind('attach-skip');
    expect(skips.some((s) => s.reason === 'session-already-configured')).toBe(true);
    expect(cdp.configuredSessions.has('S1')).toBe(true);
    expect(cdp.configuredSessions.has('S2')).toBe(true);

    const domainSetups = log.ofKind('domain-setup');
    expect(domainSetups.filter((d) => d.sessionId === 'S1')).toHaveLength(3);
    expect(domainSetups.filter((d) => d.sessionId === 'S2')).toHaveLength(3);
  });

  it('drains setups before a simulated host createTarget', async () => {
    const log = new MemoryLog();
    const cdp = new CdpConnection(null, log, {});
    let setupsDoneBeforeCreate = false;
    cdp.useFakeTransport(
      autoRespondTransport(cdp, (payload) => {
        if (payload.method === 'Target.createTarget') {
          setupsDoneBeforeCreate = cdp.configuredSessions.has('SID_SW');
          return { targetId: 'HOST1' };
        }
        return {};
      }),
    );

    cdp.handleEvent({
      method: 'Target.attachedToTarget',
      params: {
        sessionId: 'SID_SW',
        waitingForDebugger: true,
        targetInfo: {
          targetId: 'SW1',
          type: 'service_worker',
          url: 'chrome-extension://x/background.js',
        },
      },
    });

    await cdp.waitForPendingSetups();
    expect(cdp.configuredSessions.has('SID_SW')).toBe(true);

    await cdp.send('Target.createTarget', {
      url: 'chrome-extension://x/spp-host.html',
    });
    expect(setupsDoneBeforeCreate).toBe(true);

    const createCmd = log.ofKind('cdp-command').find((c) => c.method === 'Target.createTarget');
    const createRes = log.ofKind('cdp-result').find((c) => c.method === 'Target.createTarget');
    expect(createCmd).toBeTruthy();
    expect(createRes?.ok).toBe(true);
  });
});

describe('NdjsonLog and sanitization', () => {
  it('writes coherent NDJSON fields incrementally', () => {
    const dir = mkdtempSync(join(tmpdir(), 'solanym-cdp-test-'));
    tempDirs.push(dir);
    const file = join(dir, 'out.ndjson');
    const log = new NdjsonLog(file);
    log.write({
      t: '2026-01-01T00:00:00.000Z',
      kind: 'event',
      method: 'Target.attachedToTarget',
      sessionId: 'A',
      messageSessionId: null,
      attachedSessionId: 'A',
      targetId: 'T',
      targetType: 'page',
      targetUrl: 'chrome-extension://x/spp-host.html',
    });
    log.close();
    const lines = readFileSync(file, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    const row = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(row.sessionId).toBe('A');
    expect(row.attachedSessionId).toBe('A');
    expect(row.targetId).toBe('T');
  });

  it('redacts Runtime.evaluate expression bodies', () => {
    const sanitized = sanitizeCommandParams('Runtime.evaluate', {
      expression: 'secret-or-long-dom-query',
      returnByValue: true,
    });
    expect(sanitized).toEqual({
      returnByValue: true,
      awaitPromise: undefined,
      expressionChars: 'secret-or-long-dom-query'.length,
    });
    expect(JSON.stringify(sanitized)).not.toContain('secret');
  });
});

describe('killProcessTree idempotence and taskkill doubles', () => {
  it('is a no-op when child is missing', async () => {
    const a = await killProcessTree(null as unknown as { pid: number });
    const b = await killProcessTree(undefined as unknown as { pid: number });
    const c = await killProcessTree({ pid: 0 } as { pid: number });
    expect(a.ok).toBe(true);
    expect(a.skipped).toBe(true);
    expect(b.skipped).toBe(true);
    expect(c.skipped).toBe(true);
    expect(a.chromeDeathVerified).toBe(false);
  });

  function fakeTaskkillSpawn(emit: 'exit0' | 'exit1' | 'error' | 'hang') {
    const activeTimers: Array<ReturnType<typeof setTimeout>> = [];
    const procs: EventEmitter[] = [];

    const spawnFn = vi.fn(() => {
      const proc = new EventEmitter();
      procs.push(proc);
      queueMicrotask(() => {
        if (emit === 'exit0') proc.emit('exit', 0);
        else if (emit === 'exit1') proc.emit('exit', 1);
        else if (emit === 'error') proc.emit('error', new Error('taskkill spawn failed'));
        // hang: neither exit nor error — only timeout path
      });
      return proc;
    });

    const setTimeoutFn = vi.fn((fn: () => void, ms: number) => {
      // Use real short timer only when hang; otherwise track and never fire if exit wins
      if (emit === 'hang') {
        const id = setTimeout(fn, Math.min(ms, 20));
        activeTimers.push(id);
        return id;
      }
      // Still register a timer id so clearTimeout can be observed, but do not fire
      const id = setTimeout(() => {}, 60_000);
      activeTimers.push(id);
      return id;
    }) as unknown as typeof setTimeout;

    const clearTimeoutFn = vi.fn((id: ReturnType<typeof setTimeout>) => {
      clearTimeout(id);
    }) as unknown as typeof clearTimeout;

    return { spawnFn, setTimeoutFn, clearTimeoutFn, activeTimers, procs };
  }

  it('resolves when taskkill exits with code 0 (does not claim Chrome death)', async () => {
    const d = fakeTaskkillSpawn('exit0');
    const result = await killProcessTree(
      { pid: 4242 },
      {
        platform: 'win32',
        spawnFn: d.spawnFn as never,
        setTimeoutFn: d.setTimeoutFn,
        clearTimeoutFn: d.clearTimeoutFn,
        timeoutMs: 50,
      },
    );
    expect(result.ok).toBe(true);
    expect(result.pid).toBe(4242);
    expect(result.taskkillVia).toBe('exit');
    expect(result.taskkillExitCode).toBe(0);
    expect(result.chromeDeathVerified).toBe(false);
    expect(d.spawnFn).toHaveBeenCalledWith(
      'taskkill',
      ['/PID', '4242', '/T', '/F'],
      expect.objectContaining({ stdio: 'ignore' }),
    );
    expect(d.clearTimeoutFn).toHaveBeenCalled();
  });

  it('resolves when taskkill exits with non-zero code (still not Chrome death proof)', async () => {
    const d = fakeTaskkillSpawn('exit1');
    const result = await killProcessTree(
      { pid: 4243 },
      {
        platform: 'win32',
        spawnFn: d.spawnFn as never,
        setTimeoutFn: d.setTimeoutFn,
        clearTimeoutFn: d.clearTimeoutFn,
        timeoutMs: 50,
      },
    );
    expect(result.ok).toBe(true);
    expect(result.taskkillVia).toBe('exit');
    expect(result.taskkillExitCode).toBe(1);
    expect(result.chromeDeathVerified).toBe(false);
  });

  it('resolves on taskkill child process error event', async () => {
    const d = fakeTaskkillSpawn('error');
    const result = await killProcessTree(
      { pid: 4244 },
      {
        platform: 'win32',
        spawnFn: d.spawnFn as never,
        setTimeoutFn: d.setTimeoutFn,
        clearTimeoutFn: d.clearTimeoutFn,
        timeoutMs: 50,
      },
    );
    expect(result.ok).toBe(true);
    expect(result.taskkillVia).toBe('error');
    expect(result.chromeDeathVerified).toBe(false);
  });

  it('resolves on taskkill timeout without waiting the production 8s', async () => {
    const d = fakeTaskkillSpawn('hang');
    const started = Date.now();
    const result = await killProcessTree(
      { pid: 4245 },
      {
        platform: 'win32',
        spawnFn: d.spawnFn as never,
        setTimeoutFn: d.setTimeoutFn,
        clearTimeoutFn: d.clearTimeoutFn,
        timeoutMs: 15,
      },
    );
    const elapsed = Date.now() - started;
    expect(result.ok).toBe(true);
    expect(result.taskkillVia).toBe('timeout');
    expect(result.chromeDeathVerified).toBe(false);
    expect(elapsed).toBeLessThan(2000);
  });
});

describe('runSmokeCleanup finally sequence', () => {
  it('closes CDP, awaits kill, then removes lab profile via doubles (no real rm/Chrome)', async () => {
    const order: string[] = [];
    const cdp = {
      domainStatus: [{ domain: 'Runtime.enable', ok: true }],
      eventCounts: { 'Target.attachedToTarget': 1 },
      close: vi.fn(() => {
        order.push('cdp-close');
      }),
    };
    const chromeChild = { pid: 9991 };
    const labProfile = 'C:\\Users\\M\\AppData\\Local\\Temp\\solanym-spp-cdp-lab-testdouble';
    const report: Record<string, unknown> = {};

    const killProcessTreeFn = vi.fn(async () => {
      order.push('kill-awaited');
      return { ok: true, pid: 9991, chromeDeathVerified: false, taskkillVia: 'exit' };
    });
    const rmSyncFn = vi.fn(() => {
      order.push('profile-removed');
    });
    const delayFn = vi.fn(async () => {
      order.push('post-kill-delay');
    });

    const result = await runSmokeCleanup(
      { cdp, chromeChild, labProfile, report },
      {
        killProcessTreeFn: killProcessTreeFn as never,
        rmSyncFn: rmSyncFn as never,
        delayFn,
        postKillDelayMs: 1,
      },
    );

    expect(order).toEqual(['cdp-close', 'kill-awaited', 'post-kill-delay', 'profile-removed']);
    expect(result.sequence).toEqual(order);
    expect(cdp.close).toHaveBeenCalledTimes(1);
    expect(killProcessTreeFn).toHaveBeenCalledWith(chromeChild, undefined);
    expect(rmSyncFn).toHaveBeenCalledWith(labProfile, { recursive: true, force: true });
    expect(report.labProfileDiscarded).toBe(true);
    expect(report.domainStatus).toEqual(cdp.domainStatus);
    expect(result.cdpClosed).toBe(true);
    expect(result.killAwaited).toBe(true);
    expect(result.profileDiscarded).toBe(true);
  });

  it('still awaits kill and records profile errors without throwing', async () => {
    const cdp = { close: vi.fn(), domainStatus: [], eventCounts: {} };
    const report: Record<string, unknown> = {};
    const result = await runSmokeCleanup(
      {
        cdp,
        chromeChild: { pid: 1 },
        labProfile: 'C:\\Temp\\solanym-spp-cdp-lab-err',
        report,
      },
      {
        killProcessTreeFn: async () => ({ ok: true, pid: 1, chromeDeathVerified: false }),
        rmSyncFn: () => {
          throw new Error('EPERM simulated');
        },
        delayFn: async () => {},
        postKillDelayMs: 0,
      },
    );
    expect(result.killAwaited).toBe(true);
    expect(result.profileDiscarded).toBe(false);
    expect(result.profileError).toMatch(/EPERM/);
    expect(report.labProfileDiscarded).toBe(false);
  });
});

describe('5G.14 wasm-only phase markers and CDP correlation', () => {
  it('parseArgs accepts --wasm-only and rejects combining with --smoke', () => {
    expect(parseArgs(['node', 'h.mjs', '--wasm-only']).wasmOnly).toBe(true);
    expect(parseArgs(['node', 'h.mjs', '--smoke']).smoke).toBe(true);
    expect(() => parseArgs(['node', 'h.mjs', '--smoke', '--wasm-only'])).toThrow(
      /either --smoke or --wasm-only/,
    );
  });

  it('emits unique ordered T0/T1/T2 markers each with its own UI snapshot', async () => {
    const log = new MemoryLog();
    let tick = 0;
    const now = () => `2026-10-26T12:00:0${tick++}.000Z`;
    const uis = [
      {
        phase: 'uninitialized',
        wasm: 'not-started',
        runDisabled: true,
        executionAuthorized: false,
        sdkInitialized: false,
        tag: 't0',
      },
      {
        phase: 'ready',
        wasm: 'not-started',
        runDisabled: true,
        executionAuthorized: false,
        sdkInitialized: false,
        tag: 't1',
      },
      {
        phase: 'ready',
        wasm: 'ready',
        runDisabled: true,
        executionAuthorized: false,
        sdkInitialized: false,
        tag: 't2',
      },
    ];
    let uiIdx = 0;
    const result = await runWasmOnlyPhaseSequence({
      log,
      now,
      resolveHostMeta: () => ({
        targetId: 'HOST',
        sessionId: 'S_HOST',
        hostOpened: true,
      }),
      readUi: async () => uis[uiIdx++]!,
      runProbe: async () => {},
      runWasmInit: async () => {},
    });

    expect(result.phases).toEqual(['T0', 'T1', 'T2']);
    expect(result.t2Outcome).toBe('ready');
    expect(result.storageOpenExecuted).toBe(false);
    expect(result.clientNewExecuted).toBe(false);

    const markers = log.ofKind('phase-marker');
    expect(markers).toHaveLength(3);
    expect(markers.map((m) => m.phase)).toEqual(['T0', 'T1', 'T2']);
    expect(markers[0]!.t < markers[1]!.t && markers[1]!.t < markers[2]!.t).toBe(true);
    expect(markers[0]!.label).toBe(PHASE_LABELS.T0);
    expect(markers[1]!.label).toBe(PHASE_LABELS.T1);
    expect(markers[2]!.label).toBe(PHASE_LABELS.T2);
    expect(markers[0]!.ui?.tag).toBe('t0');
    expect(markers[1]!.ui?.tag).toBe('t1');
    expect(markers[2]!.ui?.tag).toBe('t2');
    expect(markers[2]!.outcome).toBe('ready');
    // Distinct object copies — mutating one ui must not alter another marker.
    (markers[0]!.ui as { tag: string }).tag = 'mutated';
    expect(uis[0]!.tag).toBe('t0');
  });

  it('does not substitute T0/T1 UI when T2 snapshot lacks security fields', async () => {
    const log = new MemoryLog();
    const reads = [
      {
        phase: 'uninitialized',
        wasm: 'not-started',
        runDisabled: true,
        executionAuthorized: false,
        sdkInitialized: false,
      },
      {
        phase: 'ready',
        wasm: 'not-started',
        runDisabled: true,
        executionAuthorized: false,
        sdkInitialized: false,
      },
      {
        phase: 'ready',
        wasm: 'ready',
        // intentionally omit runDisabled / executionAuthorized / sdkInitialized
      },
    ];
    let i = 0;
    const result = await runWasmOnlyPhaseSequence({
      log,
      resolveHostMeta: () => ({ targetId: 'H', sessionId: 'S', hostOpened: true }),
      readUi: async () => reads[i++] as object,
      runProbe: async () => {},
      runWasmInit: async () => {},
    });
    const t2 = log.ofKind('phase-marker').find((m) => m.phase === 'T2');
    expect(result.t2Outcome).toBe('ready');
    expect(t2?.ui?.runDisabled).toBeUndefined();
    expect(t2?.ui?.executionAuthorized).toBeUndefined();
    expect(t2?.ui?.sdkInitialized).toBeUndefined();
    // Prior markers still have their own fields — not copied forward.
    expect(log.ofKind('phase-marker')[0]?.ui?.runDisabled).toBe(true);
  });

  it('writePhaseMarker records uiMissing instead of inventing prior-phase UI', () => {
    const log = new MemoryLog();
    const rec = writePhaseMarker(log, {
      phase: 'T2',
      targetId: 'H',
      sessionId: 'S',
      hostOpened: true,
      ui: null,
      outcome: 'ready',
    });
    expect(rec.ui).toBeNull();
    expect(rec.uiMissing).toBe(true);
    expect(String(rec.note)).toMatch(/must not be substituted/);
  });

  it('correlates successful Network.enable by commandId', async () => {
    const log = new MemoryLog();
    const cdp = new CdpConnection(null, log, {});
    cdp.useFakeTransport(autoRespondTransport(cdp));
    cdp.sessions.set('S_HOST', {
      targetId: 'HOST',
      type: 'page',
      url: 'chrome-extension://x/spp-host.html',
      configured: false,
    });
    await cdp.tryDomain('S_HOST', {
      targetId: 'HOST',
      type: 'page',
      url: 'chrome-extension://x/spp-host.html',
    }, 'Network.enable');

    const evidence = collectAuditedCommandEvidence(log.entries());
    expect(evidence.hasPositiveNetworkEnable).toBe(true);
    expect(evidence.networkEnableSuccess[0]?.correlation).toBe('correlated');
    expect(evidence.networkEnableSuccess[0]?.ok).toBe(true);
    const domain = log.ofKind('domain-setup').find((d) => d.domain === 'Network.enable');
    expect(domain?.ok).toBe(true);
  });

  it('marks uncorrelated or failed Network.enable as incomplete / not positive', async () => {
    const log = new MemoryLog();
    log.write({
      t: '2026-10-26T12:00:00.000Z',
      kind: 'cdp-command',
      commandId: 9,
      method: 'Network.enable',
      sessionId: 'S',
    });
    log.write({
      t: '2026-10-26T12:00:00.100Z',
      kind: 'cdp-result',
      method: 'Network.enable',
      // missing commandId
      ok: true,
      sessionId: 'S',
    });
    const evidence = collectAuditedCommandEvidence(log.entries());
    expect(evidence.hasPositiveNetworkEnable).toBe(false);
    expect(evidence.networkEnable[0]?.correlation).toBe('incomplete');
    expect(evidence.orphanResults.some((r) => r.correlation === 'incomplete')).toBe(true);

    const logFail = new MemoryLog();
    const cdp = new CdpConnection(null, logFail, {});
    cdp.useFakeTransport(errorTransport(cdp, 'net enable denied'));
    await expect(cdp.send('Network.enable', {}, 'S')).rejects.toThrow(/net enable denied/);
    const failed = collectAuditedCommandEvidence(logFail.entries());
    expect(failed.hasPositiveNetworkEnable).toBe(false);
    expect(failed.networkEnable[0]?.ok).toBe(false);
  });

  it('does not drop boundary-timestamped network events from the log', () => {
    const log = new MemoryLog();
    const cdp = new CdpConnection(null, log, { extensionId: 'abcdefghijklmnopqrstuvwxyzabcdef' });
    cdp.hostTargetId = 'HOST';
    cdp.sessions.set('S_HOST', {
      targetId: 'HOST',
      type: 'page',
      url: 'chrome-extension://abcdefghijklmnopqrstuvwxyzabcdef/spp-host.html',
      configured: true,
    });
    // Simulate a request exactly at a T1-like boundary — harness must still log it.
    cdp.handleEvent({
      method: 'Network.requestWillBeSent',
      sessionId: 'S_HOST',
      params: {
        requestId: 'B1',
        request: {
          url: 'chrome-extension://abcdefghijklmnopqrstuvwxyzabcdef/spp/js/index.js',
          method: 'GET',
        },
        type: 'Fetch',
      },
    });
    const events = log.entries().filter((e) => e.kind === 'event');
    expect(events).toHaveLength(1);
    expect(events[0]?.method).toBe('Network.requestWillBeSent');
    expect(events[0]?.hostOpened).toBe(true);
  });

  it('smoke gates still abort when wasm is ready (smoke path unchanged)', () => {
    expect(() =>
      assertSmokeHostUiGates({
        phase: 'ready',
        wasm: 'ready',
        runDisabled: true,
        storage: 'idle',
        detail: 'executionAuthorized=false',
      }),
    ).toThrow(/unexpected wasm phase ready/);
    expect(() =>
      assertWasmOnlySafetyGates(
        {
          phase: 'ready',
          wasm: 'ready',
          runDisabled: true,
          executionAuthorized: false,
          storage: 'idle',
        },
        { allowWasmReady: true },
      ),
    ).not.toThrow();
  });

  it('runner click expressions never target Storage/Client controls', () => {
    for (const expr of [
      HOST_PROBE_CLICK_EXPRESSION,
      HOST_WASM_CLICK_EXPRESSION,
      HOST_UI_SNAPSHOT_EXPRESSION,
    ]) {
      for (const forbidden of RUNNER_FORBIDDEN_ACTIONS) {
        if (forbidden === 'spp-storage-run-btn') {
          // Snapshot may *read* run button disabled state; clicks must not.
          if (expr === HOST_UI_SNAPSHOT_EXPRESSION) continue;
        }
        expect(expr).not.toContain(forbidden);
      }
    }
    expect(HOST_PROBE_CLICK_EXPRESSION).toContain('spp-probe-btn');
    expect(HOST_WASM_CLICK_EXPRESSION).toContain('spp-wasm-btn');
    expect(HOST_PROBE_CLICK_EXPRESSION).not.toContain('spp-storage-run-btn');
    expect(HOST_WASM_CLICK_EXPRESSION).not.toContain('spp-storage-run-btn');
  });
});

describe('dispatcher non-blocking under concurrent attaches', () => {
  it('returns from handleEvent before async setup finishes; all sessions configure in order', async () => {
    const log = new MemoryLog();
    const cdp = new CdpConnection(null, log, {});

    let releaseResponses!: () => void;
    const hold = new Promise<void>((resolve) => {
      releaseResponses = resolve;
    });
    const methodOrder: string[] = [];

    cdp.useFakeTransport({
      send(data: string) {
        const payload = JSON.parse(data) as {
          id: number;
          method: string;
          sessionId?: string;
        };
        methodOrder.push(`${payload.sessionId}:${payload.method}`);
        // Hold CDP replies until the test asserts the dispatcher already returned.
        hold.then(() => {
          queueMicrotask(() => {
            cdp.onMessage(
              JSON.stringify({
                id: payload.id,
                sessionId: payload.sessionId,
                result: {},
              }),
            );
          });
        });
      },
      close() {},
    });

    const sessions = [
      {
        sessionId: 'SA',
        targetInfo: {
          targetId: 'T_SHARED',
          type: 'page',
          url: 'chrome-extension://x/spp-host.html',
        },
      },
      {
        sessionId: 'SB',
        targetInfo: {
          targetId: 'T_SHARED',
          type: 'page',
          url: 'chrome-extension://x/spp-host.html',
        },
      },
      {
        sessionId: 'SC',
        targetInfo: {
          targetId: 'T_OTHER',
          type: 'service_worker',
          url: 'chrome-extension://x/background.js',
        },
      },
    ];

    for (const s of sessions) {
      cdp.handleEvent({
        method: 'Target.attachedToTarget',
        sessionId: null,
        params: {
          sessionId: s.sessionId,
          waitingForDebugger: true,
          targetInfo: s.targetInfo,
        },
      });
    }

    // Observable: dispatcher returned while setups are still in-flight (responses held).
    expect(cdp.hasPendingSetups).toBe(true);
    expect(cdp.pendingSetupSessionIds.sort()).toEqual(['SA', 'SB', 'SC']);
    expect(cdp.configuredSessions.size).toBe(0);
    // At least the first session has already issued Runtime.enable (async started).
    expect(methodOrder.some((m) => m.endsWith(':Runtime.enable'))).toBe(true);
    // Resume must not have completed for any session yet (responses still held).
    expect(methodOrder.some((m) => m.includes('Runtime.runIfWaitingForDebugger'))).toBe(
      false,
    );

    releaseResponses();
    await cdp.waitForPendingSetups();

    expect(cdp.hasPendingSetups).toBe(false);
    expect([...cdp.configuredSessions].sort()).toEqual(['SA', 'SB', 'SC']);

    for (const sid of ['SA', 'SB', 'SC']) {
      const idxEnable = methodOrder.indexOf(`${sid}:Runtime.enable`);
      const idxLog = methodOrder.indexOf(`${sid}:Log.enable`);
      const idxNet = methodOrder.indexOf(`${sid}:Network.enable`);
      const idxResume = methodOrder.indexOf(`${sid}:Runtime.runIfWaitingForDebugger`);
      expect(idxEnable).toBeGreaterThanOrEqual(0);
      expect(idxLog).toBeGreaterThan(idxEnable);
      expect(idxNet).toBeGreaterThan(idxLog);
      expect(idxResume).toBeGreaterThan(idxNet);
    }
  });
});

