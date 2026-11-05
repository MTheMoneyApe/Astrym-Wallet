/**
 * In-memory registry of disposable Testnet S… → WalletSigner bindings.
 *
 * Used so spp-host remote signing can authorize the funded disposable G…
 * accounts (raw S seeds) that SoftwareSigner HD paths cannot represent.
 *
 * Lab-only: secrets stay in process memory; never logged; cleared on demand.
 * Refuses Mainnet.
 */

import { Networks } from '@stellar/stellar-sdk';
import type { WalletSigner } from 'stellar-private-payments';
import { StellarSecretKeyWalletSigner } from '@solanym/wallet-core/src/stellar/spp/StellarSecretKeyWalletSigner.js';

const byAddress = new Map<string, WalletSigner>();

export function clearDisposableTestnetSigners(): void {
  byAddress.clear();
}

export function listDisposableTestnetSignerAddresses(): string[] {
  return [...byAddress.keys()];
}

export function getDisposableTestnetSigner(address: string): WalletSigner | null {
  return byAddress.get(address) ?? null;
}

/**
 * Bind a disposable Testnet secret to its expected G… address.
 * Throws on Mainnet passphrase or identity mismatch (never logs the secret).
 */
export function bindDisposableTestnetSigner(input: {
  secret: string;
  expectedAddress: string;
  networkPassphrase?: string;
}): { address: string } {
  const networkPassphrase = input.networkPassphrase ?? Networks.TESTNET;
  if (networkPassphrase === Networks.PUBLIC) {
    throw new Error('Disposable Testnet signer registry refuses Mainnet');
  }
  const signer = new StellarSecretKeyWalletSigner({
    secret: input.secret,
    expectedAddress: input.expectedAddress,
    networkPassphrase,
  });
  byAddress.set(input.expectedAddress, signer);
  return { address: input.expectedAddress };
}
