import {
  isAuthoritativeHttpSmokeStatus,
} from './OffscreenMixFetchBridge.js';
import type { NymOffscreenHttpSmokeOperationStatus } from '../../nym-offscreen/protocol.js';

export type NymHttpSmokeOperationState =
  | 'pending'
  | 'timed_out_pending'
  | 'completed'
  | 'failed'
  | 'unknown';

export type NymHttpSmokeTerminalVerification = {
  schemaVersion: 2;
  operationId: string;
  runtimeGeneration: string;
  terminalState: 'completed' | 'failed';
  source: 'authoritative_offscreen_status';
  verifiedAt: number;
};

export type NymHttpSmokeOperationRecord = {
  operationId: string;
  runtimeGeneration: string;
  state: NymHttpSmokeOperationState;
  createdAt: number;
  updatedAt: number;
  callerTimedOut: boolean;
  verification?: NymHttpSmokeTerminalVerification;
};

export type NymHttpSmokeOperationStorage = {
  get: (key: string) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
};

const STORAGE_KEY = 'solanym_nym_http_smoke_operation_v1';
const MAX_HISTORY = 10;
const TERMINAL_VERIFICATION_SCHEMA_VERSION = 2 as const;
const UNRESOLVED_STATES = new Set<NymHttpSmokeOperationState>([
  'pending',
  'timed_out_pending',
  'unknown',
]);
const STATES = new Set<NymHttpSmokeOperationState>([
  'pending',
  'timed_out_pending',
  'completed',
  'failed',
  'unknown',
]);

const RECORD_KEYS = new Set([
  'operationId',
  'runtimeGeneration',
  'state',
  'createdAt',
  'updatedAt',
  'callerTimedOut',
  'verification',
]);
const VERIFICATION_KEYS = new Set([
  'schemaVersion',
  'operationId',
  'runtimeGeneration',
  'terminalState',
  'source',
  'verifiedAt',
]);
const LEGACY_VERIFICATION_KEYS = new Set([
  'operationId',
  'runtimeGeneration',
  'terminalState',
  'source',
  'verifiedAt',
]);

function hasExactKeys(value: Record<string, unknown>, expected: Set<string>): boolean {
  return Object.keys(value).every((key) => expected.has(key)) &&
    [...expected].every((key) => key in value);
}

function isNonEmptyIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value === value.trim();
}

function isVerificationShape(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const evidence = value as Record<string, unknown>;
  const isCurrent =
    hasExactKeys(evidence, VERIFICATION_KEYS) &&
    evidence['schemaVersion'] === TERMINAL_VERIFICATION_SCHEMA_VERSION;
  const isLegacy = hasExactKeys(evidence, LEGACY_VERIFICATION_KEYS);
  return (
    (isCurrent || isLegacy) &&
    isNonEmptyIdentifier(evidence['operationId']) &&
    isNonEmptyIdentifier(evidence['runtimeGeneration']) &&
    (evidence['terminalState'] === 'completed' || evidence['terminalState'] === 'failed') &&
    evidence['source'] === 'authoritative_offscreen_status' &&
    Number.isSafeInteger(evidence['verifiedAt']) &&
    (evidence['verifiedAt'] as number) > 0
  );
}

function isOperationRecord(value: unknown): value is NymHttpSmokeOperationRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    hasExactKeys(record, record['verification'] === undefined
      ? new Set([...RECORD_KEYS].filter((key) => key !== 'verification'))
      : RECORD_KEYS) &&
    isNonEmptyIdentifier(record['operationId']) &&
    isNonEmptyIdentifier(record['runtimeGeneration']) &&
    typeof record['state'] === 'string' &&
    STATES.has(record['state'] as NymHttpSmokeOperationState) &&
    Number.isSafeInteger(record['createdAt']) &&
    (record['createdAt'] as number) > 0 &&
    Number.isSafeInteger(record['updatedAt']) &&
    (record['updatedAt'] as number) > 0 &&
    typeof record['callerTimedOut'] === 'boolean' &&
    (record['verification'] === undefined || isVerificationShape(record['verification']))
  );
}

function hasMatchingTerminalVerification(
  record: NymHttpSmokeOperationRecord,
): boolean {
  const verification = record.verification;
  if (!isVerificationShape(verification)) return false;
  if (verification.schemaVersion !== TERMINAL_VERIFICATION_SCHEMA_VERSION) return false;
  return (
    (record.state === 'completed' || record.state === 'failed') &&
    verification.operationId === record.operationId &&
    verification.runtimeGeneration === record.runtimeGeneration &&
    verification.terminalState === record.state
  );
}

function withoutVerification(
  record: NymHttpSmokeOperationRecord,
): NymHttpSmokeOperationRecord {
  const copy = { ...record };
  delete copy.verification;
  return copy;
}

export class NymHttpSmokeOperationStore {
  constructor(private readonly storage: NymHttpSmokeOperationStorage) {}

  private async persist(records: NymHttpSmokeOperationRecord[]): Promise<void> {
    records.sort((left, right) => left.createdAt - right.createdAt);
    const unresolved = records.filter((entry) => !hasMatchingTerminalVerification(entry));
    const terminal = records.filter(hasMatchingTerminalVerification);
    if (unresolved.some((entry) => !UNRESOLVED_STATES.has(entry.state))) {
      throw new Error('Refusing to prune an unverified terminal Nym HTTP Smoke operation');
    }
    await this.storage.set({
      [STORAGE_KEY]: [...unresolved, ...terminal.slice(-MAX_HISTORY)],
    });
  }

