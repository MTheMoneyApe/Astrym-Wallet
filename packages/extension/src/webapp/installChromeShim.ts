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

const LOCAL_STORAGE_KEY = 'astrym.chrome.storage.local.v1';
const SESSION_DB = 'astrym-chrome-session';
const SESSION_STORE = 'kv';
const NO_RESPONSE = 'The message port closed before a response was received.';

type Callback = (...args: unknown[]) => unknown;
type Store = Record<string, unknown>;

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

function browserLocal(): { read: () => Store; write: (next: Store) => void } {
  if (typeof localStorage === 'undefined') {
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
        const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw) as unknown;
        return parsed && typeof parsed === 'object' ? (parsed as Store) : {};
      } catch {
        return {};
      }
    },
    write: (next) => {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(next));
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

export function installAndroidChromeShim(): void {
  const host = globalThis as unknown as AndroidChromeHost;
  const existingRuntime = host.chrome?.['runtime'] as { id?: string } | undefined;
  if (typeof existingRuntime?.id === 'string' && existingRuntime.id.length > 0) return;

  const local = browserLocal();
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

  const runtime = {
    id: 'astrym-android-webapp',
    lastError: undefined as { message: string } | undefined,
    getURL(path: string) {
      const normalized = path.startsWith('/') ? path : `/${path}`;
      const origin = typeof location !== 'undefined' ? location.origin : 'http://localhost';
      return new URL(normalized, origin).href;
    },
    sendMessage(...args: unknown[]) {
      const callback = typeof args[args.length - 1] === 'function' ? (args.pop() as Callback) : undefined;
      const message = args.find((arg) => arg !== null && typeof arg === 'object');
      const sender = { id: runtime.id, url: runtime.getURL('/webapp.html') };
      let pending = false;
      let settled = false;
      const sendResponse = (response: unknown) => {
        if (settled) return;
        settled = true;
        runtime.lastError = undefined;
        try {
          callback?.(response);
        } finally {
          runtime.lastError = undefined;
        }
      };
      for (const listener of onMessage.snapshot()) {
        const ret = listener(message, sender, sendResponse);
        if (ret === true) pending = true;
      }
      if (!pending && !settled) {
        runtime.lastError = { message: NO_RESPONSE };
        try {
          callback?.(undefined);
        } finally {
          runtime.lastError = undefined;
        }
      }
    },
    onMessage,
  };

  function area(kind: 'local' | 'session') {
    return {
      get(keys: unknown, callback?: Callback) {
        const done = (result: Store) => {
          runtime.lastError = undefined;
          callback?.(result);
        };
        if (kind === 'local') {
          queueMicrotask(() => done(selectKeys(local.read(), keys)));
          return;
        }
        void sessionReady.then(() => done(selectKeys(Object.fromEntries(session), keys)));
      },
      set(items: Store, callback?: Callback) {
        const apply = () => {
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
          callback?.();
        };
        if (kind === 'local') queueMicrotask(apply);
        else void sessionReady.then(apply);
      },
      remove(keys: string | string[], callback?: Callback) {
        const list = Array.isArray(keys) ? keys : [keys];
        const apply = () => {
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
          callback?.();
        };
        if (kind === 'local') queueMicrotask(apply);
        else void sessionReady.then(apply);
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
