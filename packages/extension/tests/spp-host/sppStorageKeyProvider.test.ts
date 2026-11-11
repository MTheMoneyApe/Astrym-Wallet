import { afterEach, describe, expect, it, vi } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import { hashSep53Message } from '@solanym/wallet-core/src/stellar/spp/sep53.js';
import { SPP_STORAGE_DATABASE_ID, SPP_STORAGE_UNLOCK_RECORD_KEY } from '@solanym/wallet-core/src/stellar/spp/sppStorageUnlockGate.js';
import { openSppEncryptedStorage } from '../../src/spp-host/sppStorageKeyProvider.js';

const SEED = new Uint8Array(32).fill(23);
const KEYPAIR = Keypair.fromRawEd25519Seed(Buffer.from(SEED));
const ACCOUNT = KEYPAIR.publicKey();
const ORIGIN = 'chrome-extension://peanjgnchnfcfaclipankhfkligmlklc';
const APPROVAL = '7c1d5f52-8f9d-4b0a-8e3b-76d7b8b7e4d1';

function asyncEntries(entries: Array<[string, unknown]> = []) {
  return {
    async *entries() {
      for (const entry of entries) yield entry;
    },
  };
}

function fakeLockManager() {
  let queue = Promise.resolve();
  return {
    request: async (_name: string, options: { mode: string }, callback: () => Promise<unknown>) => {
      expect(options.mode).toBe('exclusive');
      const previous = queue;
      let release!: () => void;
      queue = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      try {
        return await callback();
      } finally {
        release();
      }
    },
  };
}

function fixture() {
  const values = new Map<string, string>();
  let failCompletedRecordWrite = false;
  const records = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (failCompletedRecordWrite && JSON.parse(value).pending === false) {
        throw new Error('storage metadata quota failure');
      }
      values.set(key, value);
    },
  };
  const directory = asyncEntries();
  vi.stubGlobal('navigator', {
    locks: fakeLockManager(),
    storage: { getDirectory: async () => directory },
  });
  vi.stubGlobal('location', { origin: ORIGIN });
  vi.stubGlobal('localStorage', records);
  const confirmUnlock = vi.fn(async () => true);
  const sendMessage = vi.fn(async () => ({
    payload: { approved: true, approvalToken: APPROVAL },
  }));
  vi.stubGlobal('chrome', { runtime: { sendMessage } });
  const signatures: string[] = [];
  const signer = {
    signStorageUnlockMessage: vi.fn(async (message: string) => {
      signatures.push(message);
      return {
        signedMessage: Buffer.from(KEYPAIR.sign(Buffer.from(hashSep53Message(message)))).toString('base64'),
        signerAddress: ACCOUNT,
      };
    }),
  };
  let databaseKey: Uint8Array | null = null;
  const opened: Array<{ createNew: boolean; key: Uint8Array }> = [];
  const storage = { fork: () => storage, call: async () => null, close: vi.fn(async () => undefined) };
  const storageOpen = vi.fn(async (options: {
    workerUrl?: string;
    createNew?: boolean;
    keyProvider: (databaseId: string, purpose: 'create' | 'open') => Promise<Uint8Array>;
  }) => {
    const createNew = options.createNew === true;
    const key = new Uint8Array(await options.keyProvider(
      SPP_STORAGE_DATABASE_ID,
      createNew ? 'create' : 'open',
    ));
    opened.push({ createNew, key: new Uint8Array(key) });
    if (databaseKey) expect(key).toEqual(databaseKey);
    else databaseKey = new Uint8Array(key);
    return storage as never;
  });
  return { values, sendMessage, signer, signatures, storageOpen, opened, storage, confirmUnlock, failCompletedRecordWrite: (value: boolean) => { failCompletedRecordWrite = value; } };
}

afterEach(() => vi.unstubAllGlobals());

