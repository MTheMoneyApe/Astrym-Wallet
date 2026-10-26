/**
 * Fase 2.30 — Offline adversarial tests for typed RO-1 broker.
 */

import { describe, expect, it } from 'vitest';
import { Ro1Broker } from './broker.js';
import { assertRo1JsonValue, parseRo1Request } from './schema.js';
import { createSessionBrokerBackend } from './sessionBackend.js';
import { G8_HOST_STATUS, G9_CONFIG_STATUS, RO1_BROKER_VERSION } from './types.js';

const RPC = 'http://127.0.0.1:8765/rpc-ro1';
const CONFIG = { network: 'harness', contracts: {} };

function bundle() {
  const created = createSessionBrokerBackend({
    rpcUrl: RPC,
    contractConfig: CONFIG,
  });
  expect(created.ok).toBe(true);
  if (!created.ok) throw new Error(created.reason);
  const broker = new Ro1Broker({ backend: created.bundle.backend });
  const sess = broker.openSession();
  return { broker, session: created.bundle.session, sess };
}

async function happyPath(broker: Ro1Broker, sessionId: string) {
  const open = await broker.dispatch(
    broker.buildRequest(sessionId, 'Storage.open', {}),
  );
  expect(open.ok).toBe(true);
  const neu = await broker.dispatch(
    broker.buildRequest(sessionId, 'Client.new', {
      rpcUrl: RPC,
      contractConfig: CONFIG,
    }),
  );
  expect(neu.ok).toBe(true);
  expect(JSON.stringify(neu.response)).not.toMatch(/aspState|function/i);
  const asp = await broker.dispatch(
    broker.buildRequest(sessionId, 'Client.aspState', {}),
  );
  expect(asp.ok).toBe(true);
  const all = await broker.dispatch(
    broker.buildRequest(sessionId, 'Client.allContractsData', {}),
  );
  expect(all.ok).toBe(true);
}

