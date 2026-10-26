/**
 * Fase 2.34 — Host-owned Worker containment (harness only).
 *
 * Install BEFORE SDK init. Treats SDK dispose() as insufficient (2.33).
 *
 * Scope: wraps globalThis.Worker in THIS realm only.
 * Does NOT see Workers constructed inside another DedicatedWorker.
 * Does NOT claim MV3 isolation or CSP egress proof.
 */

/**
 * @typedef {'SDK_REAL' | 'DEPENDENCY_REAL' | 'HARNESS_CONTROL' | 'UNTRACKED' | 'NOT_IDENTIFIED'} WorkerClass
 */

/**
 * @param {string} script
 * @returns {WorkerClass}
 */
export function classifyWorkerScript(script) {
  const s = String(script);
  if (
    s.includes('/stellar-private-payments/dist/workers/storage-worker') ||
    s.includes('/stellar-private-payments/dist/workers/prover-worker')
  ) {
    return 'SDK_REAL';
  }
  if (s.includes('/stellar-private-payments/')) {
    return 'DEPENDENCY_REAL';
  }
  if (
    s.includes('worker-csp-probe') ||
    s.includes('csp-negative-probe') ||
    s.includes('host-worker-containment') ||
    s.includes('harness')
  ) {
    return 'HARNESS_CONTROL';
  }
  if (s.startsWith('blob:')) {
    return 'NOT_IDENTIFIED'; // blob owner unclear without inspection
  }
  return 'NOT_IDENTIFIED';
}

/**
 * @typedef {object} HostContainmentOptions
 * @property {{ closeSession: (id: string) => void, dispatch?: Function, openSession?: Function, getSession?: Function, mintRequestId?: Function, buildRequest?: Function, sessions?: Map }} [broker]
 * @property {string} [sessionId]
 */

/**
 * Create a host containment controller for one session.
 */
export function createHostContainment(options = {}) {
  const OrigWorker = globalThis.Worker;
  const OrigSharedWorker =
    typeof globalThis.SharedWorker === 'function' ? globalThis.SharedWorker : null;

  /** @type {Map<string, { worker: Worker, script: string, at: string, terminated: boolean, class: WorkerClass, sessionId: string, workerId: string, terminateCalls: number }>} */
  const byId = new Map();
  let seq = 0;
  let sessionId = options.sessionId || `host-sess-${Date.now()}`;
  let closed = false;
  let closeGeneration = 0;
  let closeCount = 0;
  /** @type {object[]} */
  const events = [];
  /** @type {string | null} */
  let lastCloseError = null;

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

  // SharedWorker: record as untracked capability if present (SPP 0.2.1 does not use it)
  let sharedWorkerSeen = false;
  if (OrigSharedWorker) {
    function TrackedSharedWorker(scriptURL, opts) {
      sharedWorkerSeen = true;
      log('shared_worker_seen', {
        script: String(scriptURL),
        note: 'SharedWorker not session-owned in this spike — fail-closed on emergencyClose if seen during open session',
      });
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

  /**
   * Emergency host close — does NOT trust sdk.dispose() to kill workers.
   */
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

    // Fail closed if SharedWorker appeared (ownership unclear)
    if (sharedWorkerSeen) {
      lastCloseError = 'SHARED_WORKER_UNOWNED';
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
        reason: lastCloseError,
        closeGeneration,
        terminatedNow: 0,
        snapshot: snapshot(),
      };
    }

    closed = true;
    closeGeneration += 1;
    log('emergency_close_begin', { reason, closeGeneration, sessionId });

    // 1–3: broker / session irreversible
    if (broker && typeof broker.closeSession === 'function') {
      try {
        broker.closeSession(sessionId, reason);
      } catch (e) {
        log('broker_close_error', {
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }

    // 4: terminate all workers owned by this session
    let terminatedNow = 0;
    for (const e of byId.values()) {
      if (e.sessionId !== sessionId) continue;
      if (e.terminated) continue;
      try {
        e.worker.terminate();
        // wrapper sets terminated
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
      note: 'Nested Worker() inside storage/prover modules is OUT OF SCOPE / NOT captured',
    },
    snapshot,
    liveOwned() {
      return snapshot().filter((e) => e.sessionId === sessionId && !e.terminated);
    },
    assertOpen,
    emergencyClose,
    /**
     * Dispatch via broker only if host still open.
     */
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
