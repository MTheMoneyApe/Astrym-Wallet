/**
 * Fase 2.30 — Experimental typed RO-1 broker (harness only).
 *
 * Validates envelopes, binds requests to sessions, rejects replay / late
 * responses / closed sessions. Does NOT claim browser sandbox isolation.
 *
 * G8/G9 remain FAIL.
 */

import { parseRo1Request, parseRo1Response } from './schema.js';
import {
  G8_HOST_STATUS,
  G9_CONFIG_STATUS,
  RO1_BROKER_VERSION,
  type Ro1BrokerBackend,
  type Ro1BrokerErrorCode,
  type Ro1DispatchResult,
  type Ro1JsonValue,
  type Ro1RequestMessage,
  type Ro1ResponseMessage,
} from './types.js';

export type Ro1BrokerSessionInfo = {
  sessionId: string;
  state: 'open' | 'closed';
  generation: number;
};

type PendingEntry = {
  sessionId: string;
  method: string;
  openedAt: number;
};

function errResponse(
  sessionId: string,
  requestId: string,
  code: Ro1BrokerErrorCode,
  message: string,
): Ro1ResponseMessage {
  return {
    v: RO1_BROKER_VERSION,
    kind: 'res',
    sessionId,
    requestId: requestId || 'unknown',
    ok: false,
    error: { code, message },
  };
}

function okResponse(
  sessionId: string,
  requestId: string,
  result: Ro1JsonValue,
): Ro1ResponseMessage {
  return {
    v: RO1_BROKER_VERSION,
    kind: 'res',
    sessionId,
    requestId,
    ok: true,
    result,
  };
}

/**
 * Sanitize handler output: JSON round-trip strips functions / undefined.
 * Reject if round-trip fails or introduces non-plain structures unexpectedly.
 */
function sanitizeResult(value: unknown): { ok: true; value: Ro1JsonValue } | { ok: false; message: string } {
  try {
    const json = JSON.stringify(value);
    if (json === undefined) return { ok: false, message: 'result not JSON-serializable' };
    const parsed = JSON.parse(json) as Ro1JsonValue;
    return { ok: true, value: parsed };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : 'result sanitize failed',
    };
  }
}

export type Ro1BrokerOptions = {
  backend: Ro1BrokerBackend;
  /** Max concurrent in-flight requests per session (default 8). */
  maxInFlight?: number;
};

/**
 * In-process typed broker. Message-shaped API suitable for future MessagePort.
 */
export class Ro1Broker {
  private readonly backend: Ro1BrokerBackend;
  private readonly maxInFlight: number;
  private readonly sessions = new Map<string, Ro1BrokerSessionInfo>();
  /** requestId → pending (globally unique ids recommended). */
  private readonly pending = new Map<string, PendingEntry>();
  /** Completed requestIds (replay detection). Bounded ring. */
  private readonly completed = new Set<string>();
  private readonly completedOrder: string[] = [];
  private static readonly COMPLETED_CAP = 256;
  private sessionSeq = 0;
  private requestSeq = 0;

  constructor(options: Ro1BrokerOptions) {
    this.backend = options.backend;
    this.maxInFlight = options.maxInFlight ?? 8;
  }

  gateStatus(): { G8: typeof G8_HOST_STATUS; G9: typeof G9_CONFIG_STATUS } {
    return { G8: G8_HOST_STATUS, G9: G9_CONFIG_STATUS };
  }

  /** Open a broker-tracked session. Backend may already have its own id — we mint ours. */
  openSession(): Ro1BrokerSessionInfo {
    const sessionId = `broker-sess-${++this.sessionSeq}`;
    const info: Ro1BrokerSessionInfo = { sessionId, state: 'open', generation: 1 };
    this.sessions.set(sessionId, info);
    return { ...info };
  }

