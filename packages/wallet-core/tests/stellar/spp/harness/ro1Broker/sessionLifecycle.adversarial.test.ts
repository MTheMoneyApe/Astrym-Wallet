/**
 * Fase 2.32 — Offline session teardown / late response / pending close (broker).
 */

import { describe, expect, it } from 'vitest';
import { Ro1Broker } from './broker.js';
import { createSessionBrokerBackend } from './sessionBackend.js';
import { RO1_BROKER_VERSION } from './types.js';

const RPC = 'http://127.0.0.1:8765/rpc-ro1';
const CONFIG = { network: 'harness' };

describe('2.32 session lifecycle (offline broker)', () => {
  it('normal close rejects further requests', async () => {
    const created = createSessionBrokerBackend({ rpcUrl: RPC, contractConfig: CONFIG });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const broker = new Ro1Broker({ backend: created.bundle.backend });
    const sess = broker.openSession();
    expect((await broker.dispatch(broker.buildRequest(sess.sessionId, 'Storage.open', {}))).ok).toBe(
      true,
    );
    broker.closeSession(sess.sessionId);
    const r = await broker.dispatch(broker.buildRequest(sess.sessionId, 'Client.aspState', {}));
    expect(r.ok).toBe(false);
    expect(r.response.error?.code).toBe('SESSION_CLOSED');
  });

  it('handler error closes session (no fallback)', async () => {
    const created = createSessionBrokerBackend({
      rpcUrl: RPC,
      contractConfig: CONFIG,
      handlers: {
        'Storage.open': async () => {
          throw new Error('boom');
        },
        'Client.new': async () => ({}),
        'Client.aspState': async () => ({}),
        'Client.allContractsData': async () => ({}),
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const broker = new Ro1Broker({ backend: created.bundle.backend });
    const sess = broker.openSession();
    const r = await broker.dispatch(broker.buildRequest(sess.sessionId, 'Storage.open', {}));
    expect(r.ok).toBe(false);
    expect(r.response.error?.code).toBe('HANDLER_ERROR');
    expect(broker.getSession(sess.sessionId)?.state).toBe('closed');
  });

  it('close during pending await yields SESSION_CLOSED', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const broker = new Ro1Broker({
      backend: {
        async execute() {
          await gate;
          return { n: 1 };
        },
      },
    });
    const sess = broker.openSession();
    const pending = broker.dispatch(broker.buildRequest(sess.sessionId, 'Storage.open', {}));
    broker.closeSession(sess.sessionId);
    release();
    const done = await pending;
    expect(done.ok).toBe(false);
    expect(done.response.error?.code).toBe('SESSION_CLOSED');
  });

  it('late / injected responses denied; replay denied', async () => {
    const broker = new Ro1Broker({
      backend: {
        async execute() {
          return { ok: true };
        },
      },
    });
    const sess = broker.openSession();
    const rid = broker.mintRequestId();
    expect(
      (await broker.dispatch(broker.buildRequest(sess.sessionId, 'Storage.open', {}, rid))).ok,
    ).toBe(true);
    const replay = await broker.dispatch(
      broker.buildRequest(sess.sessionId, 'Storage.open', {}, rid),
    );
    expect(replay.response.error?.code).toBe('DUPLICATE_REQUEST');

    const late = broker.ingestExternalResponse({
      v: RO1_BROKER_VERSION,
      kind: 'res',
      sessionId: sess.sessionId,
      requestId: rid,
      ok: true,
      result: { forged: true },
    });
    expect(late.response.error?.code).toBe('LATE_OR_UNKNOWN_RESPONSE');
  });

  it('gates remain FAIL', () => {
    const broker = new Ro1Broker({
      backend: { async execute() { return {}; } },
    });
    expect(broker.gateStatus()).toEqual({ G8: 'FAIL', G9: 'FAIL' });
  });
});
