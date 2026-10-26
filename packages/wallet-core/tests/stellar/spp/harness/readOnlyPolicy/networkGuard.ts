/**
 * Fase 2.26 — Deterministic adversarial network guard (harness / Node tests).
 *
 * Classifies attempts as: local_allowed | external_blocked | uninstrumented | not_demonstrated.
 * Does NOT claim complete isolation of WASM/workers/native bindings.
 *
 * Not a security boundary against hostile same-realm code.
 */

import { createRequire } from 'node:module';

export type NetworkAttemptKind =
  | 'local_allowed'
  | 'external_blocked'
  | 'uninstrumented'
  | 'not_demonstrated';

export type NetworkAttempt = {
  at: string;
  transport: string;
  target: string;
  kind: NetworkAttemptKind;
  detail?: string;
};

export type NetworkGuardSnapshot = {
  attempts: readonly NetworkAttempt[];
  externalCount: number;
  localCount: number;
  uninstrumentedCount: number;
  notDemonstrated: readonly string[];
  instrumented: readonly string[];
};

export type NetworkGuard = {
  record(transport: string, target: string, kind: NetworkAttemptKind, detail?: string): void;
  snapshot(): NetworkGuardSnapshot;
  clear(): void;
  uninstall(): void;
  assertNoExternal(message?: string): void;
};

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function hostIsLocal(hostname: string): boolean {
  const h = hostname.toLowerCase();
  const bare = h.replace(/^\[|\]$/g, '');
  return LOOPBACK.has(h) || LOOPBACK.has(bare);
}

export function classifyNetworkTarget(target: string): NetworkAttemptKind {
  if (!target || target === '(unknown)') return 'not_demonstrated';
  try {
    if (target.includes('://')) {
      const u = new URL(target);
      if (!['http:', 'https:', 'ws:', 'wss:'].includes(u.protocol)) return 'external_blocked';
      return hostIsLocal(u.hostname) ? 'local_allowed' : 'external_blocked';
    }
    const host = target.split('/')[0]?.split(':')[0] ?? target;
    return hostIsLocal(host) ? 'local_allowed' : 'external_blocked';
  } catch {
    return 'not_demonstrated';
  }
}

function targetFromNodeArgs(args: unknown[], fallbackProto: string): string {
  const first = args[0];
  if (typeof first === 'string') return first;
  if (first && typeof first === 'object') {
    const o = first as {
      href?: string;
      host?: string;
      hostname?: string;
      port?: string | number;
      path?: string;
      protocol?: string;
    };
    if (o.href) return o.href;
    const host = o.hostname ?? o.host ?? 'unknown';
    const port = o.port !== undefined ? `:${o.port}` : '';
    const path = o.path ?? '/';
    const proto = o.protocol ?? fallbackProto;
    return `${proto}//${host}${port}${path}`;
  }
  return '(unknown)';
}

