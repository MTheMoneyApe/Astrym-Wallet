import { StrKey } from '@stellar/stellar-sdk';
import {
  InvalidStellarAddressError,
  StellarNetworkError,
  type FriendbotResponse,
  type StellarAccountBalance,
  type StellarBalanceEntry,
} from './types.js';

export const STELLAR_TESTNET_HORIZON_URL = 'https://horizon-testnet.stellar.org';
export const STELLAR_TESTNET_FRIENDBOT_URL = 'https://friendbot.stellar.org';

export type StellarReadFetch = (
  url: string,
  init?: RequestInit,
) => Promise<Response>;

export class StellarReadClient {
  private readonly _fetch: StellarReadFetch;

  constructor(
    private readonly _horizonUrl: string = STELLAR_TESTNET_HORIZON_URL,
    private readonly _friendbotUrl: string = STELLAR_TESTNET_FRIENDBOT_URL,
    private readonly _timeoutMs: number = 10000,
    /**
     * Injected HTTP transport (e.g. {@link FailClosedTransportRouter.fetch}).
     * Defaults to global fetch (direct / clearnet).
     */
    fetchImpl: StellarReadFetch = globalThis.fetch.bind(globalThis),
  ) {
    this._fetch = fetchImpl;
  }

  public validateAddress(address: string): boolean {
    return StrKey.isValidEd25519PublicKey(address);
  }

  public async getBalance(address: string): Promise<StellarAccountBalance> {
    if (!this.validateAddress(address)) {
      throw new InvalidStellarAddressError(address);
    }

    const url = `${this._horizonUrl.replace(/\/+$/, '')}/accounts/${encodeURIComponent(address)}`;

    let response: Response;
    try {
      response = await this._fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(this._timeoutMs),
      });
    } catch (err: unknown) {
      throw new StellarNetworkError(
        `Failed to query Stellar Horizon at ${this._horizonUrl}: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }

    if (response.status === 404) {
      // Unfunded account on Stellar Testnet — this is a valid state, not an exception
      return {
        address,
        exists: false,
        balance: '0',
        asset: 'XLM',
        subentryCount: 0,
        balances: [],
      };
    }

    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try {
        const body = (await response.json()) as { title?: string; detail?: string };
        if (body.detail) detail = body.detail;
        else if (body.title) detail = body.title;
      } catch {
        // Fallback to status text
      }
      throw new StellarNetworkError(`Stellar Horizon error: ${detail}`);
    }

    try {
      const data = (await response.json()) as {
        subentry_count?: number;
        balances?: Array<{
          asset_type?: string;
          balance?: string;
          asset_code?: string;
          asset_issuer?: string;
        }>;
      };

      const rawBalances = Array.isArray(data.balances) ? data.balances : [];
      const balances: StellarBalanceEntry[] = rawBalances.map((b) => ({
        assetType: b.asset_type ?? 'unknown',
        balance: b.balance ?? '0',
        assetCode: b.asset_code,
        assetIssuer: b.asset_issuer,
      }));

      const nativeBal = balances.find((b) => b.assetType === 'native');
      const balance = nativeBal?.balance ?? '0';

      return {
        address,
        exists: true,
        balance,
        asset: 'XLM',
        subentryCount: data.subentry_count ?? 0,
        balances,
      };
    } catch (err: unknown) {
      throw new StellarNetworkError('Failed to parse Horizon account response', err);
    }
  }

  public async fundTestnetAccount(address: string): Promise<FriendbotResponse> {
    if (!this.validateAddress(address)) {
      throw new InvalidStellarAddressError(address);
    }

    const url = `${this._friendbotUrl.replace(/\/+$/, '')}?addr=${encodeURIComponent(address)}`;

    let response: Response;
    try {
      response = await this._fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(this._timeoutMs),
      });
    } catch (err: unknown) {
      throw new StellarNetworkError(
        `Failed to reach Stellar Friendbot: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }

    if (response.ok) {
      let txHash: string | undefined;
      try {
        const data = (await response.json()) as { hash?: string };
        txHash = data.hash;
      } catch {
        // Ignore json parse error on success
      }
      return {
        success: true,
        message: 'Account funded with 10,000 Testnet XLM',
        txHash,
      };
    }

    let detail = `Status ${response.status}`;
    try {
      const body = (await response.json()) as { detail?: string; title?: string };
      if (body.detail) detail = body.detail;
      else if (body.title) detail = body.title;
    } catch {
      // Fallback
    }

    return {
      success: false,
      message: `Friendbot returned: ${detail}`,
    };
  }
}