  closeSession(sessionId: string, _reason?: string): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    s.state = 'closed';
    s.generation += 1;
    // Drop pending for this session
    for (const [rid, p] of this.pending) {
      if (p.sessionId === sessionId) this.pending.delete(rid);
    }
  }

  mintRequestId(): string {
    return `req-${++this.requestSeq}-${Date.now()}`;
  }

  /**
   * Validate + dispatch a request message. Fail-closed; never falls back to denied methods.
   */
  async dispatch(raw: unknown): Promise<Ro1DispatchResult> {
    const parsed = parseRo1Request(raw);
    if (!parsed.ok) {
      const sid =
        raw && typeof raw === 'object' && raw !== null && 'sessionId' in raw
          ? String((raw as { sessionId: unknown }).sessionId ?? 'unknown')
          : 'unknown';
      const rid =
        raw && typeof raw === 'object' && raw !== null && 'requestId' in raw
          ? String((raw as { requestId: unknown }).requestId ?? 'unknown')
          : 'unknown';
      return {
        ok: false,
        response: errResponse(sid, rid, parsed.code, parsed.message),
      };
    }
    return this.dispatchParsed(parsed.value);
  }

  async dispatchParsed(msg: Ro1RequestMessage): Promise<Ro1DispatchResult> {
    const session = this.sessions.get(msg.sessionId);
    if (!session) {
      return {
        ok: false,
        response: errResponse(msg.sessionId, msg.requestId, 'SESSION_UNKNOWN', 'unknown session'),
      };
    }
    if (session.state !== 'open') {
      return {
        ok: false,
        response: errResponse(msg.sessionId, msg.requestId, 'SESSION_CLOSED', 'session closed'),
      };
    }
    if (this.pending.has(msg.requestId) || this.completed.has(msg.requestId)) {
      return {
        ok: false,
        response: errResponse(
          msg.sessionId,
          msg.requestId,
          'DUPLICATE_REQUEST',
          'duplicate or replayed requestId',
        ),
      };
    }

    let inFlightForSession = 0;
    for (const p of this.pending.values()) {
      if (p.sessionId === msg.sessionId) inFlightForSession++;
    }
    if (inFlightForSession >= this.maxInFlight) {
      return {
        ok: false,
        response: errResponse(
          msg.sessionId,
          msg.requestId,
          'TRANSPORT',
          'too many in-flight requests',
        ),
      };
    }

    this.pending.set(msg.requestId, {
      sessionId: msg.sessionId,
      method: msg.method,
      openedAt: Date.now(),
    });

    try {
      const result = await this.backend.execute(msg.method, msg.args);
      // Re-check session after await (may have closed mid-flight)
      const s2 = this.sessions.get(msg.sessionId);
      if (!s2 || s2.state !== 'open') {
        this.pending.delete(msg.requestId);
        this.markCompleted(msg.requestId);
        return {
          ok: false,
          response: errResponse(
            msg.sessionId,
            msg.requestId,
            'SESSION_CLOSED',
            'session closed before response',
          ),
        };
      }

      const sanitized = sanitizeResult(result);
      this.pending.delete(msg.requestId);
      this.markCompleted(msg.requestId);
      if (!sanitized.ok) {
        // Fail closed — close session on unsafe result shape
        this.closeSession(msg.sessionId, 'unsafe result');
        return {
          ok: false,
          response: errResponse(
            msg.sessionId,
            msg.requestId,
            'HANDLER_ERROR',
            sanitized.message,
          ),
        };
      }
      return {
        ok: true,
        response: okResponse(msg.sessionId, msg.requestId, sanitized.value),
      };
    } catch (e) {
      this.pending.delete(msg.requestId);
      this.markCompleted(msg.requestId);
      this.closeSession(msg.sessionId, 'handler error');
      return {
        ok: false,
        response: errResponse(
          msg.sessionId,
          msg.requestId,
          'HANDLER_ERROR',
          e instanceof Error ? e.message : 'handler error',
        ),
      };
    }
  }

  /**
   * Ingest an unsolicited / late response (simulates forged MessagePort traffic).
   * Always rejected unless it matches a live pending requestId+sessionId — and
   * even then external ingestion is not used for success path (dispatch owns completion).
   */
  ingestExternalResponse(raw: unknown): Ro1DispatchResult {
    const parsed = parseRo1Response(raw);
    if (!parsed.ok) {
      return {
        ok: false,
        response: errResponse('unknown', 'unknown', parsed.code, parsed.message),
      };
    }
    const msg = parsed.value;
    const pending = this.pending.get(msg.requestId);
    if (!pending || pending.sessionId !== msg.sessionId) {
      return {
        ok: false,
        response: errResponse(
          msg.sessionId,
          msg.requestId,
          'LATE_OR_UNKNOWN_RESPONSE',
          'no matching in-flight request',
        ),
      };
    }
    // Broker owns completion via dispatch — external response injection is denied
    return {
      ok: false,
      response: errResponse(
        msg.sessionId,
        msg.requestId,
        'LATE_OR_UNKNOWN_RESPONSE',
        'external response injection denied',
      ),
    };
  }

  /** Helper: build a well-formed request envelope for tests / hosts. */
  buildRequest(
    sessionId: string,
    method: Ro1RequestMessage['method'],
    args: Ro1JsonValue,
    requestId?: string,
  ): Ro1RequestMessage {
    return {
      v: RO1_BROKER_VERSION,
      kind: 'req',
      sessionId,
      requestId: requestId ?? this.mintRequestId(),
      method,
      args,
    };
  }

  getSession(sessionId: string): Ro1BrokerSessionInfo | undefined {
    const s = this.sessions.get(sessionId);
    return s ? { ...s } : undefined;
  }

  /** Test seam: count pending. */
  pendingCount(): number {
    return this.pending.size;
  }

  private markCompleted(requestId: string): void {
    this.completed.add(requestId);
    this.completedOrder.push(requestId);
    while (this.completedOrder.length > Ro1Broker.COMPLETED_CAP) {
      const old = this.completedOrder.shift();
      if (old) this.completed.delete(old);
    }
  }
}
