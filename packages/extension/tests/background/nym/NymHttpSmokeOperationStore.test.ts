import { describe, expect, it, vi } from 'vitest';

import {
  NymHttpSmokeOperationStore,
  type NymHttpSmokeOperationRecord,
  type NymHttpSmokeTerminalVerification,
} from '../../../src/background/nym/NymHttpSmokeOperationStore.js';
import {
  isAuthoritativeHttpSmokeStatus,
} from '../../../src/background/nym/OffscreenMixFetchBridge.js';
import type { NymOffscreenHttpSmokeOperationStatus } from '../../../src/nym-offscreen/protocol.js';
import { createOffscreenBridgeHarness } from './offscreenBridgeHarness.js';

const STORAGE_KEY = 'solanym_nym_http_smoke_operation_v1';

function memoryStorage() {
  const values = new Map<string, unknown>();
  return {
    get: async (key: string) => ({
      ...(values.has(key) ? { [key]: values.get(key) } : {}),
    }),
    set: async (items: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(items)) values.set(key, value);
    },
    seed: (key: string, value: unknown) => values.set(key, value),
    peek: (key: string) => values.get(key),
  };
}

function operation(
  index: number,
  state: NymHttpSmokeOperationRecord['state'] = 'pending',
): NymHttpSmokeOperationRecord {
  return {
    operationId: `operation-${index}`,
    runtimeGeneration: 'offscreen-generation',
    state,
    createdAt: index + 1,
    updatedAt: index + 1,
    callerTimedOut: state === 'timed_out_pending',
  };
}

async function authoritativeStatus(
  operationId: string,
  runtimeGeneration: string,
  state: 'pending' | 'completed' | 'failed' | 'unknown',
) {
  const bridge = createOffscreenBridgeHarness(async (request) => ({
        channel: 'nym-offscreen',
        id: request.id,
        ok: true,
        payload: { operationId, runtimeGeneration, state },
      }));
  const status = await bridge.queryHttpSmokeOperation(operationId, runtimeGeneration);
  if (!status) throw new Error('Test bridge did not return an authoritative status');
  return status;
}

function verification(
  record: NymHttpSmokeOperationRecord,
  terminalState: 'completed' | 'failed' = record.state === 'failed' ? 'failed' : 'completed',
): NymHttpSmokeTerminalVerification {
  return {
    schemaVersion: 2,
    operationId: record.operationId,
    runtimeGeneration: record.runtimeGeneration,
    terminalState,
    source: 'authoritative_offscreen_status',
    verifiedAt: record.updatedAt,
  };
}

