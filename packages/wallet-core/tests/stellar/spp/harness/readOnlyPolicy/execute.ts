/**
 * Execute a read-only call only after authorizeReadOnlyCall succeeds.
 *
 * On handler failure: rethrow — never fall back to sync / sign / send / other APIs.
 */

import { DecisionLog } from './decisionLog.js';
import { authorizeReadOnlyCall } from './policy.js';
import type { PolicyDecision, ReadOnlyAllowedMethod, ReadOnlyCallRequest } from './types.js';

export type ReadOnlyHandlers = {
  'Storage.open': (args?: { workerUrl?: string }) => Promise<unknown> | unknown;
  'Client.new': (
    args: Extract<ReadOnlyCallRequest, { method: 'Client.new' }>['args'],
  ) => Promise<unknown> | unknown;
  'Client.aspState': () => Promise<unknown> | unknown;
  'Client.allContractsData': () => Promise<unknown> | unknown;
};

export type ExecuteResult =
  | { ok: true; method: ReadOnlyAllowedMethod; result: unknown; decision: PolicyDecision }
  | { ok: false; decision: PolicyDecision; result?: undefined }
  | { ok: false; decision: PolicyDecision; handlerError: unknown };

/**
 * Side-effect recorder for adversarial tests (fake SDK surface).
 * Production code must not wire this; harness only.
 */
export type SideEffectRecorder = {
  readonly calls: readonly { api: string; detail?: string }[];
  record(api: string, detail?: string): void;
  clear(): void;
};

export function createSideEffectRecorder(): SideEffectRecorder {
  const calls: { api: string; detail?: string }[] = [];
  return {
    get calls() {
      return Object.freeze([...calls]);
    },
    record(api: string, detail?: string) {
      calls.push(detail === undefined ? { api } : { api, detail });
    },
    clear() {
      calls.length = 0;
    },
  };
}

/**
 * Fake handlers that only record allowlisted side effects (no real SDK / network).
 * aspState / allContractsData record getLedgerEntries only (per FASE-2.8–2.12 audit).
 */
export function createFakeReadOnlyHandlers(
  recorder: SideEffectRecorder,
  options?: {
    /** If set, this method's handler throws after recording the RO RPC intent. */
    throwOn?: ReadOnlyAllowedMethod;
    throwError?: unknown;
  },
): ReadOnlyHandlers {
  const maybeThrow = (method: ReadOnlyAllowedMethod) => {
    if (options?.throwOn === method) {
      throw options.throwError ?? new Error(`synthetic SDK failure on ${method}`);
    }
  };

  return {
    'Storage.open': (args) => {
      recorder.record('Storage.open');
      maybeThrow('Storage.open');
      return { opened: true, workerUrl: args?.workerUrl ?? null };
    },
    'Client.new': (args) => {
      recorder.record('Client.new', 'init-only');
      // Init may load prover workers locally — never record prove/sync/send
      maybeThrow('Client.new');
      return {
        mode: 'read_only',
        rpcHost: (() => {
          try {
            return new URL(args.rpcUrl).hostname;
          } catch {
            return 'invalid';
          }
        })(),
      };
    },
    'Client.aspState': () => {
      recorder.record('getLedgerEntries', 'aspState');
      maybeThrow('Client.aspState');
      return { synthetic: true, kind: 'aspState' };
    },
    'Client.allContractsData': () => {
      recorder.record('getLedgerEntries', 'allContractsData');
      maybeThrow('Client.allContractsData');
      return { synthetic: true, kind: 'allContractsData' };
    },
  };
}

export async function executeReadOnlyCall(
  request: ReadOnlyCallRequest,
  handlers: ReadOnlyHandlers,
  log?: DecisionLog,
): Promise<ExecuteResult> {
  const decision = authorizeReadOnlyCall(request, log);
  if (!decision.ok) {
    return { ok: false, decision };
  }

  try {
    let result: unknown;
    switch (decision.method) {
      case 'Storage.open': {
        const args = (request as Extract<ReadOnlyCallRequest, { method: 'Storage.open' }>).args;
        result = await handlers['Storage.open'](args);
        break;
      }
      case 'Client.new':
        result = await handlers['Client.new'](
          (request as Extract<ReadOnlyCallRequest, { method: 'Client.new' }>).args,
        );
        break;
      case 'Client.aspState':
        result = await handlers['Client.aspState']();
        break;
      case 'Client.allContractsData':
        result = await handlers['Client.allContractsData']();
        break;
      default: {
        return {
          ok: false,
          decision: {
            ok: false,
            method: String((decision as { method: string }).method),
            reason: 'internal: authorized method has no handler',
            at: new Date().toISOString(),
          },
        };
      }
    }
    return { ok: true, method: decision.method, result, decision };
  } catch (handlerError) {
    // Fail closed: do not attempt alternate APIs (sync, send, sign, …)
    return { ok: false, decision, handlerError };
  }
}
