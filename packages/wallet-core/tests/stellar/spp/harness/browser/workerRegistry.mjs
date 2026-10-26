/**
 * Fase 2.32 — Track DedicatedWorker instances created while installed.
 * Allows terminate() of workers the *host* constructed — NOT an SDK-internal guarantee.
 */

export function installWorkerRegistry() {
  const OrigWorker = globalThis.Worker;
  /** @type {{ worker: Worker, script: string, at: string, terminated: boolean }[]} */
  const entries = [];

  function TrackedWorker(scriptURL, options) {
    const script = typeof scriptURL === 'string' ? scriptURL : String(scriptURL);
    const worker = new OrigWorker(scriptURL, options);
    const entry = {
      worker,
      script,
      at: new Date().toISOString(),
      terminated: false,
    };
    entries.push(entry);
    const origTerminate = worker.terminate.bind(worker);
    worker.terminate = () => {
      entry.terminated = true;
      return origTerminate();
    };
    return worker;
  }
  Object.assign(TrackedWorker, OrigWorker);
  TrackedWorker.prototype = OrigWorker.prototype;
  globalThis.Worker = TrackedWorker;

  return {
    entries() {
      return entries.map((e) => ({
        script: e.script,
        at: e.at,
        terminated: e.terminated,
      }));
    },
    liveCount() {
      return entries.filter((e) => !e.terminated).length;
    },
    /**
     * Terminate workers whose script URL matches predicate.
     * Returns how many were terminated now.
     */
    terminateMatching(predicate) {
      let n = 0;
      for (const e of entries) {
        if (!e.terminated && predicate(e.script)) {
          try {
            e.worker.terminate();
            e.terminated = true;
            n++;
          } catch {
            /* ignore */
          }
        }
      }
      return n;
    },
    terminateAll() {
      return this.terminateMatching(() => true);
    },
    uninstall() {
      globalThis.Worker = OrigWorker;
    },
    OrigWorker,
  };
}
