import { describe, expect, it, vi } from 'vitest';

import {
  NymTransportPreferenceService,
  NYM_TRANSPORT_PREFERENCE_STORAGE_KEY,
  type NymTransportPreferenceStorageArea,
} from '../../../src/background/nym/NymTransportPreferenceService.js';

function fakeStorage(initial?: unknown): NymTransportPreferenceStorageArea & {
  values: Map<string, unknown>;
  failGet: boolean;
  failSet: boolean;
  getCalls: string[];
  setCalls: Array<Record<string, unknown>>;
} {
  const values = new Map<string, unknown>();
  if (initial !== undefined) values.set(NYM_TRANSPORT_PREFERENCE_STORAGE_KEY, initial);
  const storage = {
    values,
    failGet: false,
    failSet: false,
    getCalls: [] as string[],
    setCalls: [] as Array<Record<string, unknown>>,
    async get(key: string): Promise<Record<string, unknown>> {
      storage.getCalls.push(key);
      if (storage.failGet) throw new Error('raw storage read error');
      return values.has(key) ? { [key]: values.get(key) } : {};
    },
    async set(items: Record<string, unknown>): Promise<void> {
      storage.setCalls.push(items);
      if (storage.failSet) throw new Error('raw storage write error');
      for (const [key, value] of Object.entries(items)) values.set(key, value);
    },
  };
  return storage;
}

const validNymRecord = { version: 1, preferredMode: 'nym' };
const validDirectRecord = { version: 1, preferredMode: 'direct' };

