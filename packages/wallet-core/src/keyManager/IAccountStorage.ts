/**
 * keyManager/IAccountStorage.ts
 */

import type { V2AccountState, AccountInfo } from './types.js';

export interface IAccountStorage {
  /**
   * Load the persisted account state.
   * Migrates from V1 automatically if needed.
   */
  loadState(): Promise<V2AccountState>;

  /**
   * Persist the full state, replacing any existing data.
   */
  saveState(state: V2AccountState): Promise<void>;

  /**
   * Write an intent marker to indicate a pending ADD_ACCOUNT operation.
   */
  writeIntent(uuid: string): Promise<void>;

  /**
   * Clear an intent marker.
   */
  clearIntent(): Promise<void>;

  /**
   * Compatibility method
   */
  loadAccounts(): Promise<AccountInfo[]>;
  saveAccounts(accounts: AccountInfo[]): Promise<void>;
}
