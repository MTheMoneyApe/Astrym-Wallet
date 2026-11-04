import {
  SESSION_UNCERTAIN_KEY,
  StrKey,
} from '@solanym/wallet-core';
import type {
  IUncertainSubmissionStorage,
  UncertainTxSessionFlag,
} from '@solanym/wallet-core';

export interface UncertainSubmissionStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

const REQUIRED_KEYS = [
  'schemaVersion',
  'txHash',
  'accountIndex',
  'sourceAddress',
  'destinationAddress',
  'amountXlm',
  'approvedFeeStroops',
  'expectedSequence',
  'maxTime',
  'submittedAt',
  'lastProbeAt',
  'status',
] as const;

function isPublicKey(value: unknown): value is string {
  return typeof value === 'string' && StrKey.isValidEd25519PublicKey(value);
}

function isUncertainSessionFlag(value: unknown): value is UncertainTxSessionFlag {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== REQUIRED_KEYS.length ||
    REQUIRED_KEYS.some((key) => !Object.prototype.hasOwnProperty.call(record, key))
  ) {
    return false;
  }

  return (
    record['schemaVersion'] === 1 &&
    typeof record['txHash'] === 'string' &&
    /^[a-f0-9]{64}$/.test(record['txHash']) &&
    Number.isSafeInteger(record['accountIndex']) &&
    (record['accountIndex'] as number) >= 0 &&
    isPublicKey(record['sourceAddress']) &&
    isPublicKey(record['destinationAddress']) &&
    typeof record['amountXlm'] === 'string' &&
    /^\d+(\.\d{1,7})?$/.test(record['amountXlm']) &&
    /[1-9]/.test(record['amountXlm']) &&
    Number.isSafeInteger(record['approvedFeeStroops']) &&
    (record['approvedFeeStroops'] as number) > 0 &&
    typeof record['expectedSequence'] === 'string' &&
    /^\d+$/.test(record['expectedSequence']) &&
    Number.isSafeInteger(record['maxTime']) &&
    (record['maxTime'] as number) >= 0 &&
    Number.isSafeInteger(record['submittedAt']) &&
    (record['submittedAt'] as number) > 0 &&
    Number.isSafeInteger(record['lastProbeAt']) &&
    (record['lastProbeAt'] as number) > 0 &&
    ['SUBMITTING', 'SUBMISSION_UNKNOWN', 'SUBMITTED_INGESTED', 'INDETERMINATE'].includes(
      record['status'] as string,
    )
  );
}

function recordsEqual(
  left: UncertainTxSessionFlag,
  right: UncertainTxSessionFlag,
): boolean {
  return REQUIRED_KEYS.every((key) => left[key] === right[key]);
}

export class ChromeUncertainSubmissionStorage implements IUncertainSubmissionStorage {
  constructor(
    private readonly area: UncertainSubmissionStorageArea,
    private readonly legacySessionArea?: UncertainSubmissionStorageArea,
  ) {}

  async load(): Promise<UncertainTxSessionFlag | null> {
    const durableRecord = await this.loadFrom(this.area);
    if (!this.legacySessionArea) return durableRecord;

    const legacyRecord = await this.loadFrom(this.legacySessionArea);
    if (!legacyRecord) return durableRecord;
    if (durableRecord && !recordsEqual(durableRecord, legacyRecord)) {
      throw new Error('Durable and legacy uncertain Stellar submission records conflict');
    }

    if (!durableRecord) {
      await this.area.set({ [SESSION_UNCERTAIN_KEY]: legacyRecord });
      const verifiedRecord = await this.loadFrom(this.area);
      if (!verifiedRecord || !recordsEqual(verifiedRecord, legacyRecord)) {
        throw new Error('Durable uncertain Stellar submission record failed verification');
      }
    }

    await this.legacySessionArea.remove(SESSION_UNCERTAIN_KEY);
    return durableRecord ?? legacyRecord;
  }

  async save(record: UncertainTxSessionFlag): Promise<void> {
    if (!isUncertainSessionFlag(record)) {
      throw new Error('Refusing to persist an invalid uncertain Stellar submission record');
    }

    // chrome.storage.local has no compare-and-set; production sends serialize this guard via the coordinator mutex.
    if (await this.load()) {
      throw new Error('An uncertain Stellar submission record already exists');
    }

    await this.area.set({ [SESSION_UNCERTAIN_KEY]: record });
    const stored = await this.loadFrom(this.area);
    if (!stored || !recordsEqual(stored, record)) {
      throw new Error('Durable uncertain Stellar submission record failed verification');
    }
  }

  async clear(): Promise<void> {
    await this.area.remove(SESSION_UNCERTAIN_KEY);
    if (this.legacySessionArea) {
      await this.legacySessionArea.remove(SESSION_UNCERTAIN_KEY);
    }
    if (await this.loadFrom(this.area)) {
      throw new Error('Durable uncertain Stellar submission record could not be cleared');
    }
    if (this.legacySessionArea && (await this.loadFrom(this.legacySessionArea))) {
      throw new Error('Legacy uncertain Stellar submission record could not be cleared');
    }
  }

  private async loadFrom(
    area: UncertainSubmissionStorageArea,
  ): Promise<UncertainTxSessionFlag | null> {
    const stored = await area.get(SESSION_UNCERTAIN_KEY);
    if (!Object.prototype.hasOwnProperty.call(stored, SESSION_UNCERTAIN_KEY)) return null;

    const value = stored[SESSION_UNCERTAIN_KEY];
    if (!isUncertainSessionFlag(value)) {
      throw new Error('Stored uncertain Stellar submission record is malformed');
    }
    return value;
  }
}
