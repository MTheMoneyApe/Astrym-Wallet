/**
 * Fase 2.26 — Experimental ReadOnlySession (harness only).
 *
 * Exposes ONLY RO-1 operations. Does not return a raw SDK Client.
 *
 * LIMITATION (explicit): this is NOT a security boundary against arbitrary
 * same-realm / WASM-hostile code that shares the JS process and capabilities.
 * It is a disciplined API surface + policy gate for harness experiments.
 */

import { DecisionLog } from './decisionLog.js';
import {
  createFakeReadOnlyHandlers,
  createSideEffectRecorder,
  executeReadOnlyCall,
  type ExecuteResult,
  type ReadOnlyHandlers,
  type SideEffectRecorder,
} from './execute.js';
import type { NetworkGuard } from './networkGuard.js';
import { authorizeReadOnlyCall, isHarnessLoopbackRpcUrl } from './policy.js';
import type { ReadOnlyClientNewArgs, ReadOnlyStorageOpenArgs } from './types.js';
import { G8_HOST_STATUS, G9_CONFIG_STATUS } from './types.js';

export type SessionState = 'open' | 'closed';

export type ReadOnlySessionConfig = {
  rpcUrl: string;
  contractConfig: Record<string, unknown>;
  storageWorkerUrl?: string;
  circuitsBaseUrl?: string;
  circuitLock?: unknown;
  /** Injected handlers (tests / future real SDK adapter). Defaults to fakes. */
  handlers?: ReadOnlyHandlers;
  recorder?: SideEffectRecorder;
  networkGuard?: NetworkGuard;
  decisionLog?: DecisionLog;
};

export type SessionOpResult =
  | { ok: true; result: unknown }
  | { ok: false; reason: string; handlerError?: unknown };

let nextSessionId = 1;

/**
 * Bound handle — only aspState / allContractsData. No raw client leak.
 */
export type ReadOnlyClientHandle = {
  readonly sessionId: string;
  aspState(): Promise<SessionOpResult>;
  allContractsData(): Promise<SessionOpResult>;
};

export type ReadOnlySession = {
  readonly sessionId: string;
  readonly state: SessionState;
  /** Gate status — always FAIL in this phase; session does not elevate. */
  gateStatus(): { G8: typeof G8_HOST_STATUS; G9: typeof G9_CONFIG_STATUS };
  openStorage(args?: ReadOnlyStorageOpenArgs): Promise<SessionOpResult>;
  /**
   * Creates a session-bound client handle (not the SDK Client object).
   * Requires prior successful openStorage in this session (harness invariant).
   */
  createClient(): Promise<SessionOpResult & { handle?: ReadOnlyClientHandle }>;
  /** Deny-by-default escape hatch for probing — always fails for unknown methods. */
  tryInvoke(method: string, args?: unknown): Promise<SessionOpResult>;
  close(reason?: string): void;
  decisionLog(): DecisionLog;
  sideEffects(): SideEffectRecorder;
};

export type CreateSessionResult =
  | { ok: true; session: ReadOnlySession }
  | { ok: false; reason: string };

/**
 * Validate config and create a session. On policy failure, no open session is returned.
 */
