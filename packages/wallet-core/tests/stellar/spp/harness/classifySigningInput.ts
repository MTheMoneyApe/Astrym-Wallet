/**
 * Offline classification of WalletSigner inputs (message vs tx XDR vs auth preimage).
 * Used by harness tests — does not call Horizon/RPC.
 */

import {
  Address,
  FeeBumpTransaction,
  Transaction,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';

export type ClassifiedSigningInput =
  | { kind: 'message'; message: string }
  | {
      kind: 'transaction';
      networkPassphrase: string;
      source: string;
      signatureCount: number;
      isFeeBump: boolean;
    }
  | {
      kind: 'auth_preimage';
      preimageType: string;
      /** Present when WithAddress variant carries a recognizable ScAddress. */
      boundAddress?: string;
    }
  | { kind: 'unclassified'; reason: string };

export function classifyMessageInput(message: unknown): ClassifiedSigningInput {
  if (typeof message !== 'string') {
    return { kind: 'unclassified', reason: 'message is not a string' };
  }
  return { kind: 'message', message };
}

export function classifyTransactionXdr(
  xdrInput: string,
  networkPassphrase: string,
): ClassifiedSigningInput {
  try {
    const parsed = TransactionBuilder.fromXDR(xdrInput, networkPassphrase);
    if (parsed instanceof FeeBumpTransaction) {
      return {
        kind: 'transaction',
        networkPassphrase,
        source: parsed.innerTransaction.source,
        signatureCount: parsed.signatures.length,
        isFeeBump: true,
      };
    }
    const tx = parsed as Transaction;
    return {
      kind: 'transaction',
      networkPassphrase,
      source: tx.source,
      signatureCount: tx.signatures.length,
      isFeeBump: false,
    };
  } catch (e) {
    return {
      kind: 'unclassified',
      reason: e instanceof Error ? e.message : 'invalid transaction XDR',
    };
  }
}

export function classifyAuthEntryXdr(xdrInput: string): ClassifiedSigningInput {
  try {
    const preimage = xdr.HashIdPreimage.fromXDR(xdrInput, 'base64');
    const preimageType = String((preimage as { type?: unknown }).type ?? 'unknown');
    const out: Extract<ClassifiedSigningInput, { kind: 'auth_preimage' }> = {
      kind: 'auth_preimage',
      preimageType,
    };
    if (preimageType === 'envelopeTypeSorobanAuthorizationWithAddress') {
      const value = preimage.value as { address?: xdr.ScAddress };
      if (value?.address) {
        try {
          out.boundAddress = Address.fromScAddress(value.address).toString();
        } catch {
          // leave unbound if ScAddress is not decodable here
        }
      }
    }
    return out;
  } catch (e) {
    return {
      kind: 'unclassified',
      reason: e instanceof Error ? e.message : 'invalid auth preimage XDR',
    };
  }
}
