/**
 * Host-side fee scope. execute/register open it; the remote signer reads it
 * and calls the same {@link assertSppAssembledFees} the service worker uses.
 * A signature with no scope fails closed.
 */

import {
  assertSppAssembledFees,
  assertStellarTestnetPassphrase,
  inspectSppAuthEntry,
  type SppSignOperation,
} from '@solanym/wallet-core/src/stellar/spp/sppSignGate.js';

export type SppHostFeeScope = {
  operation: SppSignOperation;
  approvedMaxFeeStroops: string;
  minResourceFeeStroops: string | null;
  allowedContractId: string;
  networkPassphrase: string;
};

let active: SppHostFeeScope | null = null;

export async function runWithSppHostFeeScope<T>(
  scope: SppHostFeeScope,
  fn: () => Promise<T>,
): Promise<T> {
  assertStellarTestnetPassphrase(scope.networkPassphrase);
  if (active) {
    throw new Error('SPP host fee scope is already active');
  }
  active = scope;
  try {
    return await fn();
  } finally {
    active = null;
  }
}

export function resetSppHostFeeScopeForTests(): void {
  active = null;
}

function requireScope(): SppHostFeeScope {
  if (!active) {
    throw new Error('SPP host signature refused: no active fee scope');
  }
  assertStellarTestnetPassphrase(active.networkPassphrase);
  return active;
}

/** Envelope fee check used by the host signer before the request is forwarded. */
export function assertHostAssembledTransactionFee(txFeeStroops: string | bigint): void {
  const scope = requireScope();
  assertSppAssembledFees({
    operation: scope.operation,
    approvedMaxFeeStroops: scope.approvedMaxFeeStroops,
    txFeeStroops,
    minResourceFeeStroops: scope.minResourceFeeStroops,
    requireTxFee: true,
    requireMinResourceFee: scope.minResourceFeeStroops !== null,
  });
}

/** Auth-entry networkId, address, and contract check on the host path. */
export function assertHostAuthEntry(xdrInput: string, boundAccount: string): void {
  const scope = requireScope();
  const inspected = inspectSppAuthEntry(xdrInput, boundAccount);
  if (inspected.contractId !== scope.allowedContractId) {
    throw new Error('SPP host refused an auth entry for a contract outside the fee scope');
  }
  const expected = scope.operation === 'register_public_keys' ? 'register' : 'transact';
  if (inspected.functionName !== expected) {
    throw new Error(`SPP host refused auth function "${inspected.functionName}"`);
  }
}
