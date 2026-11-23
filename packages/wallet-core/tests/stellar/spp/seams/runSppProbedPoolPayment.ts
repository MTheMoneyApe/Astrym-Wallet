/**
 * Test-only entry for the probe + pool path. Nothing under src/ imports this
 * module. Broadcast, fee ceiling, fingerprint, and in-flight checks still run
 * inside executeSppPrivatePayment. Economics stays fail-closed unless this
 * seam sets sppProbeEconomicsBypass for the call.
 */
import { Keypair, StrKey } from '@stellar/stellar-sdk';
import { privatePaymentFingerprint } from '../../../../src/stellar/spp/sppExecutionGuard.js';
import {
  executeSppPrivatePayment,
  type SppPrivateOperation,
  type SppPrivatePool,
  type SppRpcFetch,
} from '../../../../src/stellar/spp/sppNymOption.js';
import { sppProbeEconomicsBypass } from './sppProbeEconomicsBypass.js';

export async function runSppProbedPoolPayment(input: {
  request: {
    operation: SppPrivateOperation;
    amount: bigint;
    recipient: string | null;
  };
  rpcUrl: string;
  nymFetch: SppRpcFetch;
  pool: SppPrivatePool;
  preferInjectedTransport?: boolean;
  confirmTransaction?: (
    hash: string,
  ) => Promise<'SUCCESS' | 'FAILED' | 'NOT_FOUND' | 'UNKNOWN'>;
}): Promise<{
  operation: SppPrivateOperation;
  txHash: string | null;
  txHashes: readonly string[];
  rpcRoutedViaNym: true;
  confirmation: 'confirmed' | 'submitted' | 'unknown';
}> {
  const poolContract = StrKey.encodeContract(Keypair.random().rawPublicKey());
  const amountStroops = input.request.amount.toString();
  const recipient = input.request.recipient;
  const request = {
    operation: input.request.operation,
    poolContract,
    amountStroops,
    ...(recipient ? { recipient } : {}),
  };
  const authorizationFingerprint = privatePaymentFingerprint({
    operation: request.operation,
    poolContract,
    amountStroops,
    recipient,
  });
  sppProbeEconomicsBypass.enabled = true;
  try {
    return await executeSppPrivatePayment({
      gate: { mode: 'nym', connected: true, selected: true },
      request,
      rpcUrl: input.rpcUrl,
      nymFetch: input.nymFetch,
      pool: input.pool,
      authorizationFingerprint,
      ...(input.preferInjectedTransport === undefined
        ? {}
        : { preferInjectedTransport: input.preferInjectedTransport }),
      ...(input.confirmTransaction === undefined
        ? {}
        : { confirmTransaction: input.confirmTransaction }),
    });
  } finally {
    sppProbeEconomicsBypass.enabled = false;
  }
}
