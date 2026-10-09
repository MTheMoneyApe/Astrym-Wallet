/**
 * keyManager/ChromeAccountStorage.ts
 */

import type { IAccountStorage } from './IAccountStorage.js';
import type { AccountInfo, V2AccountState } from './types.js';

export interface ILocalStorageArea {
  get(key: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export const ACCOUNTS_STORAGE_KEY = 'solanym_accounts' as const;

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromBase64Url(str: string): Uint8Array | null {
  try {
    const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

interface StoredAccountEntry {
  index: number;
  publicKey: string;
  label: string;
}

function decodeStoredEntry(raw: unknown): AccountInfo | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;

  if (typeof o['index'] !== 'number' || !Number.isInteger(o['index']) || o['index'] < 0) {
    return null;
  }

  if (typeof o['publicKey'] !== 'string' || (o['publicKey'] as string).length === 0) {
    return null;
  }
  const publicKey = fromBase64Url(o['publicKey'] as string);
  if (publicKey === null || publicKey.length !== 32) {
    return null;
  }

  if (typeof o['label'] !== 'string') {
    return null;
  }

  return {
    index: o['index'] as number,
    publicKey,
    label: o['label'] as string,
  };
}

export class ChromeAccountStorage implements IAccountStorage {
  constructor(private readonly _area: ILocalStorageArea) {}

  async loadState(): Promise<V2AccountState> {
    const result = await this._area.get(ACCOUNTS_STORAGE_KEY);
    const raw: unknown = result[ACCOUNTS_STORAGE_KEY];

    if (raw === undefined || raw === null) {
      return { version: 2, accounts: [], idempotencyMap: {} };
    }

    // V1 Migration
    if (Array.isArray(raw)) {
      const accounts = this._parseAccounts(raw);
      return { version: 2, accounts, idempotencyMap: {} };
    }

    // V2
    if (typeof raw === 'object') {
      const o = raw as Record<string, unknown>;
      if (o['version'] === 2) {
        const accounts = this._parseAccounts(o['accounts']);
        const rawMap = o['idempotencyMap'];
        const map: Record<string, number> = {};
        if (typeof rawMap === 'object' && rawMap !== null) {
          for (const [k, v] of Object.entries(rawMap)) {
            if (typeof v === 'number') {
              map[k] = v;
            }
          }
        }
        return { version: 2, accounts, idempotencyMap: map };
      }
    }

    // Unrecognized or corrupt
    throw new Error('StorageCorruptionError: Accounts metadata is corrupt');
  }

  private _parseAccounts(rawArr: unknown): AccountInfo[] {
    if (!Array.isArray(rawArr)) return [];
    const accounts: AccountInfo[] = [];
    for (const entry of rawArr) {
      const decoded = decodeStoredEntry(entry);
      if (decoded !== null) {
        accounts.push(decoded);
      }
    }
    accounts.sort((a, b) => a.index - b.index);
    return accounts;
  }

  async saveState(state: V2AccountState): Promise<void> {
    const serialisedAccounts: StoredAccountEntry[] = state.accounts.map((a) => ({
      index: a.index,
      publicKey: toBase64Url(a.publicKey),
      label: a.label,
    }));
    
    await this._area.set({ 
      [ACCOUNTS_STORAGE_KEY]: {
        version: 2,
        accounts: serialisedAccounts,
        idempotencyMap: state.idempotencyMap
      } 
    });
  }

  async loadAccounts(): Promise<AccountInfo[]> {
    const state = await this.loadState();
    return state.accounts;
  }

  async saveAccounts(accounts: AccountInfo[]): Promise<void> {
    const state = await this.loadState();
    state.accounts = accounts;
    await this.saveState(state);
  }

  async writeIntent(uuid: string): Promise<void> {
    await this._area.set({ solanym_add_account_intent: uuid });
    // In a real environment we'd read back if we had a rejection catch, 
    // but the upper layer handles UncertainCommitStateError by reading back if needed.
    // However, area.set doesn't throw standard things easily, so we just wrap it.
  }

  async clearIntent(): Promise<void> {
    // Note: ILocalStorageArea doesn't have a remove() method in the abstract interface.
    // We can set it to null.
    await this._area.set({ solanym_add_account_intent: null });
  }
}

