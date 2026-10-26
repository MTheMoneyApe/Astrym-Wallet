/**
 * Fase 2.30 — Browser-side mirror of typed RO-1 broker (harness).
 * Kept as plain ESM for serve.mjs without a TS bundler.
 * Authoritative offline tests live in ../ro1Broker/*.ts
 */

const V = 1;
const ALLOWED = new Set([
  'Storage.open',
  'Client.new',
  'Client.aspState',
  'Client.allContractsData',
]);

function isPlain(o) {
  if (o === null || typeof o !== 'object' || Array.isArray(o)) return false;
  const p = Object.getPrototypeOf(o);
  return p === Object.prototype || p === null;
}

function err(sessionId, requestId, code, message) {
  return {
    v: V,
    kind: 'res',
    sessionId: sessionId || 'unknown',
    requestId: requestId || 'unknown',
    ok: false,
    error: { code, message },
  };
}

function parseReq(raw) {
  if (!isPlain(raw)) return { ok: false, code: 'MALFORMED', message: 'not plain object' };
  for (const k of Object.keys(raw)) {
    if (!['v', 'kind', 'sessionId', 'requestId', 'method', 'args'].includes(k)) {
      return { ok: false, code: 'EXTRA_FIELD', message: `unexpected field: ${k}` };
    }
  }
  if (raw.v !== V || raw.kind !== 'req') {
    return { ok: false, code: 'MALFORMED', message: 'bad v/kind' };
  }
  if (typeof raw.sessionId !== 'string' || typeof raw.requestId !== 'string') {
    return { ok: false, code: 'MALFORMED', message: 'bad ids' };
  }
  if (typeof raw.method !== 'string' || !ALLOWED.has(raw.method)) {
    return { ok: false, code: 'UNKNOWN_METHOD', message: `deny: ${raw.method}` };
  }
  if (!isPlain(raw.args) && raw.args !== null) {
    // args must be plain object (including {})
    if (raw.args === null || typeof raw.args !== 'object' || Array.isArray(raw.args)) {
      return { ok: false, code: 'INVALID_ARGS', message: 'args must be object' };
    }
  }
  try {
    JSON.parse(JSON.stringify(raw.args));
  } catch {
    return { ok: false, code: 'FORBIDDEN_VALUE', message: 'args not JSON-safe' };
  }
  return { ok: true, value: raw };
}

export class Ro1BrokerStandalone {
  constructor(backend) {
    this.backend = backend;
    this.sessions = new Map();
    this.pending = new Map();
    this.completed = new Set();
    this.seq = 0;
    this.req = 0;
  }

  gateStatus() {
    return { G8: 'FAIL', G9: 'FAIL' };
  }

  openSession() {
    const sessionId = `broker-sess-${++this.seq}`;
    this.sessions.set(sessionId, { sessionId, state: 'open' });
    return { sessionId, state: 'open' };
  }

  closeSession(sessionId) {
    const s = this.sessions.get(sessionId);
    if (s) s.state = 'closed';
    for (const [id, p] of this.pending) {
      if (p.sessionId === sessionId) this.pending.delete(id);
    }
  }

  mintRequestId() {
    return `req-${++this.req}`;
  }

  buildRequest(sessionId, method, args, requestId) {
    return {
      v: V,
      kind: 'req',
      sessionId,
      requestId: requestId || this.mintRequestId(),
      method,
      args: args ?? {},
    };
  }

  async dispatch(raw) {
    const parsed = parseReq(raw);
    if (!parsed.ok) {
      return {
        ok: false,
        response: err(raw?.sessionId, raw?.requestId, parsed.code, parsed.message),
      };
    }
    const msg = parsed.value;
    const session = this.sessions.get(msg.sessionId);
    if (!session) {
      return {
        ok: false,
        response: err(msg.sessionId, msg.requestId, 'SESSION_UNKNOWN', 'unknown session'),
      };
    }
    if (session.state !== 'open') {
      return {
        ok: false,
        response: err(msg.sessionId, msg.requestId, 'SESSION_CLOSED', 'session closed'),
      };
    }
    if (this.pending.has(msg.requestId) || this.completed.has(msg.requestId)) {
      return {
        ok: false,
        response: err(msg.sessionId, msg.requestId, 'DUPLICATE_REQUEST', 'replay'),
      };
    }
    this.pending.set(msg.requestId, { sessionId: msg.sessionId });
    try {
      const result = await this.backend.execute(msg.method, msg.args);
      const s2 = this.sessions.get(msg.sessionId);
      this.pending.delete(msg.requestId);
      this.completed.add(msg.requestId);
      if (!s2 || s2.state !== 'open') {
        return {
          ok: false,
          response: err(msg.sessionId, msg.requestId, 'SESSION_CLOSED', 'closed mid-flight'),
        };
      }
      const safe = JSON.parse(JSON.stringify(result));
      return {
        ok: true,
        response: {
          v: V,
          kind: 'res',
          sessionId: msg.sessionId,
          requestId: msg.requestId,
          ok: true,
          result: safe,
        },
      };
    } catch (e) {
      this.pending.delete(msg.requestId);
      this.completed.add(msg.requestId);
      this.closeSession(msg.sessionId);
      return {
        ok: false,
        response: err(
          msg.sessionId,
          msg.requestId,
          'HANDLER_ERROR',
          e instanceof Error ? e.message : 'handler error',
        ),
      };
    }
  }
}

/** Fake RO-1 backend — no real SDK. Separated from SDK results in reports. */
export function createFakeRo1Backend() {
  let opened = false;
  let bound = false;
  return {
    kind: 'fake',
    async execute(method, args) {
      if (method === 'Storage.open') {
        opened = true;
        return { opened: true, backend: 'fake' };
      }
      if (method === 'Client.new') {
        if (!opened) throw new Error('openStorage required');
        const rpc = args && args.rpcUrl;
        if (typeof rpc !== 'string' || !rpc.includes('127.0.0.1')) {
          throw new Error('rpcUrl must be loopback');
        }
        bound = true;
        return { bound: true, backend: 'fake' };
      }
      if (method === 'Client.aspState' || method === 'Client.allContractsData') {
        if (!bound) throw new Error('createClient required');
        return { method, backend: 'fake', poolsLen: method === 'Client.allContractsData' ? 1 : 0 };
      }
      throw new Error('deny');
    },
  };
}
