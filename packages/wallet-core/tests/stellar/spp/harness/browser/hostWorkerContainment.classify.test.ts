/**
 * Fase 2.34 — Offline tests for host worker classification + emergency close semantics.
 * Uses a fake Worker; does not prove real SPP worker termination (see browser page).
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  classifyWorkerScript,
  createHostContainment,
} from './hostWorkerContainment.mjs';
import { Ro1Broker } from '../ro1Broker/broker.js';

describe('2.34 classifyWorkerScript', () => {
  it('labels SPP storage/prover as SDK_REAL', () => {
    expect(
      classifyWorkerScript(
        'http://127.0.0.1:8765/node_modules/stellar-private-payments/dist/workers/storage-worker.js',
      ),
    ).toBe('SDK_REAL');
    expect(
      classifyWorkerScript(
        '/node_modules/stellar-private-payments/dist/workers/prover-worker.js',
      ),
    ).toBe('SDK_REAL');
  });

  it('labels harness probes as HARNESS_CONTROL', () => {
    expect(classifyWorkerScript('http://x/worker-csp-probe.classic.js')).toBe('HARNESS_CONTROL');
  });
});

describe('2.34 host containment emergencyClose (fake Worker)', () => {
  const RealWorker = globalThis.Worker;

  afterEach(() => {
    if (RealWorker) globalThis.Worker = RealWorker;
    else delete (globalThis as { Worker?: unknown }).Worker;
  });

  function installFakeWorker() {
    class FakeWorker {
      script: string;
      terminated = false;
      constructor(scriptURL: string | URL) {
        this.script = String(scriptURL);
      }
      terminate() {
        this.terminated = true;
      }
      postMessage() {}
      addEventListener() {}
      removeEventListener() {}
    }
    (globalThis as { Worker: typeof FakeWorker }).Worker = FakeWorker as unknown as typeof Worker;
    return FakeWorker;
  }

  it('registers workers and emergencyClose terminates owned ones; rejects dispatch after', async () => {
    installFakeWorker();
    const broker = new Ro1Broker({
      backend: { async execute() { return { ok: true }; } },
    });
    const host = createHostContainment({ broker });
    expect(host.closed).toBe(false);

    const w1 = new Worker(
      'http://127.0.0.1/node_modules/stellar-private-payments/dist/workers/storage-worker.js',
    );
    const w2 = new Worker(
      'http://127.0.0.1/node_modules/stellar-private-payments/dist/workers/prover-worker.js',
    );
    expect(host.snapshot()).toHaveLength(2);
    expect(host.snapshot().every((e) => e.class === 'SDK_REAL')).toBe(true);

    const first = host.emergencyClose('test');
    expect(first.ok).toBe(true);
    expect(first.terminatedNow).toBe(2);
    expect(host.closed).toBe(true);
    expect((w1 as unknown as { terminated: boolean }).terminated).toBe(true);
    expect((w2 as unknown as { terminated: boolean }).terminated).toBe(true);

    const second = host.emergencyClose('again');
    expect(second.idempotent).toBe(true);

    const denied = await host.dispatch(
      broker.buildRequest(host.sessionId, 'Storage.open', {}),
    );
    expect(denied.ok).toBe(false);
    expect(denied.response.error?.code).toBe('HOST_CLOSED');

    expect(() => new Worker('http://x/after-close.js')).toThrow(/HOST_CLOSED/);

    host.uninstall();
  });

  it('close before any workers is ok and idempotent', () => {
    installFakeWorker();
    const broker = new Ro1Broker({
      backend: { async execute() { return {}; } },
    });
    const host = createHostContainment({ broker });
    const r = host.emergencyClose('early');
    expect(r.ok).toBe(true);
    expect(r.terminatedNow).toBe(0);
    expect(host.emergencyClose('early2').idempotent).toBe(true);
    host.uninstall();
  });

  it('documents nested-worker realm as out of coverage', () => {
    installFakeWorker();
    const host = createHostContainment({});
    expect(host.realmCoverage.nestedWorkersInsideDedicatedWorker).toBe(false);
    host.uninstall();
  });
});