describe('Ro1Broker adversarial (offline)', () => {
  it('happy path RO-1 four ops via broker; no Client leak; gates FAIL', async () => {
    const { broker, sess } = bundle();
    expect(broker.gateStatus()).toEqual({ G8: G8_HOST_STATUS, G9: G9_CONFIG_STATUS });
    await happyPath(broker, sess.sessionId);
    const leaked = JSON.stringify(
      await broker.dispatch(broker.buildRequest(sess.sessionId, 'Client.aspState', {})),
    );
    // session may still be open; ensure response has no method-looking client
    expect(leaked).not.toContain('"sync"');
  });

  it('rejects unknown methods (default deny) without fallback side effects', async () => {
    const { broker, sess, session } = bundle();
    await broker.dispatch(broker.buildRequest(sess.sessionId, 'Storage.open', {}));
    const r = await broker.dispatch({
      v: RO1_BROKER_VERSION,
      kind: 'req',
      sessionId: sess.sessionId,
      requestId: broker.mintRequestId(),
      method: 'Client.sync',
      args: {},
    });
    expect(r.ok).toBe(false);
    expect(r.response.error?.code).toBe('UNKNOWN_METHOD');
    expect(session.sideEffects().calls.some((c) => c.api.includes('sync'))).toBe(false);
  });

  it('rejects extra fields on envelope', async () => {
    const { broker, sess } = bundle();
    const r = await broker.dispatch({
      v: RO1_BROKER_VERSION,
      kind: 'req',
      sessionId: sess.sessionId,
      requestId: broker.mintRequestId(),
      method: 'Storage.open',
      args: {},
      extra: true,
    });
    expect(r.ok).toBe(false);
    expect(r.response.error?.code).toBe('EXTRA_FIELD');
  });

  it('rejects function / accessor values in args', () => {
    const fn = assertRo1JsonValue({ workerUrl: () => 'x' });
    expect(fn.ok).toBe(false);
    if (!fn.ok) expect(fn.code).toBe('FORBIDDEN_VALUE');
  });

  it('rejects forged / malformed messages', async () => {
    const { broker } = bundle();
    expect((await broker.dispatch(null)).ok).toBe(false);
    expect((await broker.dispatch('sync')).ok).toBe(false);
    expect((await broker.dispatch([])).ok).toBe(false);
    expect(
      (
        await broker.dispatch({
          v: 99,
          kind: 'req',
          sessionId: 'x',
          requestId: 'y',
          method: 'Storage.open',
          args: {},
        })
      ).ok,
    ).toBe(false);
  });

  it('rejects Client.new with opaque storage/prover on wire', async () => {
    const { broker, sess } = bundle();
    const r = await broker.dispatch(
      broker.buildRequest(sess.sessionId, 'Client.new', {
        rpcUrl: RPC,
        contractConfig: CONFIG,
        storage: { evil: true },
      }),
    );
    expect(r.ok).toBe(false);
    expect(r.response.error?.code).toBe('INVALID_ARGS');
  });

  it('rejects non-loopback rpcUrl', async () => {
    const { broker, sess } = bundle();
    const r = await broker.dispatch(
      broker.buildRequest(sess.sessionId, 'Client.new', {
        rpcUrl: 'https://horizon-testnet.stellar.org',
        contractConfig: CONFIG,
      }),
    );
    expect(r.ok).toBe(false);
  });

  it('rejects duplicate / replayed requestId', async () => {
    const { broker, sess } = bundle();
    const rid = broker.mintRequestId();
    const first = await broker.dispatch(
      broker.buildRequest(sess.sessionId, 'Storage.open', {}, rid),
    );
    expect(first.ok).toBe(true);
    const replay = await broker.dispatch(
      broker.buildRequest(sess.sessionId, 'Storage.open', {}, rid),
    );
    expect(replay.ok).toBe(false);
    expect(replay.response.error?.code).toBe('DUPLICATE_REQUEST');
  });

  it('rejects after session close', async () => {
    const { broker, sess } = bundle();
    await broker.dispatch(broker.buildRequest(sess.sessionId, 'Storage.open', {}));
    broker.closeSession(sess.sessionId, 'test');
    const r = await broker.dispatch(
      broker.buildRequest(sess.sessionId, 'Client.aspState', {}),
    );
    expect(r.ok).toBe(false);
    expect(r.response.error?.code).toBe('SESSION_CLOSED');
  });

  it('rejects late / injected external responses', async () => {
    const { broker, sess } = bundle();
    const rid = broker.mintRequestId();
    // Start a pending request by... we need pending without completing.
    // Use a slow backend:
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const slow = new Ro1Broker({
      backend: {
        async execute() {
          await gate;
          return { ok: true };
        },
      },
    });
    const s = slow.openSession();
    const pending = slow.dispatch(slow.buildRequest(s.sessionId, 'Storage.open', {}, rid));
    const injected = slow.ingestExternalResponse({
      v: RO1_BROKER_VERSION,
      kind: 'res',
      sessionId: s.sessionId,
      requestId: rid,
      ok: true,
      result: { forged: true },
    });
    expect(injected.ok).toBe(false);
    expect(injected.response.error?.code).toBe('LATE_OR_UNKNOWN_RESPONSE');
    release();
    const done = await pending;
    expect(done.ok).toBe(true);
    // Late response after completion
    const late = slow.ingestExternalResponse({
      v: RO1_BROKER_VERSION,
      kind: 'res',
      sessionId: s.sessionId,
      requestId: rid,
      ok: true,
      result: { late: true },
    });
    expect(late.ok).toBe(false);
    void sess;
    void broker;
  });

  it('handler error closes broker session (fail closed, no fallback)', async () => {
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
    if (!created.ok) throw new Error(created.reason);
    const broker = new Ro1Broker({ backend: created.bundle.backend });
    const sess = broker.openSession();
    const r = await broker.dispatch(broker.buildRequest(sess.sessionId, 'Storage.open', {}));
    expect(r.ok).toBe(false);
    expect(r.response.error?.code).toBe('HANDLER_ERROR');
    expect(broker.getSession(sess.sessionId)?.state).toBe('closed');
    const again = await broker.dispatch(
      broker.buildRequest(sess.sessionId, 'Client.sync' as 'Storage.open', {}),
    );
    // unknown method or closed — either way not sync execution
    expect(again.ok).toBe(false);
  });

  it('supports concurrent distinct requestIds', async () => {
    let active = 0;
    let maxActive = 0;
    const broker = new Ro1Broker({
      backend: {
        async execute() {
          active++;
          maxActive = Math.max(maxActive, active);
          await new Promise((r) => setTimeout(r, 20));
          active--;
          return { n: 1 };
        },
      },
    });
    const s = broker.openSession();
    const results = await Promise.all([
      broker.dispatch(broker.buildRequest(s.sessionId, 'Storage.open', {})),
      broker.dispatch(broker.buildRequest(s.sessionId, 'Storage.open', {})),
      broker.dispatch(broker.buildRequest(s.sessionId, 'Storage.open', {})),
    ]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(maxActive).toBeGreaterThan(1);
  });

  it('parseRo1Request rejects sendTransaction and bootnode', () => {
    const send = parseRo1Request({
      v: 1,
      kind: 'req',
      sessionId: 's',
      requestId: 'r',
      method: 'sendTransaction',
      args: {},
    });
    expect(send.ok).toBe(false);
    const boot = parseRo1Request({
      v: 1,
      kind: 'req',
      sessionId: 's',
      requestId: 'r',
      method: 'Client.new',
      args: {
        rpcUrl: RPC,
        contractConfig: {},
        bootnodeUrl: 'http://127.0.0.1:1',
      },
    });
    expect(boot.ok).toBe(false);
  });

  it('unknown sessionId rejected', async () => {
    const { broker } = bundle();
    const r = await broker.dispatch(
      broker.buildRequest('no-such-session', 'Storage.open', {}),
    );
    expect(r.ok).toBe(false);
    expect(r.response.error?.code).toBe('SESSION_UNKNOWN');
  });
});
