/**
 * Fail-closed transport router for Solanym Stellar HTTP.
 *
 * When mode === 'nym', every request MUST go through {@link NymHttpTransport.fetch}.
 * Clearnet `directFetch` is never used as a silent fallback on mixnet failure.
 * Direct mode is only available when the caller explicitly sets mode to 'direct'
 * (user disabled Nym).
 */

import {
  NymTransportError,
  type NymHttpTransport,
  type NymTransportSnapshot,
} from './NymTransport.js';

export type NymTransportMode = 'direct' | 'nym';

export type StellarHttpOperation =
  | 'stellar.getBalance'
  | 'stellar.fundTestnetAccount'
  | 'stellar.horizonProbe';

/**
 * Operations that the policy can route. Documented for operators:
 * - Through Nym (when mode=nym): Horizon account GET, Friendbot fund GET,
 *   Horizon root probe (public metadata). StellarTransactionClient uses the
 *   same injected fetch for account load, fee, submit, and confirm.
 * - Not covered here: Solana RPC, SPP SDK, extension chrome APIs, signing.
 */
export const STELLAR_HTTP_OPERATIONS_VIA_POLICY: readonly StellarHttpOperation[] = [
  'stellar.getBalance',
  'stellar.fundTestnetAccount',
  'stellar.horizonProbe',
] as const;

export type FailClosedTransportRouterOptions = {
  mode: NymTransportMode;
  nym: NymHttpTransport;
  /** Used only when mode === 'direct' and direct egress is authorized. */
  directFetch?: typeof fetch;
  /**
   * Checked on every fetch while mode is direct, including after a later setMode('direct').
   * Returning false refuses clearnet. The wallet controller always supplies this so a
   * stale router reference cannot outlive the persisted choice.
   */
  directAuthorized?: () => boolean;
};

export class FailClosedTransportRouter {
  private _mode: NymTransportMode;
  private readonly _nym: NymHttpTransport;
  private readonly _directFetch: typeof fetch;
  private readonly _directAuthorized: (() => boolean) | null;

  constructor(options: FailClosedTransportRouterOptions) {
    if (!options?.nym) {
      throw new Error('FailClosedTransportRouter requires nym transport');
    }
    this._mode = options.mode;
    this._nym = options.nym;
    this._directFetch = options.directFetch ?? globalThis.fetch.bind(globalThis);
    this._directAuthorized = options.directAuthorized ?? null;
  }

  get mode(): NymTransportMode {
    return this._mode;
  }

  /** Explicit user/operator toggle — never auto-flip on mixnet errors. */
  setMode(mode: NymTransportMode): void {
    if (mode !== 'direct' && mode !== 'nym') {
      throw new Error(`Invalid transport mode: ${String(mode)}`);
    }
    this._mode = mode;
  }

  getNymSnapshot(): NymTransportSnapshot {
    return this._nym.getSnapshot();
  }

  /**
   * Policy-bound fetch. In nym mode: mixnet only; on failure throws
   * {@link NymTransportError} and does not retry via clearnet.
   */
  fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    if (this._mode === 'direct') {
      if (this._directAuthorized && !this._directAuthorized()) {
        throw new NymTransportError(
          'NOT_CONNECTED',
          'Direct egress refused: persisted privacy choice does not allow clearnet',
        );
      }
      return this._directFetch(url, init);
    }

    const snap = this._nym.getSnapshot();
    if (!snap.connected) {
      throw new NymTransportError(
        'NOT_CONNECTED',
        'Nym mode enabled but mixnet is not connected; refusing clearnet fallback',
      );
    }

    try {
      return await this._nym.fetch(url, init);
    } catch (cause) {
      if (cause instanceof NymTransportError) throw cause;
      throw new NymTransportError(
        'REQUEST_FAILED',
        cause instanceof Error ? cause.message : 'Nym mix-fetch request failed',
        { cause },
      );
    }
  };
}

export function createFailClosedTransportRouter(
  options: FailClosedTransportRouterOptions,
): FailClosedTransportRouter {
  return new FailClosedTransportRouter(options);
}
