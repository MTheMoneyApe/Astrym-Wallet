/**
 * Spike-local copy of Fase 2.34 host containment.
 * Classifies chrome-extension://…/vendor/… worker URLs as SDK_REAL.
 * Does NOT import from packages/extension or vault.
 */

/**
 * @param {string} script
 */
export function classifyWorkerScript(script) {
  const s = String(script);
  if (
    s.includes('/stellar-private-payments/dist/workers/storage-worker') ||
    s.includes('/stellar-private-payments/dist/workers/prover-worker') ||
    s.includes('/vendor/dist/workers/storage-worker') ||
    s.includes('/vendor/dist/workers/prover-worker')
  ) {
    return 'SDK_REAL';
  }
  if (s.includes('/stellar-private-payments/') || s.includes('/vendor/')) {
    return 'DEPENDENCY_REAL';
  }
  if (
    s.includes('worker-csp-probe') ||
    s.includes('csp-negative-probe') ||
    s.includes('host-worker-containment') ||
    s.includes('harness') ||
    s.includes('unregistered-probe')
  ) {
    return 'HARNESS_CONTROL';
  }
  if (s.startsWith('blob:')) {
    return 'NOT_IDENTIFIED';
  }
  return 'NOT_IDENTIFIED';
}

export function createHostContainment(options = {}) {
  const OrigWorker = globalThis.Worker;
  const OrigSharedWorker =
    typeof globalThis.SharedWorker === 'function' ? globalThis.SharedWorker : null;

  /** @type {Map<string, object>} */
  const byId = new Map();
  let seq = 0;
  let sessionId = options.sessionId || `host-sess-${Date.now()}`;
  let closed = false;
  let closeGeneration = 0;
  let closeCount = 0;
  /** @type {object[]} */
  const events = [];
  let sharedWorkerSeen = false;

  const broker = options.broker || null;
  if (broker && typeof broker.openSession === 'function' && !options.sessionId) {
    const s = broker.openSession();
    sessionId = s.sessionId;
  }

  function log(msg, detail) {
    events.push({ at: new Date().toISOString(), msg, ...(detail ? { detail } : {}) });
  }

  function TrackedWorker(scriptURL, workerOptions) {
    if (closed) {
      const err = new Error('HOST_CLOSED: Worker construction denied after emergencyClose');
      log('worker_construct_denied', { script: String(scriptURL) });
      throw err;
    }
    const script =
      typeof scriptURL === 'string'
        ? scriptURL
        : scriptURL instanceof URL
          ? scriptURL.href
          : String(scriptURL);
    const worker = new OrigWorker(scriptURL, workerOptions);
    const workerId = `w-${++seq}`;
    const entry = {
      worker,
      script,
      at: new Date().toISOString(),
      terminated: false,
      class: classifyWorkerScript(script),
      sessionId,
      workerId,
      terminateCalls: 0,
      type: workerOptions && workerOptions.type === 'module' ? 'module' : 'classic',
    };
    byId.set(workerId, entry);
    log('worker_registered', {
      workerId,
      script,
      class: entry.class,
      type: entry.type,
    });

    const origTerminate = worker.terminate.bind(worker);
    worker.terminate = () => {
      entry.terminateCalls += 1;
      if (!entry.terminated) {
        entry.terminated = true;
        log('worker_terminated', { workerId, script, by: 'terminate()' });
      }
      return origTerminate();
    };
    return worker;
  }

  Object.assign(TrackedWorker, OrigWorker);
  TrackedWorker.prototype = OrigWorker.prototype;
  globalThis.Worker = TrackedWorker;

  if (OrigSharedWorker) {
    function TrackedSharedWorker(scriptURL, opts) {
      sharedWorkerSeen = true;
      log('shared_worker_seen', { script: String(scriptURL) });
      return new OrigSharedWorker(scriptURL, opts);
    }
    Object.assign(TrackedSharedWorker, OrigSharedWorker);
    TrackedSharedWorker.prototype = OrigSharedWorker.prototype;
    globalThis.SharedWorker = TrackedSharedWorker;
  }

  function snapshot() {
    return [...byId.values()].map((e) => ({
      workerId: e.workerId,
      script: e.script,
      class: e.class,
      sessionId: e.sessionId,
      terminated: e.terminated,
      terminateCalls: e.terminateCalls,
      type: e.type,
      at: e.at,
    }));
  }

  function emergencyClose(reason = 'host_emergency_close') {
    closeCount += 1;
    if (closed) {
      log('emergency_close_idempotent', { closeCount, reason });
      return {
        ok: true,
        idempotent: true,
        closeGeneration,
        terminatedNow: 0,
        snapshot: snapshot(),
      };
    }

    if (sharedWorkerSeen) {
      closed = true;
      closeGeneration += 1;
      if (broker && typeof broker.closeSession === 'function') {
        try {
          broker.closeSession(sessionId);
        } catch {
          /* ignore */
        }
      }
      log('emergency_close_fail_closed_shared', { reason });
      return {
        ok: false,
        reason: 'SHARED_WORKER_UNOWNED',
        closeGeneration,
        terminatedNow: 0,
        snapshot: snapshot(),
      };
    }

    closed = true;
    closeGeneration += 1;
    log('emergency_close_begin', { reason, closeGeneration, sessionId });

    if (broker && typeof broker.closeSession === 'function') {
      try {
        broker.closeSession(sessionId, reason);
      } catch (e) {
        log('broker_close_error', {
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }

    let terminatedNow = 0;
    for (const e of byId.values()) {
      if (e.sessionId !== sessionId) continue;
      if (e.terminated) continue;
      try {
        e.worker.terminate();
        terminatedNow += 1;
      } catch (err) {
        log('terminate_error', {
          workerId: e.workerId,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const stillLive = snapshot().filter((e) => e.sessionId === sessionId && !e.terminated);
    log('emergency_close_done', {
      terminatedNow,
      stillLive: stillLive.length,
    });

    return {
      ok: stillLive.length === 0,
      idempotent: false,
      closeGeneration,
      terminatedNow,
      stillLive,
      snapshot: snapshot(),
      reason: stillLive.length ? 'SOME_WORKERS_NOT_TERMINATED' : reason,
    };
  }

  function assertOpen(op) {
    if (closed) {
      return { ok: false, code: 'HOST_CLOSED', message: `session closed: ${op}` };
    }
    return { ok: true };
  }

  return {
    get sessionId() {
      return sessionId;
    },
    get closed() {
      return closed;
    },
    get closeGeneration() {
      return closeGeneration;
    },
    get events() {
      return events.slice();
    },
    get sharedWorkerSeen() {
      return sharedWorkerSeen;
    },
    realmCoverage: {
      wrapsWindowWorker: true,
      wrapsSharedWorker: Boolean(OrigSharedWorker),
      nestedWorkersInsideDedicatedWorker: false,
      note: 'Nested Worker() inside storage/prover modules is OUT OF SCOPE',
    },
    snapshot,
    liveOwned() {
      return snapshot().filter((e) => e.sessionId === sessionId && !e.terminated);
    },
    assertOpen,
    emergencyClose,
    async dispatch(raw) {
      const gate = assertOpen('dispatch');
      if (!gate.ok) {
        return {
          ok: false,
          response: {
            v: 1,
            kind: 'res',
            sessionId,
            requestId: (raw && raw.requestId) || 'unknown',
            ok: false,
            error: { code: 'HOST_CLOSED', message: gate.message },
          },
        };
      }
      if (!broker || typeof broker.dispatch !== 'function') {
        return {
          ok: false,
          response: {
            v: 1,
            kind: 'res',
            sessionId,
            requestId: 'unknown',
            ok: false,
            error: { code: 'NO_BROKER', message: 'broker missing' },
          },
        };
      }
      return broker.dispatch(raw);
    },
    uninstall() {
      globalThis.Worker = OrigWorker;
      if (OrigSharedWorker) globalThis.SharedWorker = OrigSharedWorker;
    },
    OrigWorker,
    classifyWorkerScript,
  };
}
