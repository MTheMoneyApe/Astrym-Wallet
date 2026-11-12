import { afterEach, describe, expect, it } from 'vitest';
import {
  assertSppTestnetBroadcastAuthorized,
  getLastSppBroadcastApprovalPacket,
  isSppTestnetBroadcastAuthorized,
  resetSppBroadcastGateForTests,
  setSppTestnetBroadcastAuthorized,
} from '../../../src/stellar/spp/sppBroadcastGate.js';

afterEach(() => {
  resetSppBroadcastGateForTests();
});

describe('sppBroadcastGate', () => {
  it('defaults to refusing Testnet broadcasts and remembers the approval packet', () => {
    expect(isSppTestnetBroadcastAuthorized()).toBe(false);
    expect(() =>
      assertSppTestnetBroadcastAuthorized({
        network: 'testnet',
        operation: 'deposit',
        poolContract: 'C'.padEnd(56, 'A'),
        amountXlm: '1.0000000',
        amountStroops: '10000000',
        senderAddress: 'G'.padEnd(56, 'A'),
        recipientAddress: null,
        feeNote: 'sdk',
        maxFeeStroops: '15000000',
        rpcUrl: 'https://soroban-testnet.stellar.org',
        transport: 'nym',
        preparedAt: '2026-11-04T00:00:00.000Z',
      }),
    ).toThrow(/SPP_BROADCAST_AWAITING_APPROVAL/);
    expect(getLastSppBroadcastApprovalPacket()?.operation).toBe('deposit');
    expect(getLastSppBroadcastApprovalPacket()?.maxFeeStroops).toBe('15000000');
  });

  it('allows broadcast only after explicit authorization', () => {
    setSppTestnetBroadcastAuthorized(true);
    expect(() =>
      assertSppTestnetBroadcastAuthorized({
        network: 'testnet',
        operation: 'transfer',
        poolContract: 'C'.padEnd(56, 'B'),
        amountXlm: '0.5000000',
        amountStroops: '5000000',
        senderAddress: 'G'.padEnd(56, 'A'),
        recipientAddress: 'G'.padEnd(56, 'B'),
        feeNote: 'sdk',
        maxFeeStroops: '15000000',
        rpcUrl: 'https://soroban-testnet.stellar.org',
        transport: 'nym',
        preparedAt: '2026-11-04T00:00:00.000Z',
      }),
    ).not.toThrow();
  });
});
