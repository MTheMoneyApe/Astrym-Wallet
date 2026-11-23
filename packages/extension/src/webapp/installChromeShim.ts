/**
 * Minimal Chrome extension API stand-in for the Android / desktop browser webapp.
 *
 * webextension-polyfill refuses to load unless `chrome.runtime.id` exists.
 * Install this shim before that import. The MV3 extension never calls it.
 *
 * Vault ciphertext lives in localStorage. The session CryptoKey lives in
 * IndexedDB so structured clone keeps it non-extractable. Auto-lock uses
 * timers because this page is the process.
 */

import { NYM_PRIVACY_PREFERENCE_STORAGE_KEY } from '../shared/nymPrivacyPreference.js';

const LOCAL_STORAGE_KEY = 'astrym.chrome.storage.local.v1';
const SESSION_DB = 'astrym-chrome-session';
const SESSION_STORE = 'kv';
const NO_RESPONSE = 'The message port closed before a response was received.';

type Callback = (...args: unknown[]) => unknown;
type Store = Record<string, unknown>;

type LocalStorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export type AndroidChromeShimOptions = {
  /** Defaults to globalThis. Tests pass a separate host per webapp instance. */
  host?: AndroidChromeHost;
  /** Defaults to global localStorage, or an in-memory map when that is missing. */
  localStorage?: LocalStorageLike;
  /**
   * Receives cross-document `storage` events. Defaults to `window`.
   * The writing instance does not emit this; the browser delivers it to peers.
   */
  storageEvents?: EventTarget | null;
};

type ChromeEvent = {
  addListener: (fn: Callback) => void;
  removeListener: (fn: Callback) => void;
  hasListener: (fn: Callback) => boolean;
  emit: (...args: unknown[]) => void;
  snapshot: () => Callback[];
};

function createEvent(): ChromeEvent {
  const listeners = new Set<Callback>();
  return {
    addListener(fn) {
      listeners.add(fn);
    },
    removeListener(fn) {
      listeners.delete(fn);
    },
    hasListener(fn) {
      return listeners.has(fn);
    },
    emit(...args) {
      for (const fn of [...listeners]) fn(...args);
    },
    snapshot() {
      return [...listeners];
    },
  };
}

function selectKeys(store: Store, keys: unknown): Store {
  if (keys == null) return { ...store };
  if (typeof keys === 'string') {
    return Object.prototype.hasOwnProperty.call(store, keys) ? { [keys]: store[keys] } : {};
  }
  if (Array.isArray(keys)) {
    const out: Store = {};
    for (const key of keys) {
      if (typeof key === 'string' && Object.prototype.hasOwnProperty.call(store, key)) {
        out[key] = store[key];
      }
    }
    return out;
  }
  if (typeof keys === 'object') {
    const defaults = keys as Store;
    const out: Store = { ...defaults };
    for (const key of Object.keys(defaults)) {
      if (Object.prototype.hasOwnProperty.call(store, key)) out[key] = store[key];
    }
    return out;
  }
  return {};
}

function browserLocal(storage?: LocalStorageLike): { read: () => Store; write: (next: Store) => void } {
  const backing: LocalStorageLike | null =
    storage ?? (typeof localStorage === 'undefined' ? null : localStorage);
  if (!backing) {
    let mem: Store = {};
    return {
      read: () => mem,
      write: (next) => {
        mem = next;
      },
    };
  }
  return {
    read: () => {
      try {
        const raw = backing.getItem(LOCAL_STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw) as unknown;
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Store) : {};
      } catch {
        return {};
      }
    },
    write: (next) => {
      // QuotaExceededError / SecurityError must escape so chrome.storage.set can reject.
      backing.setItem(LOCAL_STORAGE_KEY, JSON.stringify(next));
    },
  };
}

function openSessionDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const req = indexedDB.open(SESSION_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SESSION_STORE)) db.createObjectStore(SESSION_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

type AndroidChromeHost = {
  chrome?: Record<string, unknown>;
};

export function installAndroidChromeShim(options?: AndroidChromeShimOptions): void {
  const host = options?.host ?? (globalThis as unknown as AndroidChromeHost);
  const existingRuntime = host.chrome?.['runtime'] as { id?: string } | undefined;
  if (typeof existingRuntime?.id === 'string' && existingRuntime.id.length > 0) return;

  const local = browserLocal(options?.localStorage);
  const onChanged = createEvent();
  const onAlarm = createEvent();
  const onMessage = createEvent();
  const alarmTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const session = new Map<string, unknown>();
  let sessionDb: IDBDatabase | null = null;
  const sessionReady = openSessionDb().then(async (db) => {
    sessionDb = db;
    if (!db) return;
    await new Promise<void>((resolve) => {
      const tx = db.transaction(SESSION_STORE, 'readonly');
      const cursorReq = tx.objectStore(SESSION_STORE).openCursor();
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) return;
        session.set(String(cursor.key), cursor.value);
        cursor.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  });

  function persistSession(key: string, value: unknown): void {
    if (!sessionDb) return;
    const tx = sessionDb.transaction(SESSION_STORE, 'readwrite');
    const store = tx.objectStore(SESSION_STORE);
    if (value === undefined) store.delete(key);
    else store.put(value, key);
  }

  function currentDocumentPath(): string {
    if (
      typeof location === 'undefined' ||
      typeof location.pathname !== 'string' ||
      location.pathname.length === 0
    ) {
      return '/webapp.html';
    }
    return location.pathname.startsWith('/') ? location.pathname : `/${location.pathname}`;
  }

  const runtime = {
    id: 'astrym-android-webapp',
    lastError: undefined as { message: string } | undefined,
    getURL(path: string) {
      const normalized = path.startsWith('/') ? path : `/${path}`;
      // Path-absolute URLs keep SPP host assertExtensionOriginUrls / loadSppSdkFacade
      // happy (they refuse remote http(s) imports) while resolving same-origin.
      if (
        typeof location !== 'undefined' &&
        (location.protocol === 'http:' || location.protocol === 'https:')
      ) {
        return normalized;
      }
      const origin = typeof location !== 'undefined' ? location.origin : 'http://localhost';
      return new URL(normalized, origin).href;
    },
    sendMessage(...args: unknown[]) {
      const callback = typeof args[args.length - 1] === 'function' ? (args.pop() as Callback) : undefined;
      const message = args.find((arg) => arg !== null && typeof arg === 'object');
      const sender = { id: runtime.id, url: runtime.getURL(currentDocumentPath()) };

      const run = (): Promise<unknown> =>
        new Promise((resolve, reject) => {
          let pending = false;
          let settled = false;
          const finish = (response: unknown, isError: boolean) => {
            if (settled) return;
            settled = true;
            if (isError) {
              runtime.lastError = { message: NO_RESPONSE };
              reject(new Error(NO_RESPONSE));
              runtime.lastError = undefined;
              return;
            }
            runtime.lastError = undefined;
            resolve(response);
          };
          const sendResponse = (response: unknown) => {
            finish(response, false);
          };
          for (const listener of onMessage.snapshot()) {
            let ret: unknown;
            try {
              ret = listener(message, sender, sendResponse);
            } catch (cause) {
              reject(cause instanceof Error ? cause : new Error(String(cause)));
              return;
            }
            // MV3 / polyfill: async listeners return a Promise (or true + sendResponse).
            if (ret === true) {
              pending = true;
            } else if (ret != null && typeof (ret as { then?: unknown }).then === 'function') {
              pending = true;
              void Promise.resolve(ret).then(
                (value) => finish(value, false),
                (cause) => {
                  if (settled) return;
                  settled = true;
                  reject(cause instanceof Error ? cause : new Error(String(cause)));
                },
              );
            }
          }
          if (!pending && !settled) {
            finish(undefined, true);
          }
        });

      if (typeof callback === 'function') {
        void run().then(
          (response) => {
            runtime.lastError = undefined;
            callback(response);
          },
          (cause) => {
            runtime.lastError = {
              message: cause instanceof Error ? cause.message : NO_RESPONSE,
            };
            try {
              callback(undefined);
            } finally {
              runtime.lastError = undefined;
            }
          },
        );
        return undefined;
      }
      return run();
    },
    onMessage,
  };

  /**
   * MV3 / webextension-polyfill style: return a Promise when no callback is
   * provided. Callback-only shims break `await chrome.storage.local.get/set`
   * (SPP auto-prepare, gateway config) — await resolves to undefined and
   * prepare never publishes status (idle forever after Nym Connect).
   */
  function storageErrorMessage(err: unknown): string {
    return err instanceof Error ? err.message : 'storage write failed';
  }

  function deliverWrite(run: Promise<void>, callback?: Callback): Promise<void> | undefined {
    if (typeof callback !== 'function') return run;
    void run.then(
      () => {
        runtime.lastError = undefined;
        callback();
      },
      (err: unknown) => {
        runtime.lastError = { message: storageErrorMessage(err) };
        try {
          callback();
        } finally {
          runtime.lastError = undefined;
        }
      },
    );
    return undefined;
  }

  function parseLocalBlob(raw: string | null): { ok: true; store: Store } | { ok: false } {
    if (!raw) return { ok: true, store: {} };
    try {
      const value = JSON.parse(raw) as unknown;
      if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false };
      return { ok: true, store: value as Store };
    } catch {
      return { ok: false };
    }
  }

  function publishForeignLocal(oldRaw: string | null, newRaw: string | null): void {
    const previous = parseLocalBlob(oldRaw);
    const next = parseLocalBlob(newRaw);
    if (!previous.ok || !next.ok) {
      onChanged.emit(
        { [NYM_PRIVACY_PREFERENCE_STORAGE_KEY]: { oldValue: undefined, newValue: undefined } },
        'local',
      );
      return;
    }
    const keys = new Set([...Object.keys(previous.store), ...Object.keys(next.store)]);
    const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
    for (const key of keys) {
      if (!Object.is(previous.store[key], next.store[key])) {
        changes[key] = { oldValue: previous.store[key], newValue: next.store[key] };
      }
    }
    if (Object.keys(changes).length > 0) onChanged.emit(changes, 'local');
  }

  const storageEvents =
    options?.storageEvents === undefined
      ? typeof window !== 'undefined'
        ? window
        : null
      : options.storageEvents;
  if (storageEvents && typeof storageEvents.addEventListener === 'function') {
    storageEvents.addEventListener('storage', (event) => {
      const record = event as Event & {
        key?: string | null;
        oldValue?: string | null;
        newValue?: string | null;
      };
      // localStorage.clear() delivers key === null and no per-key diff.
      if (record.key === null) {
        onChanged.emit(
          {
            [NYM_PRIVACY_PREFERENCE_STORAGE_KEY]: {
              oldValue: undefined,
              newValue: undefined,
            },
          },
          'local',
        );
        return;
      }
      if (record.key !== LOCAL_STORAGE_KEY) return;
      publishForeignLocal(record.oldValue ?? null, record.newValue ?? null);
    });
  }

  function area(kind: 'local' | 'session') {
    return {
      get(keys?: unknown, callback?: Callback) {
        const run = (): Promise<Store> =>
          new Promise((resolve) => {
            const finish = (result: Store) => {
              runtime.lastError = undefined;
              resolve(result);
            };
            if (kind === 'local') {
              queueMicrotask(() => finish(selectKeys(local.read(), keys ?? null)));
              return;
            }
            void sessionReady.then(() =>
              finish(selectKeys(Object.fromEntries(session), keys ?? null)),
            );
          });
        if (typeof callback === 'function') {
          void run().then((result) => callback(result));
          return undefined;
        }
        return run();
      },
      set(items: Store, callback?: Callback) {
        const run = (): Promise<void> =>
          new Promise((resolve, reject) => {
            const apply = () => {
              try {
                const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
                if (kind === 'local') {
                  const current = local.read();
                  const next = { ...current };
                  for (const [key, value] of Object.entries(items)) {
                    changes[key] = { oldValue: current[key], newValue: value };
                    next[key] = value;
                  }
                  local.write(next);
                } else {
                  for (const [key, value] of Object.entries(items)) {
                    changes[key] = { oldValue: session.get(key), newValue: value };
                    session.set(key, value);
                    persistSession(key, value);
                  }
                }
                runtime.lastError = undefined;
                onChanged.emit(changes, kind);
                resolve();
              } catch (err) {
                reject(err instanceof Error ? err : new Error(storageErrorMessage(err)));
              }
            };
            if (kind === 'local') queueMicrotask(apply);
            else void sessionReady.then(apply, reject);
          });
        return deliverWrite(run(), callback);
      },
      remove(keys: string | string[], callback?: Callback) {
        const list = Array.isArray(keys) ? keys : [keys];
        const run = (): Promise<void> =>
          new Promise((resolve, reject) => {
            const apply = () => {
              try {
                const changes: Record<string, { oldValue?: unknown }> = {};
                if (kind === 'local') {
                  const current = local.read();
                  const next = { ...current };
                  for (const key of list) {
                    changes[key] = { oldValue: current[key] };
                    delete next[key];
                  }
                  local.write(next);
                } else {
                  for (const key of list) {
                    changes[key] = { oldValue: session.get(key) };
                    session.delete(key);
                    persistSession(key, undefined);
                  }
                }
                runtime.lastError = undefined;
                onChanged.emit(changes, kind);
                resolve();
              } catch (err) {
                reject(err instanceof Error ? err : new Error(storageErrorMessage(err)));
              }
            };
            if (kind === 'local') queueMicrotask(apply);
            else void sessionReady.then(apply, reject);
          });
        return deliverWrite(run(), callback);
      },
    };
  }

  host.chrome = {
    runtime,
    storage: {
      local: area('local'),
      session: area('session'),
      onChanged,
    },
    alarms: {
      create(name: string, info: { when?: number; delayInMinutes?: number } | undefined, callback?: Callback) {
        const previous = alarmTimers.get(name);
        if (previous) clearTimeout(previous);
        const when = typeof info?.when === 'number'
          ? info.when
          : Date.now() + (info?.delayInMinutes ?? 0) * 60_000;
        const delay = Math.max(0, when - Date.now());
        const handle = setTimeout(() => {
          alarmTimers.delete(name);
          onAlarm.emit({ name });
        }, delay);
        alarmTimers.set(name, handle);
        runtime.lastError = undefined;
        callback?.();
      },
      clear(name: string, callback?: Callback) {
        const handle = alarmTimers.get(name);
        if (handle) clearTimeout(handle);
        alarmTimers.delete(name);
        runtime.lastError = undefined;
        callback?.(Boolean(handle));
      },
      onAlarm,
    },
    notifications: {
      create(notificationId: string, _options: unknown, callback?: Callback) {
        runtime.lastError = undefined;
        callback?.(notificationId);
      },
    },
  } as Record<string, unknown>;
}
