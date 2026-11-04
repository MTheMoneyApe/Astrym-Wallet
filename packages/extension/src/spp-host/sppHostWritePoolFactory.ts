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
import { SppHostRemoteSigner } from './sppHostRemoteSigner.js';
import { withSppHostNymFetchProxy } from './sppHostNymFetchProxy.js';

export type SppWritePoolInitInput = {
  client: Client;
  rpcUrl: string;
  poolContract: string;
  userAddress: string;
  networkPassphrase: string;
  /** Optional injected signer (tests). Defaults to SW remote signer. */
  signer?: WalletSigner;
};

export type SdkPrivatePool = {
  deposit(amount: bigint): Promise<{ hashes: string[]; status: string }>;
  transfer(recipient: string, amount: bigint): Promise<{ hashes: string[]; status: string }>;
  withdraw(amount: bigint, recipient?: string | null): Promise<{ hashes: string[]; status: string }>;
};

function mapExecuteResult(result: { hashes: string[]; status: string }): SppPrivatePoolResult {
  if (result.status && result.status !== 'ok') {
    throw new Error(`SPP pool execute status=${result.status}`);
  }
  const hash = result.hashes?.[0] ?? null;
  // Never invent a hash. Null means SDK returned ok without a hash (caller must not treat as confirmed).
  return { txHash: hash };
}

export function adaptSdkPrivatePool(pool: SdkPrivatePool): SppPrivatePool {
  return {
    deposit: async (amount) => mapExecuteResult(await pool.deposit(amount)),
    transfer: async (recipient, amount) => mapExecuteResult(await pool.transfer(recipient, amount)),
    withdraw: async (amount, recipient) =>
      mapExecuteResult(await pool.withdraw(amount, recipient ?? undefined)),
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
    const sdkPool = (await account.pool({
      poolContract: input.poolContract,
    })) as unknown as SdkPrivatePool;
    const adapted = adaptSdkPrivatePool(sdkPool);
    registerSppHostWritePool({
      pool: adapted,
      poolContract: input.poolContract,
    });
    return { poolContract: input.poolContract };
  });
}

export function disposeSppHostWritePool(reason?: string): void {
  clearSppHostWritePool(reason);
}
