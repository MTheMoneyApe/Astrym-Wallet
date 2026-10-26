export interface StellarBalanceEntry {
  assetType: string;
  balance: string;
  assetCode?: string | undefined;
  assetIssuer?: string | undefined;
}

export interface StellarAccountBalance {
  address: string;
  exists: boolean;
  balance: string; // Native XLM balance or "0" if unfunded
  asset: 'XLM';
  subentryCount: number;
  balances: StellarBalanceEntry[];
}

export interface FriendbotResponse {
  success: boolean;
  message: string;
  txHash?: string | undefined;
}

export class InvalidStellarAddressError extends Error {
  constructor(address: string) {
    super(`Invalid Stellar address format: ${address}`);
    this.name = 'InvalidStellarAddressError';
  }
}

export class StellarNetworkError extends Error {
  constructor(message: string, override readonly cause?: unknown) {
    super(message);
    this.name = 'StellarNetworkError';
  }
}