export function createReadOnlySession(config: ReadOnlySessionConfig): CreateSessionResult {
  if (!isHarnessLoopbackRpcUrl(config.rpcUrl)) {
    return { ok: false, reason: 'rpcUrl must be harness literal loopback' };
  }
  if (
    config.contractConfig === null ||
    typeof config.contractConfig !== 'object' ||
    Array.isArray(config.contractConfig)
  ) {
    return { ok: false, reason: 'contractConfig object required' };
  }

  const clientNewArgs: ReadOnlyClientNewArgs = {
    rpcUrl: config.rpcUrl,
    contractConfig: config.contractConfig,
    ...(config.storageWorkerUrl !== undefined
      ? { storageWorkerUrl: config.storageWorkerUrl }
      : {}),
    ...(config.circuitsBaseUrl !== undefined ? { circuitsBaseUrl: config.circuitsBaseUrl } : {}),
    ...(config.circuitLock !== undefined ? { circuitLock: config.circuitLock } : {}),
  };

  const pre = authorizeReadOnlyCall({ method: 'Client.new', args: clientNewArgs });
  if (!pre.ok) {
    return { ok: false, reason: pre.reason };
  }

  const sessionId = `ro-sess-${nextSessionId++}`;
  const log = config.decisionLog ?? new DecisionLog();
  const recorder = config.recorder ?? createSideEffectRecorder();
  const handlers = config.handlers ?? createFakeReadOnlyHandlers(recorder);
  const guard = config.networkGuard;

  let state: SessionState = 'open';
  let storageOpened = false;
  let clientCreated = false;
  let closeReason: string | undefined;

  const failClosed = (reason: string): SessionOpResult => {
    state = 'closed';
    closeReason = reason;
    return { ok: false, reason };
  };

  const ensureOpen = (): SessionOpResult | null => {
    if (state !== 'open') {
      return { ok: false, reason: `session closed${closeReason ? `: ${closeReason}` : ''}` };
    }
    return null;
  };

  const run = async (
    request: Parameters<typeof executeReadOnlyCall>[0],
  ): Promise<SessionOpResult> => {
    const closed = ensureOpen();
    if (closed) return closed;

    const result: ExecuteResult = await executeReadOnlyCall(request, handlers, log);
    if (!result.ok) {
      if ('handlerError' in result && result.handlerError !== undefined) {
        // Init / op failure → close session; do not fallback
        state = 'closed';
        closeReason = 'handler error (fail closed)';
        return {
          ok: false,
          reason: 'handler error — session closed',
          handlerError: result.handlerError,
        };
      }
      // Policy deny — close on violation of allowlist when probing via session
      if (!result.decision.ok) {
        // Denying unknown methods via tryInvoke should not always destroy session;
        // only destroy when an allowed path fails or config is violated mid-flight.
        return { ok: false, reason: result.decision.reason };
      }
      return { ok: false, reason: 'operation failed' };
    }

    try {
      guard?.assertNoExternal();
    } catch (e) {
      return failClosed(e instanceof Error ? e.message : 'external network blocked');
    }

    return { ok: true, result: result.result };
  };

  const clientHandle: ReadOnlyClientHandle = {
    sessionId,
    async aspState() {
      if (state !== 'open' || !clientCreated) {
        return { ok: false, reason: 'client handle invalid or session closed' };
      }
      return run({ method: 'Client.aspState' });
    },
    async allContractsData() {
      if (state !== 'open' || !clientCreated) {
        return { ok: false, reason: 'client handle invalid or session closed' };
      }
      return run({ method: 'Client.allContractsData' });
    },
  };

  const session: ReadOnlySession = {
    sessionId,
    get state() {
      return state;
    },
    gateStatus() {
      return { G8: G8_HOST_STATUS, G9: G9_CONFIG_STATUS };
    },
    async openStorage(args) {
      const r = await run({ method: 'Storage.open', args });
      if (r.ok) storageOpened = true;
      else if (r.handlerError) {
        /* already closed in run */
      }
      return r;
    },
    async createClient() {
      const closed = ensureOpen();
      if (closed) return closed;
      if (!storageOpened) {
        return { ok: false, reason: 'openStorage required before createClient' };
      }
      const r = await run({ method: 'Client.new', args: clientNewArgs });
      if (!r.ok) return r;
      clientCreated = true;
      // Return handle only — never raw SDK
      return { ok: true, result: { bound: true }, handle: clientHandle };
    },
    async tryInvoke(method, args) {
      const closed = ensureOpen();
      if (closed) return closed;
      // Only RO-1 methods may succeed; everything else denied without fallback
      return run({ method, args } as Parameters<typeof executeReadOnlyCall>[0]);
    },
    close(reason) {
      state = 'closed';
      closeReason = reason ?? 'closed';
      clientCreated = false;
    },
    decisionLog() {
      return log;
    },
    sideEffects() {
      return recorder;
    },
  };

  return { ok: true, session };
}