describe('NymHttpSmokeOperationStore', () => {
  it('retains every unresolved operation even when their count exceeds terminal history', async () => {
    const storage = memoryStorage();
    const store = new NymHttpSmokeOperationStore(storage);
    const states: NymHttpSmokeOperationRecord['state'][] = [
      'pending',
      'timed_out_pending',
      'unknown',
    ];

    for (let index = 0; index < 15; index += 1) {
      await store.save(operation(index, states[index % states.length]));
    }

    const records = await store.loadAll();
    expect(records).toHaveLength(15);
    expect(records.map((record) => record.operationId)).toEqual(
      Array.from({ length: 15 }, (_unused, index) => `operation-${index}`),
    );
    expect(records.every((record) => record.state !== 'completed' && record.state !== 'failed'))
      .toBe(true);
  });

  it('prunes terminal history only and preserves all unresolved markers', async () => {
    const storage = memoryStorage();
    const store = new NymHttpSmokeOperationStore(storage);
    const unresolved = [
      operation(1, 'pending'),
      operation(2, 'timed_out_pending'),
      operation(3, 'unknown'),
    ];
    for (const record of unresolved) await store.save(record);

    for (let index = 10; index < 25; index += 1) {
      const pending = operation(index);
      await store.save(pending);
      const state = index % 2 === 0 ? 'completed' : 'failed';
      const terminal = { ...pending, state, updatedAt: index + 1 };
      await store.saveVerifiedTerminal(
        terminal,
        await authoritativeStatus(
          terminal.operationId,
          terminal.runtimeGeneration,
          state,
        ),
      );
    }

    const records = await store.loadAll();
    expect(
      records.filter(
        (record) =>
          record.state === 'pending' ||
          record.state === 'timed_out_pending' ||
          record.state === 'unknown',
      ).map((record) => record.operationId),
    ).toEqual(['operation-1', 'operation-2', 'operation-3']);
    const terminal = records.filter(
      (record) => record.state === 'completed' || record.state === 'failed',
    );
    expect(terminal).toHaveLength(10);
    expect(terminal.map((record) => record.operationId)).toEqual(
      Array.from({ length: 10 }, (_unused, index) => `operation-${index + 15}`),
    );
  });

  it('does not allow a generic save to overwrite an unresolved marker with terminal state', async () => {
    const store = new NymHttpSmokeOperationStore(memoryStorage());
    const pending = operation(1);
    await store.save(pending);

    await expect(
      store.save({ ...pending, state: 'failed' }),
    ).rejects.toThrow(/require verified runtime evidence/);
    const terminal = { ...pending, state: 'completed' as const };
    await expect(
      store.saveVerifiedTerminal(
        terminal,
        await authoritativeStatus(
          terminal.operationId,
          terminal.runtimeGeneration,
          'completed',
        ),
      ),
    ).resolves.toBeUndefined();
    expect((await store.loadAll())[0]).toMatchObject({
      operationId: pending.operationId,
      state: 'completed',
    });
  });

  it('removes only a known undispatched pending marker', async () => {
    const store = new NymHttpSmokeOperationStore(memoryStorage());
    const undispatched = operation(1);
    await store.save(undispatched);
    await store.save(operation(2, 'unknown'));

    await store.removeUndispatched(undispatched);
    await expect(store.removeUndispatched(operation(2, 'unknown'))).rejects.toThrow(
      /invalid undispatched/,
    );
    expect((await store.loadAll()).map((record) => record.operationId)).toEqual([
      'operation-2',
    ]);
  });

  it('refuses cleanup when the supplied creation or runtime identity differs', async () => {
    const store = new NymHttpSmokeOperationStore(memoryStorage());
    const pending = operation(3);
    await store.save(pending);

    await expect(
      store.removeUndispatched({ ...pending, createdAt: pending.createdAt + 1 }),
    ).rejects.toThrow(/mismatched identity/);
    await expect(
      store.removeUndispatched({
        ...pending,
        runtimeGeneration: 'different-generation',
      }),
    ).rejects.toThrow(/mismatched identity/);
    expect(await store.loadAll()).toEqual([pending]);
  });

  it('leaves the persisted unresolved marker intact when storage writes fail', async () => {
    const storage = memoryStorage();
    const store = new NymHttpSmokeOperationStore(storage);
    const pending = operation(1);
    await store.save(pending);
    vi.spyOn(storage, 'set').mockRejectedValueOnce(new Error('quota exceeded'));

    await expect(
      store.save({ ...pending, state: 'unknown', updatedAt: 2 }),
    ).rejects.toThrow('quota exceeded');
    expect(storage.peek(STORAGE_KEY)).toEqual([pending]);
  });

  it.each(['completed', 'failed'] as const)(
    'migrates a legacy %s record to unknown and persists it',
    async (state) => {
      const storage = memoryStorage();
      const legacy = operation(4, state);
      storage.seed(STORAGE_KEY, [legacy]);
      const store = new NymHttpSmokeOperationStore(storage);

      expect(await store.loadAll()).toEqual([{ ...legacy, state: 'unknown' }]);
      expect(storage.peek(STORAGE_KEY)).toEqual([{ ...legacy, state: 'unknown' }]);
    },
  );

  it('keeps a terminal record with matching authoritative verification', async () => {
    const storage = memoryStorage();
    const terminal = operation(5, 'completed');
    const verified = { ...terminal, verification: verification(terminal) };
    storage.seed(STORAGE_KEY, [verified]);

    expect(await new NymHttpSmokeOperationStore(storage).loadAll()).toEqual([verified]);
    expect(storage.peek(STORAGE_KEY)).toEqual([verified]);
  });

  it('migrates structurally valid pre-version provenance to unknown and preserves safe metadata', async () => {
    const storage = memoryStorage();
    const terminal = operation(27, 'completed');
    const { schemaVersion: _oldVersion, ...legacyVerification } = verification(terminal);
    expect(_oldVersion).toBe(2);
    const legacy = { ...terminal, verification: legacyVerification };
    storage.seed(STORAGE_KEY, [legacy]);

    const store = new NymHttpSmokeOperationStore(storage);
    expect(await store.loadAll()).toEqual([{ ...terminal, state: 'unknown' }]);
    expect(storage.peek(STORAGE_KEY)).toEqual([{ ...terminal, state: 'unknown' }]);
    expect(await store.loadAll()).toEqual([{ ...terminal, state: 'unknown' }]);
  });

  it.each([
    ['missing evidence', undefined],
    [
      'different operation ID',
      (record: NymHttpSmokeOperationRecord) => ({
        ...verification(record),
        operationId: 'other-operation',
      }),
    ],
    [
      'different runtime generation',
      (record: NymHttpSmokeOperationRecord) => ({
        ...verification(record),
        runtimeGeneration: 'other-generation',
      }),
    ],
    [
      'different terminal state',
      (record: NymHttpSmokeOperationRecord) => ({
        ...verification(record),
        terminalState: 'failed' as const,
      }),
    ],
  ])('does not trust terminal records with %s', async (_label, makeEvidence) => {
    const storage = memoryStorage();
    const legacy = operation(6, 'completed');
    const evidence = typeof makeEvidence === 'function' ? makeEvidence(legacy) : undefined;
    storage.seed(
      STORAGE_KEY,
      [evidence ? { ...legacy, verification: evidence } : legacy],
    );

    expect(await new NymHttpSmokeOperationStore(storage).loadAll()).toEqual([
      { ...legacy, state: 'unknown' },
    ]);
  });

  it('rejects malformed or unexpected verification fields', async () => {
    const storage = memoryStorage();
    const terminal = operation(16, 'completed');
    storage.seed(STORAGE_KEY, [
      {
        ...terminal,
        verification: { ...verification(terminal), unexpected: true },
      },
    ]);

    await expect(new NymHttpSmokeOperationStore(storage).loadAll()).rejects.toThrow(
      /marker is malformed/,
    );
  });

  it('rejects an unsupported explicit provenance version', async () => {
    const storage = memoryStorage();
    const terminal = operation(28, 'completed');
    storage.seed(STORAGE_KEY, [
      {
        ...terminal,
        verification: { ...verification(terminal), schemaVersion: 1 },
      },
    ]);

    await expect(new NymHttpSmokeOperationStore(storage).loadAll()).rejects.toThrow(
      /marker is malformed/,
    );
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, 'invalid'])(
    'rejects invalid verification timestamp %s',
    async (verifiedAt) => {
      const storage = memoryStorage();
      const terminal = operation(17, 'completed');
      storage.seed(STORAGE_KEY, [
        {
          ...terminal,
          verification: { ...verification(terminal), verifiedAt },
        },
      ]);

      await expect(new NymHttpSmokeOperationStore(storage).loadAll()).rejects.toThrow(
        /marker is malformed/,
      );
    },
  );

  it('rejects unexpected record fields and invalid base timestamps', async () => {
    const storage = memoryStorage();
    storage.seed(STORAGE_KEY, [{ ...operation(18), extra: 'unexpected' }]);
    await expect(new NymHttpSmokeOperationStore(storage).loadAll()).rejects.toThrow(
      /marker is malformed/,
    );

    storage.seed(STORAGE_KEY, [{ ...operation(18), createdAt: 0 }]);
    await expect(new NymHttpSmokeOperationStore(storage).loadAll()).rejects.toThrow(
      /marker is malformed/,
    );
  });

  it.each([
    ['empty operation ID', { operationId: '' }],
    ['whitespace generation', { runtimeGeneration: '  ' }],
    ['fractional creation timestamp', { createdAt: 1.5 }],
    ['unsafe update timestamp', { updatedAt: Number.MAX_SAFE_INTEGER + 1 }],
    ['non-boolean timeout marker', { callerTimedOut: 'false' }],
    ['unknown state', { state: 'finished' }],
  ])('rejects invalid record field: %s', async (_label, invalidField) => {
    const storage = memoryStorage();
    storage.seed(STORAGE_KEY, [{ ...operation(25), ...invalidField }]);

    await expect(new NymHttpSmokeOperationStore(storage).loadAll()).rejects.toThrow(
      /marker is malformed/,
    );
  });

  it('rejects duplicate operation IDs before migrating or writing records', async () => {
    const storage = memoryStorage();
    const pending = operation(19);
    const legacy = { ...operation(20, 'completed'), operationId: pending.operationId };
    storage.seed(STORAGE_KEY, [pending, legacy]);

    await expect(new NymHttpSmokeOperationStore(storage).loadAll()).rejects.toThrow(
      /operation IDs are duplicated/,
    );
    expect(storage.peek(STORAGE_KEY)).toEqual([pending, legacy]);
  });

  it.each(['unknown', 'timed_out_pending'] as const)(
    'duplicate IDs cannot allow cleanup to erase the unresolved %s record',
    async (unresolvedState) => {
      const storage = memoryStorage();
      const pending = operation(21);
      const unresolved = {
        ...operation(22, unresolvedState),
        operationId: pending.operationId,
      };
      storage.seed(STORAGE_KEY, [pending, unresolved]);
      const store = new NymHttpSmokeOperationStore(storage);

      await expect(store.removeUndispatched(pending)).rejects.toThrow(
        /operation IDs are duplicated/,
      );
      expect(storage.peek(STORAGE_KEY)).toEqual([pending, unresolved]);
    },
  );

  it('rejects caller-supplied provenance that was not returned by the bridge', async () => {
    const store = new NymHttpSmokeOperationStore(memoryStorage());
    const pending = operation(23);
    await store.save(pending);
    const terminal = { ...pending, state: 'completed' as const };

    await expect(
      store.saveVerifiedTerminal(
        terminal,
        {
          operationId: terminal.operationId,
          runtimeGeneration: terminal.runtimeGeneration,
          state: 'completed',
        } as NymOffscreenHttpSmokeOperationStatus,
      ),
    ).rejects.toThrow(/invalid verified terminal operation/);
    expect((await store.loadAll())[0]).toMatchObject({ state: 'pending' });
  });

  it('accepts bridge-issued status objects but rejects copied status objects', async () => {
    const store = new NymHttpSmokeOperationStore(memoryStorage());
    const pending = operation(26);
    await store.save(pending);
    const terminal = { ...pending, state: 'completed' as const };
    const status = await authoritativeStatus(
      terminal.operationId,
      terminal.runtimeGeneration,
      'completed',
    );

    expect(isAuthoritativeHttpSmokeStatus(status)).toBe(true);
    expect(Object.isFrozen(status)).toBe(true);
    expect(isAuthoritativeHttpSmokeStatus({ ...status })).toBe(false);
    await expect(store.saveVerifiedTerminal(terminal, status)).resolves.toBeUndefined();
  });

  it('rejects an authoritative status for another operation, generation, or terminal state', async () => {
    const store = new NymHttpSmokeOperationStore(memoryStorage());
    const pending = operation(24);
    await store.save(pending);

    await expect(
      store.saveVerifiedTerminal(
        { ...pending, state: 'completed' },
        await authoritativeStatus('different-operation', pending.runtimeGeneration, 'completed'),
      ),
    ).rejects.toThrow(/invalid verified terminal operation/);
    await expect(
      store.saveVerifiedTerminal(
        { ...pending, state: 'completed' },
        await authoritativeStatus(pending.operationId, 'different-generation', 'completed'),
      ),
    ).rejects.toThrow(/invalid verified terminal operation/);
    await expect(
      store.saveVerifiedTerminal(
        { ...pending, state: 'failed' },
        await authoritativeStatus(pending.operationId, pending.runtimeGeneration, 'completed'),
      ),
    ).rejects.toThrow(/invalid verified terminal operation/);
    expect((await store.loadAll())[0]).toMatchObject({ state: 'pending' });
  });

  it('keeps legacy migration idempotent over repeated loads', async () => {
    const storage = memoryStorage();
    const legacy = operation(7, 'failed');
    storage.seed(STORAGE_KEY, [legacy]);
    const store = new NymHttpSmokeOperationStore(storage);

    await store.loadAll();
    const migratedValue = storage.peek(STORAGE_KEY);
    await store.loadAll();

    expect(storage.peek(STORAGE_KEY)).toBe(migratedValue);
    expect(storage.peek(STORAGE_KEY)).toEqual([{ ...legacy, state: 'unknown' }]);
  });

  it('fails migration load when persisting the migrated marker fails', async () => {
    const storage = memoryStorage();
    storage.seed(STORAGE_KEY, [operation(8, 'completed')]);
    vi.spyOn(storage, 'set').mockRejectedValueOnce(new Error('quota exceeded'));
    const store = new NymHttpSmokeOperationStore(storage);

    await expect(store.loadAll()).rejects.toThrow('quota exceeded');
    expect(storage.peek(STORAGE_KEY)).toEqual([operation(8, 'completed')]);
  });

  it('preserves migrated unknown records during normal terminal pruning', async () => {
    const storage = memoryStorage();
    const legacy = operation(9, 'failed');
    storage.seed(STORAGE_KEY, [legacy]);
    const store = new NymHttpSmokeOperationStore(storage);
    const migrated = (await store.loadAll())[0]!;

    for (let index = 10; index < 23; index += 1) {
      const pending = operation(index);
      await store.save(pending);
      const terminal = { ...pending, state: 'completed' as const };
      await store.saveVerifiedTerminal(
        terminal,
        await authoritativeStatus(
          terminal.operationId,
          terminal.runtimeGeneration,
          'completed',
        ),
      );
    }

    expect((await store.loadAll()).find((record) => record.operationId === legacy.operationId))
      .toMatchObject({ state: 'unknown' });
    expect(migrated.state).toBe('unknown');
    expect(
      (await store.loadAll()).filter((record) => record.state === 'completed'),
    ).toHaveLength(10);
  });

  it('rejects mismatched terminal evidence when saving a terminal update', async () => {
    const store = new NymHttpSmokeOperationStore(memoryStorage());
    const pending = operation(30);
    await store.save(pending);
    const terminal = { ...pending, state: 'completed' as const };

    await expect(
      store.saveVerifiedTerminal(
        terminal,
        await authoritativeStatus(
          terminal.operationId,
          'different-generation',
          'completed',
        ),
      ),
    ).rejects.toThrow(/invalid verified terminal operation/);
    expect((await store.loadAll())[0]).toMatchObject({ state: 'pending' });
  });
});
