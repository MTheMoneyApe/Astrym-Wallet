/**
 * Fase 2.36 — Append-only session evidence store.
 * Chrome adapter: chrome.storage.local. Tests: MemorySessionStore.
 * Never deletes prior sessions; new boot creates a new sessionId.
 */

export const STORE_KEY = 'spp_2_36_session_store_v1';

/**
 * @returns {{ currentSessionId: string|null, sessionOrder: string[], sessions: Record<string, object> }}
 */
export function emptyStore() {
  return { currentSessionId: null, sessionOrder: [], sessions: {} };
}

/**
 * In-memory store for Node tests (and fallback if chrome.storage missing).
 */
export class MemorySessionStore {
  constructor(initial = emptyStore()) {
    this._data = structuredClone(initial);
  }

  async load() {
    return structuredClone(this._data);
  }

  async save(data) {
    this._data = structuredClone(data);
  }
}

/**
 * chrome.storage.local adapter (extension page / SW).
 */
export function createChromeSessionStore(chromeLike) {
  const storage = chromeLike?.storage?.local;
  if (!storage) {
    return new MemorySessionStore();
  }
  return {
    async load() {
      const bag = await storage.get(STORE_KEY);
      const raw = bag?.[STORE_KEY];
      if (!raw || typeof raw !== 'object') return emptyStore();
      return {
        currentSessionId: raw.currentSessionId ?? null,
        sessionOrder: Array.isArray(raw.sessionOrder) ? raw.sessionOrder.slice() : [],
        sessions: raw.sessions && typeof raw.sessions === 'object' ? { ...raw.sessions } : {},
      };
    },
    async save(data) {
      await storage.set({ [STORE_KEY]: data });
    },
  };
}

/**
 * Start a new session without wiping history.
 * @param {{ load: Function, save: Function }} store
 * @param {object} freshEvidence — must include sessionId
 */
export async function beginSession(store, freshEvidence) {
  const data = await store.load();
  const previousSessionId = data.currentSessionId;
  let previousSessionRecoverable = false;
  let previousSessionSummary = null;

  if (previousSessionId && data.sessions[previousSessionId]) {
    previousSessionRecoverable = true;
    const prev = data.sessions[previousSessionId].evidence || {};
    previousSessionSummary = {
      sessionId: previousSessionId,
      savedAt: data.sessions[previousSessionId].savedAt || null,
      ok: prev.ok ?? null,
      workersRegisteredCount: Array.isArray(prev.workers?.registered)
        ? prev.workers.registered.length
        : 0,
      rpcObservedCount: Array.isArray(prev.rpc?.observed) ? prev.rpc.observed.length : 0,
      note: 'Prior session retained in store; not merged into current evidence fields',
    };
  } else if (previousSessionId) {
    previousSessionSummary = {
      sessionId: previousSessionId,
      savedAt: null,
      ok: null,
      workersRegisteredCount: null,
      rpcObservedCount: null,
      note: 'previousSessionId known but body not recoverable from store',
      previousSessionRecoverable: false,
    };
  }

  const sessionId = freshEvidence.sessionId;
  if (!sessionId) throw new Error('freshEvidence.sessionId required');

  freshEvidence.previousSessionId = previousSessionId;
  freshEvidence.previousSessionRecoverable = previousSessionRecoverable;
  freshEvidence.previousSessionSummary = previousSessionSummary;

  data.sessions[sessionId] = {
    savedAt: new Date().toISOString(),
    evidence: structuredClone(freshEvidence),
  };
  if (!data.sessionOrder.includes(sessionId)) data.sessionOrder.push(sessionId);
  data.currentSessionId = sessionId;
  await store.save(data);

  return { storeData: data, evidence: freshEvidence };
}

/**
 * Persist current evidence snapshot (overwrite only this sessionId entry).
 */
export async function persistSession(store, evidence) {
  const sessionId = evidence?.sessionId;
  if (!sessionId) throw new Error('evidence.sessionId required');
  const data = await store.load();
  const prior = data.sessions[sessionId];
  data.sessions[sessionId] = {
    savedAt: new Date().toISOString(),
    evidence: structuredClone(evidence),
    createdAt: prior?.createdAt || prior?.savedAt || new Date().toISOString(),
  };
  if (!data.sessionOrder.includes(sessionId)) data.sessionOrder.push(sessionId);
  data.currentSessionId = sessionId;
  await store.save(data);
  return data;
}

/**
 * Load a prior session body if present.
 */
export async function loadSessionEvidence(store, sessionId) {
  const data = await store.load();
  const entry = data.sessions[sessionId];
  if (!entry) {
    return { recoverable: false, evidence: null, reason: 'SESSION_NOT_IN_STORE' };
  }
  return { recoverable: true, evidence: structuredClone(entry.evidence), savedAt: entry.savedAt };
}
