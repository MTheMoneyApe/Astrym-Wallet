import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StrKey, type IUncertainSubmissionStorage, type UncertainTxSessionFlag } from '@solanym/wallet-core';
import { StateCoordinator } from '../../src/background/StateCoordinator.js';
import {
  createStellarSubmissionLifecycle,
  restoreUncertainSubmission,
} from '../../src/background/uncertainSubmissionLifecycle.js';
import {
  ChromeUncertainSubmissionStorage,
  type UncertainSubmissionStorageArea,
} from '../../src/background/storage/ChromeUncertainSubmissionStorage.js';

vi.mock('webextension-polyfill', () => ({
  default: {
    storage: { local: { get: vi.fn().mockResolvedValue({}) } },
  },
}));

function createRecord(status: UncertainTxSessionFlag['status'] = 'SUBMITTING'): UncertainTxSessionFlag {
  return {
    schemaVersion: 1,
    txHash: 'a'.repeat(64),
    accountIndex: 0,
    sourceAddress: StrKey.encodeEd25519PublicKey(new Uint8Array(32).fill(1)),
    destinationAddress: StrKey.encodeEd25519PublicKey(new Uint8Array(32).fill(2)),
    amountXlm: '1.0000000',
    approvedFeeStroops: 100,
    expectedSequence: '123',
    maxTime: 0,
    submittedAt: Date.now(),
    lastProbeAt: Date.now(),
    status,
  };
}

function createArea(initial: Record<string, unknown> = {}) {
  const store = new Map(Object.entries(initial));
  const area: UncertainSubmissionStorageArea = {
    get: vi.fn(async (key) => store.has(key) ? { [key]: store.get(key) } : {}),
    set: vi.fn(async (items) => {
      for (const [key, value] of Object.entries(items)) store.set(key, value);
    }),
    remove: vi.fn(async (key) => {
      store.delete(key);
    }),
  };
  return { area, store };
}

