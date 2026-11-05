import { StrKey } from '@solanym/wallet-core';
import type { KeyManager } from '@solanym/wallet-core/src/keyManager/KeyManager.js';
import { activeAccountManager } from '../accounts/ActiveAccountManager.js';

export async function resolveActiveStellarAddress(
  keyManager: KeyManager,
): Promise<{ index: number; address: string }> {
  const index = activeAccountManager.getActiveAccountIndex();
  if (!Number.isInteger(index) || index < 0) {
    throw new Error('No active Stellar account');
  }
  const accounts = await keyManager.getAccounts();
  const account = accounts.find((entry) => entry.index === index);
  if (!account) {
    throw new Error(`Active account index ${index} not found`);
  }
  const address = StrKey.encodeEd25519PublicKey(account.publicKey);
  if (!StrKey.isValidEd25519PublicKey(address)) {
    throw new Error('Active account is not a Stellar G… address');
  }
  return { index, address };
}
