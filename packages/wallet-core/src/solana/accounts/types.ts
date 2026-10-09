import type { Address } from '@solana/kit';

export interface SolanaAccount {
  index: number;
  address: Address;
  label: string;
}

export interface IRawAccountInfo {
  index: number;
  publicKey: Uint8Array;
  label: string;
}

export interface IAccountProvider {
  getAccounts(): Promise<IRawAccountInfo[]>;
}