describe('ChromeUncertainSubmissionStorage', () => {
  it('stores and reads the strict non-secret uncertainty flag in durable storage', async () => {
    const { area } = createArea();
    const storage = new ChromeUncertainSubmissionStorage(area);
    const record = createRecord();

    await storage.save(record);

    expect(await storage.load()).toEqual(record);
    expect(area.set).toHaveBeenCalledWith({ solanym_uncertain_tx_v1: record });
  });

  it('restores a durable record using a new storage adapter instance', async () => {
    const { area } = createArea();
    const record = createRecord();
    const firstInstance = new ChromeUncertainSubmissionStorage(area);
    await firstInstance.save(record);

    const coordinator = new StateCoordinator();
    await coordinator.initializeHolistic(true, true, false);
    coordinator.setUnlocked();
    const restartedInstance = new ChromeUncertainSubmissionStorage(area);
    expect(await restoreUncertainSubmission(restartedInstance, coordinator)).toBe(true);
    expect(coordinator.getUncertainContext()).toEqual({
      accountIndex: record.accountIndex,
      txHash: record.txHash,
    });
    expect(() => coordinator.authorizeSignature()).toThrow(/UNCERTAIN_TRANSACTION/);
  });

  it('copies a surviving session record to durable storage and verifies it before removing legacy data', async () => {
    const record = createRecord();
    const { area: durableArea, store: durableStore } = createArea();
    const { area: legacyArea, store: legacyStore } = createArea({
      solanym_uncertain_tx_v1: record,
    });
    const storage = new ChromeUncertainSubmissionStorage(durableArea, legacyArea);

    await expect(storage.load()).resolves.toEqual(record);
    expect(durableStore.get('solanym_uncertain_tx_v1')).toEqual(record);
    expect(legacyStore.has('solanym_uncertain_tx_v1')).toBe(false);
  });

  it('preserves the legacy record when durable migration cannot be verified', async () => {
    const record = createRecord();
    const { area: durableArea } = createArea();
    const { area: legacyArea, store: legacyStore } = createArea({
      solanym_uncertain_tx_v1: record,
    });
    vi.mocked(durableArea.set).mockRejectedValueOnce(new Error('durable write failed'));
    const storage = new ChromeUncertainSubmissionStorage(durableArea, legacyArea);

    await expect(storage.load()).rejects.toThrow('durable write failed');
    expect(legacyStore.get('solanym_uncertain_tx_v1')).toEqual(record);
  });

  it('preserves the legacy record when durable read-back does not match', async () => {
    const record = createRecord();
    const { area: durableArea } = createArea();
    const { area: legacyArea, store: legacyStore } = createArea({
      solanym_uncertain_tx_v1: record,
    });
    vi.mocked(durableArea.set).mockResolvedValueOnce(undefined);
    const storage = new ChromeUncertainSubmissionStorage(durableArea, legacyArea);

    await expect(storage.load()).rejects.toThrow('failed verification');
    expect(legacyStore.get('solanym_uncertain_tx_v1')).toEqual(record);
    expect(legacyArea.remove).not.toHaveBeenCalled();
  });

  it('fails closed and preserves the legacy record when migration reads fail', async () => {
    const record = createRecord();
    const { area: durableArea } = createArea();
    const { area: legacyArea, store: legacyStore } = createArea({
      solanym_uncertain_tx_v1: record,
    });
    vi.mocked(legacyArea.get).mockRejectedValueOnce(new Error('legacy read failed'));
    const storage = new ChromeUncertainSubmissionStorage(durableArea, legacyArea);

    await expect(storage.load()).rejects.toThrow('legacy read failed');
    expect(legacyStore.get('solanym_uncertain_tx_v1')).toEqual(record);
    expect(durableArea.set).not.toHaveBeenCalled();
  });

  it('fails closed if the legacy record cannot be removed after durable verification', async () => {
    const record = createRecord();
    const { area: durableArea, store: durableStore } = createArea();
    const { area: legacyArea, store: legacyStore } = createArea({
      solanym_uncertain_tx_v1: record,
    });
    vi.mocked(legacyArea.remove).mockRejectedValueOnce(new Error('legacy removal failed'));
    const storage = new ChromeUncertainSubmissionStorage(durableArea, legacyArea);

    await expect(storage.load()).rejects.toThrow('legacy removal failed');
    expect(durableStore.get('solanym_uncertain_tx_v1')).toEqual(record);
    expect(legacyStore.get('solanym_uncertain_tx_v1')).toEqual(record);
  });

  it('fails closed when durable and legacy records conflict', async () => {
    const durableRecord = createRecord();
    const legacyRecord = { ...createRecord(), txHash: 'b'.repeat(64) };
    const { area: durableArea, store: durableStore } = createArea({
      solanym_uncertain_tx_v1: durableRecord,
    });
    const { area: legacyArea, store: legacyStore } = createArea({
      solanym_uncertain_tx_v1: legacyRecord,
    });
    const storage = new ChromeUncertainSubmissionStorage(durableArea, legacyArea);

    await expect(storage.load()).rejects.toThrow('conflict');
    expect(durableStore.get('solanym_uncertain_tx_v1')).toEqual(durableRecord);
    expect(legacyStore.get('solanym_uncertain_tx_v1')).toEqual(legacyRecord);
  });

  it('fails closed when the durable read fails', async () => {
    const { area } = createArea();
    vi.mocked(area.get).mockRejectedValueOnce(new Error('storage unavailable'));
    const storage = new ChromeUncertainSubmissionStorage(area);

    await expect(storage.load()).rejects.toThrow('storage unavailable');
  });

  it('rejects malformed or unexpected persisted records', async () => {
    const { area } = createArea({ solanym_uncertain_tx_v1: { status: 'SUBMITTING', signedXdr: 'secret' } });
    const storage = new ChromeUncertainSubmissionStorage(area);

    await expect(storage.load()).rejects.toThrow('malformed');
  });

  it('does not overwrite an existing uncertain record', async () => {
    const record = createRecord();
    const { area } = createArea({ solanym_uncertain_tx_v1: record });
    const storage = new ChromeUncertainSubmissionStorage(area);

    await expect(storage.save(createRecord())).rejects.toThrow('already exists');
    expect(await storage.load()).toEqual(record);
    expect(area.set).not.toHaveBeenCalled();
  });

  it('clears durable and legacy copies before resolving', async () => {
    const record = createRecord();
    const { area: durableArea, store: durableStore } = createArea({
      solanym_uncertain_tx_v1: record,
    });
    const { area: legacyArea, store: legacyStore } = createArea({
      solanym_uncertain_tx_v1: record,
    });
    const storage = new ChromeUncertainSubmissionStorage(durableArea, legacyArea);

    await storage.clear();

    expect(durableStore.has('solanym_uncertain_tx_v1')).toBe(false);
    expect(legacyStore.has('solanym_uncertain_tx_v1')).toBe(false);
  });
});