describe('openSppEncryptedStorage', () => {
  it('creates a random encrypted envelope, opens once and reopens with the same key', async () => {
    const f = fixture();
    const first = await openSppEncryptedStorage({
      storageOpen: f.storageOpen as never,
      workerUrl: `${ORIGIN}/spp/dist/workers/storage-worker.js`,
      signer: f.signer,
      activeStellarAddress: ACCOUNT,
      prepareGeneration: 10,
      confirmUnlock: f.confirmUnlock,
    });
    expect(first).toBe(f.storage);
    expect(f.storageOpen).toHaveBeenCalledOnce();
    expect(f.opened[0]!.createNew).toBe(true);
    expect(f.opened[0]!.key).toHaveLength(32);
    const record = JSON.parse(f.values.get(SPP_STORAGE_UNLOCK_RECORD_KEY)!);
    expect(record.pending).toBe(false);
    expect(record.address).toBe(ACCOUNT);
    expect(record.origin).toBe(ORIGIN);
    expect(record.iv).toBeTruthy();
    expect(record.envelope).toBeTruthy();
    expect(record.envelope).not.toContain(Buffer.from(f.opened[0]!.key).toString('base64'));
    expect(f.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'SPP_AUTHORIZE_STORAGE_UNLOCK',
      payload: expect.objectContaining({ uses: 2, prepareGeneration: 10 }),
    }));
    expect(f.signer.signStorageUnlockMessage).toHaveBeenCalledTimes(2);
    expect(f.signatures[0]).toBe(f.signatures[1]);

    await openSppEncryptedStorage({
      storageOpen: f.storageOpen as never,
      workerUrl: `${ORIGIN}/spp/dist/workers/storage-worker.js`,
      signer: f.signer,
      activeStellarAddress: ACCOUNT,
      prepareGeneration: 11,
      confirmUnlock: f.confirmUnlock,
    });
    expect(f.opened[1]!.createNew).toBe(false);
    expect(f.opened[1]!.key).toEqual(f.opened[0]!.key);
    expect(f.sendMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ uses: 1, prepareGeneration: 11 }),
    }));
    expect(f.signer.signStorageUnlockMessage).toHaveBeenCalledTimes(3);
  });

  it('closes the worker when final metadata persistence fails and can recover pending creation', async () => {
    const f = fixture();
    f.failCompletedRecordWrite(true);
    await expect(openSppEncryptedStorage({
      storageOpen: f.storageOpen as never,
      workerUrl: `${ORIGIN}/spp/dist/workers/storage-worker.js`,
      signer: f.signer,
      activeStellarAddress: ACCOUNT,
      prepareGeneration: 15,
      confirmUnlock: f.confirmUnlock,
    })).rejects.toThrow(/metadata quota failure/);
    expect(f.storage.close).toHaveBeenCalledOnce();
    expect(JSON.parse(f.values.get(SPP_STORAGE_UNLOCK_RECORD_KEY)!).pending).toBe(true);
    const key = f.opened[0]!.key;

    f.failCompletedRecordWrite(false);
    await openSppEncryptedStorage({
      storageOpen: f.storageOpen as never,
      workerUrl: `${ORIGIN}/spp/dist/workers/storage-worker.js`,
      signer: f.signer,
      activeStellarAddress: ACCOUNT,
      prepareGeneration: 16,
      confirmUnlock: f.confirmUnlock,
    });
    expect(f.opened[1]!.key).toEqual(key);
    expect(JSON.parse(f.values.get(SPP_STORAGE_UNLOCK_RECORD_KEY)!).pending).toBe(false);
  });

  it('does not sign or open storage when the user cancels', async () => {
    const f = fixture();
    await expect(openSppEncryptedStorage({
      storageOpen: f.storageOpen as never,
      workerUrl: `${ORIGIN}/spp/dist/workers/storage-worker.js`,
      signer: f.signer,
      activeStellarAddress: ACCOUNT,
      prepareGeneration: 12,
      confirmUnlock: async () => false,
    })).rejects.toMatchObject({ code: 'unlock-cancelled' });
    expect(f.sendMessage).not.toHaveBeenCalled();
    expect(f.signer.signStorageUnlockMessage).not.toHaveBeenCalled();
    expect(f.storageOpen).not.toHaveBeenCalled();
    expect(f.values.size).toBe(0);
  });

  it('preserves an OPFS database when the unlock metadata is missing', async () => {
    const f = fixture();
    vi.stubGlobal('navigator', {
      locks: fakeLockManager(),
      storage: {
        getDirectory: async () => asyncEntries([
          ['.opfs-sahpool-encrypted', { kind: 'directory', entries: asyncEntries([['data.db', {}]]) }],
        ]),
      },
    });
    await expect(openSppEncryptedStorage({
      storageOpen: f.storageOpen as never,
      workerUrl: `${ORIGIN}/spp/dist/workers/storage-worker.js`,
      signer: f.signer,
      activeStellarAddress: ACCOUNT,
      prepareGeneration: 13,
      confirmUnlock: f.confirmUnlock,
    })).rejects.toMatchObject({ code: 'storage-recovery-required' });
    expect(f.storageOpen).not.toHaveBeenCalled();
    expect(f.signer.signStorageUnlockMessage).not.toHaveBeenCalled();
  });

  it('refuses an active account different from the enrolled storage owner', async () => {
    const f = fixture();
    f.values.set(SPP_STORAGE_UNLOCK_RECORD_KEY, JSON.stringify({
      version: 1,
      address: ACCOUNT,
      origin: ORIGIN,
      salt: Buffer.alloc(32, 1).toString('base64'),
      iv: Buffer.alloc(12, 1).toString('base64'),
      envelope: Buffer.alloc(48, 1).toString('base64'),
      pending: false,
    }));
    await expect(openSppEncryptedStorage({
      storageOpen: f.storageOpen as never,
      workerUrl: `${ORIGIN}/spp/dist/workers/storage-worker.js`,
      signer: f.signer,
      activeStellarAddress: Keypair.fromRawEd25519Seed(Buffer.from(new Uint8Array(32).fill(24))).publicKey(),
      prepareGeneration: 14,
      confirmUnlock: f.confirmUnlock,
    })).rejects.toThrow(/Switch to the Stellar account/);
    expect(f.storageOpen).not.toHaveBeenCalled();
    expect(f.signer.signStorageUnlockMessage).not.toHaveBeenCalled();
  });
});
