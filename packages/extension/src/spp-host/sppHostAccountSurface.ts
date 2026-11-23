/**
 * Account-level SPP surface retained next to the write pool:
 * registration status, recipient lookup, private balance / notes.
 *
 * registerPublicKeys broadcasts — gated by sppBroadcastGate (default OFF).
 */

import type { Client } from 'stellar-private-payments';
import { assertSppTestnetBroadcastAuthorized } from '@solanym/wallet-core/src/stellar/spp/sppBroadcastGate.js';
import { Networks } from '@stellar/stellar-sdk';
import { maxFeeStroopsForOperation } from '@solanym/wallet-core/src/stellar/spp/sppFeePolicy.js';
import { NETHERMIND_PUBLIC_TESTNET_DEPLOYMENTS } from '@solanym/wallet-core/src/stellar/spp/nethermind/nethermindPublicTestnet.js';
import { runWithSppHostFeeScope } from './sppHostFeeScope.js';
import { withSppHostNymFetchProxy } from './sppHostNymFetchProxy.js';

type SdkAccount = {
  derivePrivacyKeys(): Promise<unknown>;
  isRegistered(): Promise<boolean>;
  registerPublicKeys(): Promise<string>;
  privacyKeys(): Promise<{ noteKey?: string; encryptionKey?: string } | unknown>;
  userNotes(limit: number): Promise<Array<{ id: string; amount: string; spent: boolean }>>;
  pool(opts: { poolContract: string }): Promise<{
    balance(): Promise<bigint>;
    notes(): Promise<unknown[]>;
  }>;
};

export type SppHostAccountSnapshot = {
  userAddress: string;
  poolContract: string;
  registered: boolean | null;
  privateBalanceStroops: string | null;
  noteCount: number | null;
};

export type SppRecipientLookupResult = {
  address: string;
  found: boolean;
  registryFullySynced: boolean | null;
  networkTipLedger: number | null;
  noteKeyPresent: boolean;
  encryptionKeyPresent: boolean;
};

let boundClient: Client | null = null;
let boundAccount: SdkAccount | null = null;
let boundUserAddress: string | null = null;
let boundPoolContract: string | null = null;
let boundRpcUrl: string | null = null;
let boundNetworkPassphrase: string | null = null;

export function bindSppHostAccountSurface(input: {
  client: Client;
  account: SdkAccount;
  userAddress: string;
  poolContract: string;
  rpcUrl: string;
  networkPassphrase: string;
}): void {
  boundClient = input.client;
  boundAccount = input.account;
  boundUserAddress = input.userAddress;
  boundPoolContract = input.poolContract;
  boundRpcUrl = input.rpcUrl;
  boundNetworkPassphrase = input.networkPassphrase;
}

export function clearSppHostAccountSurface(): void {
  boundClient = null;
  boundAccount = null;
  boundUserAddress = null;
  boundPoolContract = null;
  boundRpcUrl = null;
  boundNetworkPassphrase = null;
}

export function getSppHostAccountBinding(): {
  ready: boolean;
  userAddress: string | null;
  poolContract: string | null;
} {
  return {
    ready: Boolean(boundAccount && boundClient && boundPoolContract && boundRpcUrl),
    userAddress: boundUserAddress,
    poolContract: boundPoolContract,
  };
}

async function requireBound(): Promise<{
  client: Client;
  account: SdkAccount;
  userAddress: string;
  poolContract: string;
  rpcUrl: string;
  networkPassphrase: string;
}> {
  if (
    !boundClient ||
    !boundAccount ||
    !boundUserAddress ||
    !boundPoolContract ||
    !boundRpcUrl ||
    !boundNetworkPassphrase
  ) {
    throw new Error('SPP account surface not bound (write pool / Client missing).');
  }
  return {
    client: boundClient,
    account: boundAccount,
    userAddress: boundUserAddress,
    poolContract: boundPoolContract,
    rpcUrl: boundRpcUrl,
    networkPassphrase: boundNetworkPassphrase,
  };
}

export async function syncSppHostAccountIndexer(): Promise<void> {
  const { client, rpcUrl } = await requireBound();
  await withSppHostNymFetchProxy(rpcUrl, async () => {
    await client.sync();
  });
}

export async function readSppHostAccountSnapshot(): Promise<SppHostAccountSnapshot> {
  const { account, userAddress, poolContract, rpcUrl } = await requireBound();
  return withSppHostNymFetchProxy(rpcUrl, async () => {
    let registered: boolean | null = null;
    let privateBalanceStroops: string | null = null;
    let noteCount: number | null = null;
    try {
      registered = await account.isRegistered();
    } catch {
      registered = null;
    }
    try {
      const pool = await account.pool({ poolContract });
      const bal = await pool.balance();
      privateBalanceStroops = bal.toString();
      const notes = await pool.notes();
      noteCount = Array.isArray(notes) ? notes.length : null;
    } catch {
      privateBalanceStroops = null;
      noteCount = null;
    }
    return {
      userAddress,
      poolContract,
      registered,
      privateBalanceStroops,
      noteCount,
    };
  });
}

export async function lookupSppRecipient(address: string): Promise<SppRecipientLookupResult> {
  const trimmed = address.trim();
  const { client, rpcUrl } = await requireBound();
  return withSppHostNymFetchProxy(rpcUrl, async () => {
    await client.sync();
    const lookup = await client.recipientLookup(trimmed);
    const entry = lookup?.entry;
    return {
      address: trimmed,
      found: Boolean(entry),
      registryFullySynced:
        typeof lookup?.registryFullySynced === 'boolean' ? lookup.registryFullySynced : null,
      networkTipLedger:
        typeof lookup?.networkTipLedger === 'number' ? lookup.networkTipLedger : null,
      noteKeyPresent: Boolean(entry && (entry as { noteKey?: string }).noteKey),
      encryptionKeyPresent: Boolean(entry && (entry as { encryptionKey?: string }).encryptionKey),
    };
  });
}

/**
 * On-chain public-key registration. Broadcasts — blocked until broadcast gate opens.
 */
export async function registerSppHostPublicKeys(): Promise<{ txHash: string }> {
  const { account, userAddress, poolContract, rpcUrl } = await requireBound();
  const maxFeeStroops = maxFeeStroopsForOperation('register_public_keys');
  assertSppTestnetBroadcastAuthorized({
    network: 'testnet',
    operation: 'register_public_keys',
    poolContract,
    amountXlm: null,
    amountStroops: null,
    senderAddress: userAddress,
    recipientAddress: null,
    feeNote: 'Registry registration fee set by SDK/Soroban at submit; capped by maxFeeStroops.',
    maxFeeStroops,
    rpcUrl,
    transport: 'nym',
    preparedAt: new Date().toISOString(),
  });
  return runWithSppHostFeeScope(
    {
      operation: 'register_public_keys',
      approvedMaxFeeStroops: maxFeeStroops,
      minResourceFeeStroops: null,
      allowedContractId: NETHERMIND_PUBLIC_TESTNET_DEPLOYMENTS.public_key_registry,
      networkPassphrase: Networks.TESTNET,
    },
    () => withSppHostNymFetchProxy(rpcUrl, async () => {
      const txHash = await account.registerPublicKeys();
      if (!txHash || typeof txHash !== 'string') {
        throw new Error('registerPublicKeys returned no hash (fail-closed).');
      }
      return { txHash };
    }),
  );
}
