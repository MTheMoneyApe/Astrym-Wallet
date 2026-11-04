import type { NymTransportMode } from '@solanym/wallet-core/src/nym/NymTransportPolicy.js';

export const NYM_TRANSPORT_PREFERENCE_STORAGE_KEY = 'solanym_transport_preference_v1';

export type NymTransportPreferenceError =
  | 'STORAGE_READ_FAILED'
  | 'STORAGE_WRITE_FAILED'
  | 'INVALID_STORED_VALUE'
  | null;

export interface NymTransportPreferenceSnapshot {
  preferenceLoaded: boolean;
  preferredMode: NymTransportMode | null;
  preferenceError: NymTransportPreferenceError;
}

export interface NymTransportPreferenceStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

interface StoredPreference {
  version: 1;
  preferredMode: NymTransportMode;
}

const INITIAL_SNAPSHOT: NymTransportPreferenceSnapshot = {
  preferenceLoaded: false,
  preferredMode: null,
  preferenceError: null,
};

function isNymTransportMode(value: unknown): value is NymTransportMode {
  return value === 'nym' || value === 'direct';
}

function parseStoredPreference(raw: unknown): StoredPreference | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;

  const record = raw as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.length !== 2 ||
    !Object.prototype.hasOwnProperty.call(record, 'version') ||
    !Object.prototype.hasOwnProperty.call(record, 'preferredMode') ||
    record['version'] !== 1 ||
    !isNymTransportMode(record['preferredMode'])
  ) {
    return undefined;
  }

  return {
    version: 1,
    preferredMode: record['preferredMode'],
  };
}

export class NymTransportPreferenceService {
  private _snapshot: NymTransportPreferenceSnapshot = { ...INITIAL_SNAPSHOT };
  private _operationQueue: Promise<void> = Promise.resolve();

  constructor(private readonly _storage: NymTransportPreferenceStorageArea) {}

  getSnapshot(): NymTransportPreferenceSnapshot {
    return { ...this._snapshot };
  }

  load(): Promise<NymTransportPreferenceSnapshot> {
    return this._enqueue(async () => {
      try {
        const values = await this._storage.get(NYM_TRANSPORT_PREFERENCE_STORAGE_KEY);
        const hasStoredValue = Object.prototype.hasOwnProperty.call(
          values,
          NYM_TRANSPORT_PREFERENCE_STORAGE_KEY,
        );
        const parsed = hasStoredValue
          ? parseStoredPreference(values[NYM_TRANSPORT_PREFERENCE_STORAGE_KEY])
          : null;
        if (hasStoredValue && parsed === undefined) {
          this._snapshot = {
            preferenceLoaded: false,
            preferredMode: null,
            preferenceError: 'INVALID_STORED_VALUE',
          };
        } else {
          this._snapshot = {
            preferenceLoaded: true,
            preferredMode: parsed?.preferredMode ?? null,
            preferenceError: null,
          };
        }
      } catch {
        this._snapshot = {
          preferenceLoaded: false,
          preferredMode: null,
          preferenceError: 'STORAGE_READ_FAILED',
        };
      }
      return this.getSnapshot();
    });
  }

  setPreferredMode(mode: NymTransportMode): Promise<NymTransportPreferenceSnapshot> {
    return this._enqueue(async () => {
      if (!isNymTransportMode(mode)) {
        throw new Error('Invalid transport mode');
      }

      const previous = this.getSnapshot();
      const record: StoredPreference = { version: 1, preferredMode: mode };
      try {
        await this._storage.set({ [NYM_TRANSPORT_PREFERENCE_STORAGE_KEY]: record });
        this._snapshot = {
          preferenceLoaded: true,
          preferredMode: mode,
          preferenceError: null,
        };
      } catch {
        this._snapshot = {
          preferenceLoaded: previous.preferenceLoaded,
          preferredMode: previous.preferredMode,
          preferenceError: 'STORAGE_WRITE_FAILED',
        };
      }
      return this.getSnapshot();
    });
  }

  private _enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this._operationQueue.then(operation);
    this._operationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
