/**
 * keyManager/KeyManager.ts
 */

import type { SoftwareSigner } from '../signer/SoftwareSigner.js';
import type { IAccountStorage } from './IAccountStorage.js';
import {
  AccountNotFoundError,
  InvalidAccountLabelError,
  UncertainCommitStateError,
  type AccountIndex,
  type AccountInfo,
  type SupportedAccountChain,
  type V2AccountState,
} from './types.js';

function defaultLabel(accountIndex: AccountIndex): string {
  return `Account ${accountIndex + 1}`;
}

function validateLabel(label: string): void {
  if (label.trim().length === 0) {
    throw new InvalidAccountLabelError();
  }
}

function copyAccountInfo(account: AccountInfo): AccountInfo {
  return {
    index: account.index,
    publicKey: account.publicKey.slice(),
    label: account.label,
    chain: account.chain,
  };
}

export class KeyManager {
  constructor(
    private readonly _signer: SoftwareSigner,
    private readonly _storage: IAccountStorage,
  ) {}

  async getAccounts(): Promise<AccountInfo[]> {
    const state = await this._storage.loadState();
    return state.accounts.map(copyAccountInfo);
  }

  async addAccount(uuid: string, label?: string, chain?: SupportedAccountChain): Promise<AccountInfo> {
    const resolvedLabel = label !== undefined ? label : undefined;
    if (resolvedLabel !== undefined) validateLabel(resolvedLabel);

    // 1. Load state
    const state = await this._storage.loadState();
    
    // 2. Check idempotency map
    if (state.idempotencyMap[uuid] !== undefined) {
      const idx = state.idempotencyMap[uuid];
      const account = state.accounts.find(a => a.index === idx);
      if (!account) {
        throw new Error('StorageCorruptionError: Idempotency map points to missing account');
      }
      return copyAccountInfo(account);
    }

    // 3. Write intent
    try {
      await this._storage.writeIntent(uuid);
    } catch (e) {
      throw new UncertainCommitStateError('Intent write rejected');
    }

    // 4. Derive
    const nextIndex: AccountIndex = state.accounts.length;
    const rawPublicKey = await this._signer.getPublicKey(nextIndex);
    const publicKey = rawPublicKey.slice();
    const resolvedChain: SupportedAccountChain = chain ?? (this._signer.chain ?? 'solana');

    const newAccount: AccountInfo = {
      index: nextIndex,
      publicKey,
      label: resolvedLabel ?? defaultLabel(nextIndex),
      chain: resolvedChain,
    };

    state.accounts.push(newAccount);
    state.idempotencyMap[uuid] = nextIndex;

    // 5. Atomic write of Accounts + Idempotency
    try {
      await this._storage.saveState(state);
    } catch (e) {
      throw new UncertainCommitStateError('Accounts write rejected and read failed');
    }

    // 6. Clear intent (fire and forget, if it fails next boot will clean it up)
    await this._storage.clearIntent().catch(() => {});

    return copyAccountInfo(newAccount);
  }

  async renameAccount(accountIndex: AccountIndex, label: string): Promise<void> {
    validateLabel(label);
    const state = await this._storage.loadState();
    const idx = state.accounts.findIndex((a) => a.index === accountIndex);

    if (idx === -1) {
      throw new AccountNotFoundError(accountIndex);
    }

    const existing = state.accounts[idx]!;
    const updated: AccountInfo = {
      index: existing.index,
      publicKey: existing.publicKey,
      label,
    };

    state.accounts[idx] = updated;
    
    try {
      await this._storage.saveState(state);
    } catch (e) {
      throw new UncertainCommitStateError('Rename write rejected');
    }
  }
}
