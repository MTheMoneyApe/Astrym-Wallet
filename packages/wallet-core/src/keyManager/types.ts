/**
 * keyManager/types.ts
 *
 * SECURITY:
 *   - AccountInfo contains ONLY public / non-secret data.
 *   - Private keys, seed bytes, and mnemonic are never represented here.
 */

export type AccountIndex = number;

export interface AccountInfo {
  readonly index: AccountIndex;
  readonly publicKey: Uint8Array;
  readonly label: string;
}

export interface V2AccountState {
  version: 2;
  accounts: AccountInfo[];
  idempotencyMap: Record<string, number>;
}

export class AccountNotFoundError extends Error {
  constructor(accountIndex: AccountIndex) {
    super(`No account with index ${accountIndex} exists`);
    this.name = 'AccountNotFoundError';
  }
}

export class InvalidAccountLabelError extends Error {
  constructor() {
    super('Account label must contain at least one non-whitespace character');
    this.name = 'InvalidAccountLabelError';
  }
}

export class UncertainCommitStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UncertainCommitStateError';
  }
}
