export interface StellarAccount {
  index: number;
  address: string; // StrKey G... format (56 chars)
  label: string;
}

export interface IRawAccountInfo {
  index: number;
  publicKey: Uint8Array;
  label: string;
  chain?: 'solana' | 'stellar' | undefined;
}

export interface IAccountProvider {
  getAccounts(): Promise<IRawAccountInfo[]>;
}