describe('NymTransportPreferenceService', () => {
  it('returns loaded and unselected when the storage key is missing', async () => {
    const service = new NymTransportPreferenceService(fakeStorage());

    await expect(service.load()).resolves.toEqual({
      preferenceLoaded: true,
      preferredMode: null,
      preferenceError: null,
    });
  });

  it('restores a valid Nym preference', async () => {
    const service = new NymTransportPreferenceService(fakeStorage(validNymRecord));

    await expect(service.load()).resolves.toEqual({
      preferenceLoaded: true,
      preferredMode: 'nym',
      preferenceError: null,
    });
  });

  it('restores a valid Direct preference', async () => {
    const service = new NymTransportPreferenceService(fakeStorage(validDirectRecord));

    await expect(service.load()).resolves.toEqual({
      preferenceLoaded: true,
      preferredMode: 'direct',
      preferenceError: null,
    });
  });

  it('restores a selection persisted by a previous service instance', async () => {
    const storage = fakeStorage();
    const first = new NymTransportPreferenceService(storage);
    await first.setPreferredMode('direct');

    const second = new NymTransportPreferenceService(storage);
    await expect(second.load()).resolves.toEqual({
      preferenceLoaded: true,
      preferredMode: 'direct',
      preferenceError: null,
    });
  });

  it('rejects an unsupported schema version without deleting the stored value', async () => {
    const stored = { version: 2, preferredMode: 'nym' };
    const storage = fakeStorage(stored);
    const service = new NymTransportPreferenceService(storage);

    await expect(service.load()).resolves.toMatchObject({
      preferenceLoaded: false,
      preferredMode: null,
      preferenceError: 'INVALID_STORED_VALUE',
    });
    expect(storage.values.get(NYM_TRANSPORT_PREFERENCE_STORAGE_KEY)).toBe(stored);
    expect(storage.setCalls).toHaveLength(0);
  });

  it('rejects an invalid mode', async () => {
    const service = new NymTransportPreferenceService(
      fakeStorage({ version: 1, preferredMode: 'automatic' }),
    );

    await expect(service.load()).resolves.toMatchObject({
      preferenceLoaded: false,
      preferredMode: null,
      preferenceError: 'INVALID_STORED_VALUE',
    });
  });

  it.each([
    ['null', null],
    ['array', []],
    ['missing fields', { version: 1 }],
    ['extra fields', { version: 1, preferredMode: 'nym', extra: true }],
    ['wrong field type', { version: '1', preferredMode: 'nym' }],
  ])('rejects a malformed record (%s)', async (_label, stored) => {
    const service = new NymTransportPreferenceService(fakeStorage(stored));

    await expect(service.load()).resolves.toMatchObject({
      preferenceLoaded: false,
      preferredMode: null,
      preferenceError: 'INVALID_STORED_VALUE',
    });
  });

  it('rejects a present storage key with an undefined value', async () => {
    const storage = fakeStorage();
    storage.values.set(NYM_TRANSPORT_PREFERENCE_STORAGE_KEY, undefined);
    const service = new NymTransportPreferenceService(storage);

    await expect(service.load()).resolves.toEqual({
      preferenceLoaded: false,
      preferredMode: null,
      preferenceError: 'INVALID_STORED_VALUE',
    });
    expect(storage.values.has(NYM_TRANSPORT_PREFERENCE_STORAGE_KEY)).toBe(true);
    expect(storage.setCalls).toHaveLength(0);
  });

  it('repairs an invalid stored record after a successful explicit selection', async () => {
    const storage = fakeStorage({ version: 5, preferredMode: 'nym' });
    const service = new NymTransportPreferenceService(storage);
    await service.load();

    await expect(service.setPreferredMode('direct')).resolves.toEqual({
      preferenceLoaded: true,
      preferredMode: 'direct',
      preferenceError: null,
    });
    expect(storage.values.get(NYM_TRANSPORT_PREFERENCE_STORAGE_KEY)).toEqual(validDirectRecord);
  });

  it('recovers from a read failure after a successful explicit selection', async () => {
    const storage = fakeStorage();
    storage.failGet = true;
    const service = new NymTransportPreferenceService(storage);
    await service.load();

    storage.failGet = false;
    await expect(service.setPreferredMode('nym')).resolves.toEqual({
      preferenceLoaded: true,
      preferredMode: 'nym',
      preferenceError: null,
    });
    expect(storage.values.get(NYM_TRANSPORT_PREFERENCE_STORAGE_KEY)).toEqual(validNymRecord);
  });

  it('returns a sanitized read-failure state', async () => {
    const storage = fakeStorage();
    storage.failGet = true;
    const service = new NymTransportPreferenceService(storage);

    await expect(service.load()).resolves.toEqual({
      preferenceLoaded: false,
      preferredMode: null,
      preferenceError: 'STORAGE_READ_FAILED',
    });
    expect(JSON.stringify(service.getSnapshot())).not.toContain('raw storage');
  });

  it('does not report an attempted first-run selection after a write failure', async () => {
    const storage = fakeStorage();
    const service = new NymTransportPreferenceService(storage);
    await service.load();
    storage.failSet = true;

    await expect(service.setPreferredMode('direct')).resolves.toEqual({
      preferenceLoaded: true,
      preferredMode: null,
      preferenceError: 'STORAGE_WRITE_FAILED',
    });
  });

  it('preserves the previous successfully stored preference after a failed update', async () => {
    const storage = fakeStorage(validNymRecord);
    const service = new NymTransportPreferenceService(storage);
    await service.load();
    storage.failSet = true;

    await expect(service.setPreferredMode('direct')).resolves.toEqual({
      preferenceLoaded: true,
      preferredMode: 'nym',
      preferenceError: 'STORAGE_WRITE_FAILED',
    });
  });

  it('rejects an unsupported runtime mode without writing or changing the snapshot', async () => {
    const storage = fakeStorage(validNymRecord);
    const service = new NymTransportPreferenceService(storage);
    await service.load();
    const previousSnapshot = service.getSnapshot();

    await expect(
      // @ts-expect-error Runtime callers can pass unsupported values.
      service.setPreferredMode('automatic'),
    ).rejects.toThrow('Invalid transport mode');

    expect(storage.setCalls).toHaveLength(0);
    expect(storage.values.get(NYM_TRANSPORT_PREFERENCE_STORAGE_KEY)).toEqual(validNymRecord);
    expect(service.getSnapshot()).toEqual(previousSnapshot);
  });

  it('serializes concurrent selections in invocation order', async () => {
    const storage = fakeStorage();
    let releaseFirstWrite!: () => void;
    let markFirstWriteStarted!: () => void;
    const firstWriteStarted = new Promise<void>((resolve) => {
      markFirstWriteStarted = resolve;
    });
    const firstWriteGate = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve;
    });
    const baseSet = storage.set.bind(storage);
    const setSpy = vi.spyOn(storage, 'set').mockImplementation(async (items) => {
      if (storage.setCalls.length === 0) {
        markFirstWriteStarted();
        await firstWriteGate;
      }
      await baseSet(items);
    });
    const service = new NymTransportPreferenceService(storage);

    const first = service.setPreferredMode('nym');
    await firstWriteStarted;
    const second = service.setPreferredMode('direct');
    await Promise.resolve();
    expect(setSpy).toHaveBeenCalledTimes(1);

    releaseFirstWrite();
    await Promise.all([first, second]);

    expect(storage.setCalls).toEqual([
      { [NYM_TRANSPORT_PREFERENCE_STORAGE_KEY]: validNymRecord },
      { [NYM_TRANSPORT_PREFERENCE_STORAGE_KEY]: validDirectRecord },
    ]);
    expect(service.getSnapshot()).toEqual({
      preferenceLoaded: true,
      preferredMode: 'direct',
      preferenceError: null,
    });
  });

  it('serializes load before a later selection and reports both resulting states', async () => {
    const storage = fakeStorage(validNymRecord);
    let releaseRead!: () => void;
    let markReadStarted!: () => void;
    const readStarted = new Promise<void>((resolve) => {
      markReadStarted = resolve;
    });
    const readGate = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    const baseGet = storage.get.bind(storage);
    const getSpy = vi.spyOn(storage, 'get').mockImplementation(async (key) => {
      const result = await baseGet(key);
      markReadStarted();
      await readGate;
      return result;
    });
    const setSpy = vi.spyOn(storage, 'set');
    const service = new NymTransportPreferenceService(storage);

    const loadResult = service.load();
    await readStarted;
    const selectionResult = service.setPreferredMode('direct');
    await Promise.resolve();

    const setStartedBeforeReadRelease = setSpy.mock.calls.length > 0;
    releaseRead();
    expect(setStartedBeforeReadRelease).toBe(false);
    expect(getSpy).toHaveBeenCalledTimes(1);

    await expect(loadResult).resolves.toEqual({
      preferenceLoaded: true,
      preferredMode: 'nym',
      preferenceError: null,
    });
    await expect(selectionResult).resolves.toEqual({
      preferenceLoaded: true,
      preferredMode: 'direct',
      preferenceError: null,
    });

    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(storage.values.get(NYM_TRANSPORT_PREFERENCE_STORAGE_KEY)).toEqual(validDirectRecord);
    expect(service.getSnapshot()).toEqual({
      preferenceLoaded: true,
      preferredMode: 'direct',
      preferenceError: null,
    });
  });

  it('continues processing after a failed operation', async () => {
    const storage = fakeStorage();
    const service = new NymTransportPreferenceService(storage);
    storage.failSet = true;

    await expect(service.setPreferredMode('nym')).resolves.toMatchObject({
      preferenceError: 'STORAGE_WRITE_FAILED',
    });
    storage.failSet = false;
    await expect(service.setPreferredMode('direct')).resolves.toEqual({
      preferenceLoaded: true,
      preferredMode: 'direct',
      preferenceError: null,
    });
  });

  it('does not masquerade an in-memory selection as persistence', async () => {
    const storage = fakeStorage();
    const service = new NymTransportPreferenceService(storage);
    storage.failSet = true;

    await service.setPreferredMode('nym');
    storage.failSet = false;

    const restarted = new NymTransportPreferenceService(storage);
    await expect(restarted.load()).resolves.toEqual({
      preferenceLoaded: true,
      preferredMode: null,
      preferenceError: null,
    });
  });
});
