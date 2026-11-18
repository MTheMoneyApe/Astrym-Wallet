/**
 * Build a write PrivatePool inside spp-host and adapt it to {@link SppPrivatePool}.
 *
 * Requires a live SDK Client (WASM + OPFS) in this page. Signing goes through
 * {@link SppHostRemoteSigner} → SW vault. Soroban RPC must run under
 * {@link withSppHostNymFetchProxy}.
 */

import type { Client, WalletSigner } from 'stellar-private-payments';
import type { SppPrivatePool, SppPrivatePoolResult } from '@solanym/wallet-core/src/stellar/spp/sppNymOption.js';
import { registerSppHostWritePool, clearSppHostWritePool } from './sppHostWritePool.js';
import {
  bindSppHostAccountSurface,
  clearSppHostAccountSurface,
} from './sppHostAccountSurface.js';
import { SppHostRemoteSigner } from './sppHostRemoteSigner.js';
import { withSppHostNymFetchProxy } from './sppHostNymFetchProxy.js';

export type SppWritePoolInitInput = {
  client: Client;
  rpcUrl: string;
  poolContract: string;
  userAddress: string;
  networkPassphrase: string;
  prepareGeneration: number;
  /** Optional injected signer (tests). Defaults to SW remote signer. */
  signer?: WalletSigner;
};

export type SdkPrivatePool = {
  deposit(amount: bigint): Promise<{ hashes: string[]; status: string }>;
  transfer(recipient: string, amount: bigint): Promise<{ hashes: string[]; status: string }>;
  withdraw(amount: bigint, recipient?: string | null): Promise<{ hashes: string[]; status: string }>;
};

/** Completed hashes from one SDK call, including steps finished before a later failure. */
export class SppPoolExecuteError extends Error {
  readonly status: string;
  readonly txHashes: readonly string[];

  constructor(status: string, txHashes: readonly string[], message: string) {
    super(message);
    this.name = 'SppPoolExecuteError';
    this.status = status;
    this.txHashes = txHashes;
  }
}

function collectHashes(hashes: unknown): string[] {
  if (!Array.isArray(hashes)) {
    throw new SppPoolExecuteError('failed', [], 'SPP execute hashes is not an array');
  }
  const out: string[] = [];
  for (const item of hashes) {
    if (typeof item !== 'string' || item.length === 0) {
      throw new SppPoolExecuteError(
        'failed',
        out,
        'SPP execute returned an empty or non-string hash',
      );
    }
    out.push(item);
  }
  return out;
}

/**
 * Keep every hash the SDK reported. A non-ok status still carries the steps
 * that already completed. This does not retry, sign again, or raise a fee.
 */
export function mapSdkPoolExecuteResult(result: {
  hashes?: unknown;
  status?: string;
  message?: string | null;
}): SppPrivatePoolResult {
  const txHashes = collectHashes(result.hashes ?? []);
  const status = result.status && result.status.length > 0 ? result.status : 'ok';
  if (status !== 'ok') {
    const detail = result.message ? ` ${result.message}` : '';
    throw new SppPoolExecuteError(
      status,
      txHashes,
      `SPP pool execute status=${status} completedHashes=${txHashes.join(',')}${detail}`,
    );
  }
  return {
    txHash: txHashes.length === 1 ? txHashes[0]! : null,
    txHashes,
  };
}

export function adaptSdkPrivatePool(pool: SdkPrivatePool): SppPrivatePool {
  return {
    deposit: async (amount) => mapSdkPoolExecuteResult(await pool.deposit(amount)),
    transfer: async (recipient, amount) => mapSdkPoolExecuteResult(await pool.transfer(recipient, amount)),
    withdraw: async (amount, recipient) =>
      mapSdkPoolExecuteResult(await pool.withdraw(amount, recipient ?? undefined)),
  };
}

/**
 * Client.account → derivePrivacyKeys → pool → register write handle.
 * Runs under Nym fetch proxy so SDK RPC cannot silently use clearnet.
 */
export async function initializeSppHostWritePool(
  input: SppWritePoolInitInput,
): Promise<{ poolContract: string }> {
  const signer =
    input.signer ??
    new SppHostRemoteSigner({
      stellarAddress: input.userAddress,
      networkPassphrase: input.networkPassphrase,
      prepareGeneration: input.prepareGeneration,
    });

  return withSppHostNymFetchProxy(input.rpcUrl, async () => {
    const account = await input.client.account(
      {
        networkPassphrase: input.networkPassphrase,
        userAddress: input.userAddress,
      },
      signer,
    );
    await account.derivePrivacyKeys();
    // Indexer sync (no broadcast). On-chain registerPublicKeys is separate and gated.
    try {
      await input.client.sync();
    } catch {
      // Sync failures are non-fatal for pool bind; lookup UX will surface them.
    }
    const sdkPool = (await account.pool({
      poolContract: input.poolContract,
    })) as unknown as SdkPrivatePool;
    const adapted = adaptSdkPrivatePool(sdkPool);
    bindSppHostAccountSurface({
      client: input.client,
      account: account as unknown as Parameters<typeof bindSppHostAccountSurface>[0]['account'],
      userAddress: input.userAddress,
      poolContract: input.poolContract,
      rpcUrl: input.rpcUrl,
      networkPassphrase: input.networkPassphrase,
    });
    registerSppHostWritePool({
      pool: adapted,
      poolContract: input.poolContract,
    });
    return { poolContract: input.poolContract };
  });
}

export function disposeSppHostWritePool(reason?: string): void {
  clearSppHostAccountSurface();
  clearSppHostWritePool(reason);
}