  async loadAll(): Promise<NymHttpSmokeOperationRecord[]> {
    const stored = await this.storage.get(STORAGE_KEY);
    if (!Object.prototype.hasOwnProperty.call(stored, STORAGE_KEY)) return [];
    const records = stored[STORAGE_KEY];
    if (!Array.isArray(records) || !records.every(isOperationRecord)) {
      throw new Error('Stored Nym HTTP Smoke operation marker is malformed');
    }
    const operationIds = new Set<string>();
    for (const record of records) {
      if (operationIds.has(record.operationId)) {
        throw new Error('Stored Nym HTTP Smoke operation IDs are duplicated');
      }
      operationIds.add(record.operationId);
    }
    let migrated = false;
    const normalized = records.map((record) => {
      if (
        (record.state === 'completed' || record.state === 'failed') &&
        !hasMatchingTerminalVerification(record)
      ) {
        migrated = true;
        return { ...withoutVerification(record), state: 'unknown' as const };
      }
      return { ...record };
    });
    if (migrated) {
      try {
        await this.persist(normalized);
      } catch (cause) {
        throw new Error(
          `Unable to persist migrated Nym HTTP Smoke operation state: ${
            cause instanceof Error ? cause.message : 'unknown storage error'
          }`,
        );
      }
    }
    return normalized;
  }

  async save(record: NymHttpSmokeOperationRecord): Promise<void> {
    if (!isOperationRecord(record)) {
      throw new Error('Refusing to persist an invalid Nym HTTP Smoke operation marker');
    }
    if (!UNRESOLVED_STATES.has(record.state)) {
      throw new Error('Terminal Nym HTTP Smoke states require verified runtime evidence');
    }
    const records = await this.loadAll();
    const existingIndex = records.findIndex((entry) => entry.operationId === record.operationId);
    if (existingIndex >= 0) {
      const existing = records[existingIndex]!;
      if (
        !UNRESOLVED_STATES.has(existing.state) ||
        existing.runtimeGeneration !== record.runtimeGeneration ||
        existing.createdAt !== record.createdAt
      ) {
        throw new Error('Refusing to overwrite an existing Nym HTTP Smoke operation');
      }
      records[existingIndex] = withoutVerification(record);
    } else {
      records.push(withoutVerification(record));
    }
    await this.persist(records);
  }

  async saveVerifiedTerminal(
    record: NymHttpSmokeOperationRecord,
    status: NymOffscreenHttpSmokeOperationStatus,
  ): Promise<void> {
    if (
      !isOperationRecord(record) ||
      (record.state !== 'completed' && record.state !== 'failed') ||
      !isAuthoritativeHttpSmokeStatus(status) ||
      status.operationId !== record.operationId ||
      status.runtimeGeneration !== record.runtimeGeneration ||
      status.state !== record.state
    ) {
      throw new Error('Refusing to persist an invalid verified terminal operation');
    }
    const records = await this.loadAll();
    const existingIndex = records.findIndex((entry) => entry.operationId === record.operationId);
    if (existingIndex < 0) {
      throw new Error('Cannot complete an unknown Nym HTTP Smoke operation');
    }
    const existing = records[existingIndex]!;
    if (
      !UNRESOLVED_STATES.has(existing.state) ||
      existing.runtimeGeneration !== record.runtimeGeneration ||
      existing.createdAt !== record.createdAt
    ) {
      throw new Error('Verified terminal result does not match the unresolved operation');
    }
    const verifiedAt = Date.now();
    if (!Number.isSafeInteger(verifiedAt) || verifiedAt <= 0) {
      throw new Error('Unable to create a valid Nym HTTP Smoke verification timestamp');
    }
    records[existingIndex] = {
      ...record,
      verification: {
        schemaVersion: TERMINAL_VERIFICATION_SCHEMA_VERSION,
        operationId: status.operationId,
        runtimeGeneration: status.runtimeGeneration,
        terminalState: status.state,
        source: 'authoritative_offscreen_status',
        verifiedAt,
      },
    };
    await this.persist(records);
  }

  async removeUndispatched(operation: NymHttpSmokeOperationRecord): Promise<void> {
    if (!isOperationRecord(operation) || operation.state !== 'pending') {
      throw new Error('Refusing to remove an invalid undispatched Nym HTTP Smoke operation');
    }
    const records = await this.loadAll();
    const index = records.findIndex((record) => record.operationId === operation.operationId);
    if (index < 0) return;
    const record = records[index]!;
    if (
      record.runtimeGeneration !== operation.runtimeGeneration ||
      record.createdAt !== operation.createdAt ||
      record.state !== 'pending' ||
      record.callerTimedOut !== operation.callerTimedOut
    ) {
      throw new Error(
        'Refusing to remove a Nym HTTP Smoke operation with mismatched identity or dispatch state',
      );
    }
    records.splice(index, 1);
    await this.storage.set({
      [STORAGE_KEY]: records,
    });
  }
}