export function installNetworkGuard(options?: {
  extraNotDemonstrated?: string[];
}): NetworkGuard {
  const attempts: NetworkAttempt[] = [];
  const instrumented: string[] = [];
  const notDemonstrated: string[] = [
    'WASM/native sockets inside stellar-private-payments (not visible to JS patches)',
    'Network I/O inside DedicatedWorker/SharedWorker unless the worker cooperates',
    'chrome.* / extension-native networking (not available in Node harness)',
    ...(options?.extraNotDemonstrated ?? []),
  ];
  const restorers: Array<() => void> = [];

  const record = (
    transport: string,
    target: string,
    kind: NetworkAttemptKind,
    detail?: string,
  ): void => {
    attempts.push({
      at: new Date().toISOString(),
      transport,
      target,
      kind,
      ...(detail ? { detail } : {}),
    });
  };

  const g = globalThis as typeof globalThis & {
    fetch?: typeof fetch;
    WebSocket?: typeof WebSocket;
    EventSource?: typeof EventSource;
    Worker?: typeof Worker;
  };

  if (typeof g.fetch === 'function') {
    const original = g.fetch.bind(globalThis);
    instrumented.push('fetch');
    g.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const target =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : typeof Request !== 'undefined' && input instanceof Request
              ? input.url
              : String(input);
      const kind = classifyNetworkTarget(target);
      record('fetch', target, kind);
      if (kind === 'external_blocked') {
        throw new Error(`networkGuard: blocked external fetch to ${target}`);
      }
      return original(input as never, init);
    }) as typeof fetch;
    restorers.push(() => {
      g.fetch = original;
    });
  } else {
    notDemonstrated.push('fetch not present in this realm');
  }

  try {
    const nodeRequire = createRequire(import.meta.url);
    for (const name of ['http', 'https'] as const) {
      const mod = nodeRequire(`node:${name}`) as {
        request: (...args: unknown[]) => unknown;
        get: (...args: unknown[]) => unknown;
      };
      instrumented.push(name);
      const origRequest = mod.request.bind(mod);
      const origGet = mod.get.bind(mod);
      const wrap =
        (orig: (...args: unknown[]) => unknown) =>
        (...args: unknown[]) => {
          const target = targetFromNodeArgs(args, name === 'https' ? 'https:' : 'http:');
          const kind = classifyNetworkTarget(target);
          record(name, target, kind);
          if (kind === 'external_blocked') {
            throw new Error(`networkGuard: blocked external ${name} to ${target}`);
          }
          return orig(...args);
        };
      mod.request = wrap(origRequest) as typeof mod.request;
      mod.get = wrap(origGet) as typeof mod.get;
      restorers.push(() => {
        mod.request = origRequest;
        mod.get = origGet;
      });
    }
  } catch {
    notDemonstrated.push('http/https instrumentation failed');
  }

  if (typeof g.WebSocket === 'function') {
    const OrigWS = g.WebSocket;
    instrumented.push('WebSocket');
    // @ts-expect-error subclassing for instrumentation
    g.WebSocket = function GuardedWebSocket(
      url: string | URL,
      protocols?: string | string[],
    ) {
      const target = typeof url === 'string' ? url : url.href;
      const kind = classifyNetworkTarget(target);
      record('WebSocket', target, kind);
      if (kind === 'external_blocked') {
        throw new Error(`networkGuard: blocked external WebSocket to ${target}`);
      }
      return new OrigWS(url, protocols as never);
    };
    Object.assign(g.WebSocket, OrigWS);
    g.WebSocket.prototype = OrigWS.prototype;
    restorers.push(() => {
      g.WebSocket = OrigWS;
    });
  } else {
    notDemonstrated.push('WebSocket not present in this realm');
  }

  if (typeof g.EventSource === 'function') {
    const OrigES = g.EventSource;
    instrumented.push('EventSource');
    // @ts-expect-error subclassing for instrumentation
    g.EventSource = function GuardedEventSource(
      url: string | URL,
      init?: EventSourceInit,
    ) {
      const target = typeof url === 'string' ? url : url.href;
      const kind = classifyNetworkTarget(target);
      record('EventSource', target, kind);
      if (kind === 'external_blocked') {
        throw new Error(`networkGuard: blocked external EventSource to ${target}`);
      }
      return new OrigES(url, init);
    };
    Object.assign(g.EventSource, OrigES);
    g.EventSource.prototype = OrigES.prototype;
    restorers.push(() => {
      g.EventSource = OrigES;
    });
  } else {
    notDemonstrated.push('EventSource not present in this realm');
  }

  if (typeof g.Worker === 'function') {
    const OrigWorker = g.Worker;
    instrumented.push('Worker.constructor');
    // @ts-expect-error instrumentation wrapper
    g.Worker = function GuardedWorker(scriptURL: string | URL, options?: WorkerOptions) {
      const target = typeof scriptURL === 'string' ? scriptURL : scriptURL.href;
      record(
        'Worker.constructor',
        target,
        'not_demonstrated',
        'worker may open independent network — coverage not demonstrated',
      );
      return new OrigWorker(scriptURL, options);
    };
    Object.assign(g.Worker, OrigWorker);
    g.Worker.prototype = OrigWorker.prototype;
    restorers.push(() => {
      g.Worker = OrigWorker;
    });
  } else {
    notDemonstrated.push('Worker not present in this realm');
  }

  return {
    record,
    snapshot(): NetworkGuardSnapshot {
      return {
        attempts: Object.freeze([...attempts]),
        externalCount: attempts.filter((a) => a.kind === 'external_blocked').length,
        localCount: attempts.filter((a) => a.kind === 'local_allowed').length,
        uninstrumentedCount: attempts.filter((a) => a.kind === 'uninstrumented').length,
        notDemonstrated: Object.freeze([...notDemonstrated]),
        instrumented: Object.freeze([...instrumented]),
      };
    },
    clear() {
      attempts.length = 0;
    },
    uninstall() {
      while (restorers.length) restorers.pop()?.();
    },
    assertNoExternal(message?: string) {
      const snap = this.snapshot();
      if (snap.externalCount > 0) {
        const targets = snap.attempts
          .filter((a) => a.kind === 'external_blocked')
          .map((a) => a.target)
          .join(', ');
        throw new Error(message ?? `networkGuard: ${snap.externalCount} external attempt(s): ${targets}`);
      }
    },
  };
}
