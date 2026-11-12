/**
 * Hard gate for Testnet private-payment broadcasts (deposit / transfer / withdraw
 * and on-chain registerPublicKeys). Default OFF until an operator explicitly
 * authorizes a concrete approval packet (accounts, amounts, fees, operation).
 *
 * Never flip this for Mainnet. Never invent success when the gate refuses.
 */

export type SppBroadcastApprovalPacket = {
  network: 'testnet';
  operation: 'deposit' | 'transfer' | 'withdraw' | 'register_public_keys';
  poolContract: string;
  amountXlm: string | null;
  amountStroops: string | null;
  senderAddress: string | null;
  recipientAddress: string | null;
  feeNote: string;
  /** Explicit fee ceiling in stroops; required before any authorized broadcast. */
  maxFeeStroops: string | null;
  rpcUrl: string;
  transport: 'nym';
  preparedAt: string;
};

/** Process-local authorization. Remains false until setSppTestnetBroadcastAuthorized(true). */
let authorized = false;
let lastPacket: SppBroadcastApprovalPacket | null = null;

export function isSppTestnetBroadcastAuthorized(): boolean {
  return authorized;
}

export function setSppTestnetBroadcastAuthorized(value: boolean): void {
  authorized = value === true;
}

export function rememberSppBroadcastApprovalPacket(
  packet: SppBroadcastApprovalPacket,
): SppBroadcastApprovalPacket {
  lastPacket = packet;
  return packet;
}

export function getLastSppBroadcastApprovalPacket(): SppBroadcastApprovalPacket | null {
  return lastPacket;
}

export function assertSppTestnetBroadcastAuthorized(
  packet: SppBroadcastApprovalPacket,
): void {
  rememberSppBroadcastApprovalPacket(packet);
  if (!authorized) {
    throw new Error(
      [
        'SPP_BROADCAST_AWAITING_APPROVAL:',
        `operation=${packet.operation}`,
        `pool=${packet.poolContract}`,
        `amountXlm=${packet.amountXlm ?? 'n/a'}`,
        `amountStroops=${packet.amountStroops ?? 'n/a'}`,
        `sender=${packet.senderAddress ?? 'n/a'}`,
        `recipient=${packet.recipientAddress ?? 'n/a'}`,
        `feeNote=${packet.feeNote}`,
        `maxFeeStroops=${packet.maxFeeStroops ?? 'n/a'}`,
        `rpc=${packet.rpcUrl}`,
        'transport=nym',
        'No Testnet broadcast until explicit operator approval.',
      ].join(' '),
    );
  }
}

/** Test helper — resets gate + remembered packet. */
export function resetSppBroadcastGateForTests(): void {
  authorized = false;
  lastPacket = null;
}