describe('uncertain submission lifecycle', () => {
  let coordinator: StateCoordinator;
  let record: UncertainTxSessionFlag;

  beforeEach(async () => {
    coordinator = new StateCoordinator();
    await coordinator.initializeHolistic(true, true, false);
    coordinator.setUnlocked();
    record = createRecord();
  });

  it('restores a persisted SUBMITTING record as uncertain before signing', async () => {
    const sendXlm = vi.fn();
    const storage: IUncertainSubmissionStorage = {
      load: vi.fn().mockResolvedValue(record),
      save: vi.fn(),
      clear: vi.fn(),
    };

    expect(await restoreUncertainSubmission(storage, coordinator)).toBe(true);
    expect(coordinator.getUncertainContext()).toEqual({
      accountIndex: record.accountIndex,
      txHash: record.txHash,
    });
    expect(() => coordinator.authorizeSignature()).toThrow(/UNCERTAIN_TRANSACTION/);
    expect(sendXlm).not.toHaveBeenCalled();
  });

  it('fails closed when the stored uncertainty record cannot be interpreted', async () => {
    const storage: IUncertainSubmissionStorage = {
      load: vi.fn().mockRejectedValue(new Error('malformed record')),
      save: vi.fn(),
      clear: vi.fn(),
    };

    expect(await restoreUncertainSubmission(storage, coordinator)).toBe(false);
    expect(coordinator.state).toBe('ERROR_STATE');
    expect(() => coordinator.authorizeSignature()).toThrow(/ERROR_STATE/);
  });

  it('keeps signing blocked when clearing persistent uncertainty fails', async () => {
    const storage: IUncertainSubmissionStorage = {
      load: vi.fn().mockResolvedValue(record),
      save: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockRejectedValue(new Error('remove failed')),
    };
    const lifecycle = createStellarSubmissionLifecycle(storage, coordinator);

    await lifecycle.beforeDispatch(record);
    await expect(lifecycle.resolve(record)).rejects.toThrow('remove failed');

    expect(coordinator.getUncertainContext()?.txHash).toBe(record.txHash);
    expect(() => coordinator.authorizeSignature()).toThrow(/UNCERTAIN_TRANSACTION/);
  });

  it('retains the saved record and enters ERROR_STATE if lock acquisition fails', async () => {
    coordinator.enterErrorState();
    const storage: IUncertainSubmissionStorage = {
      load: vi.fn().mockResolvedValue(null),
      save: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn(),
    };
    const lifecycle = createStellarSubmissionLifecycle(storage, coordinator);

    await expect(lifecycle.beforeDispatch(record)).rejects.toThrow(/ERROR_STATE/);
    expect(storage.save).toHaveBeenCalledWith(record);
    expect(coordinator.state).toBe('ERROR_STATE');
  });

  it('preserves the existing record and coordinator context when a second record is rejected', async () => {
    const existing = createRecord();
    const candidate = { ...createRecord(), txHash: 'b'.repeat(64) };
    const { area } = createArea({ solanym_uncertain_tx_v1: existing });
    const storage = new ChromeUncertainSubmissionStorage(area);
    const lifecycle = createStellarSubmissionLifecycle(storage, coordinator);
    coordinator.enterUncertainTransaction(existing.accountIndex, existing.txHash);

    await expect(lifecycle.beforeDispatch(candidate)).rejects.toThrow('already exists');

    expect(await storage.load()).toEqual(existing);
    expect(area.set).not.toHaveBeenCalled();
    expect(coordinator.getUncertainContext()).toEqual({
      accountIndex: existing.accountIndex,
      txHash: existing.txHash,
    });
  });
});
