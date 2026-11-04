import { describe, expect, it } from 'vitest';
import {
  SPP_HOST_BRIDGE_CHANNEL,
  isSppHostBridgeMessage,
  parseSppHostAccountQueryRequest,
  parseSppHostAccountQueryResult,
  parseSppHostExecuteRequest,
  parseSppHostExecuteResult,
  parseSppHostLifecycleEvent,
} from '../../src/shared/sppHostBridge.js';

describe('sppHostBridge schemas', () => {
  it('accepts lifecycle events and rejects malformed envelopes', () => {
    expect(isSppHostBridgeMessage({ channel: SPP_HOST_BRIDGE_CHANNEL })).toBe(true);
    expect(isSppHostBridgeMessage({ channel: 'other' })).toBe(false);

    const ok = parseSppHostLifecycleEvent({
      channel: SPP_HOST_BRIDGE_CHANNEL,
      type: 'SPP_HOST_POOL_LIFECYCLE',
      generation: 2,
      state: 'write_pool_ready',
    });
    expect(ok?.state).toBe('write_pool_ready');
    expect(parseSppHostLifecycleEvent({ channel: SPP_HOST_BRIDGE_CHANNEL, type: 'NOPE' })).toBeNull();
  });

  it('validates execute requests without accepting secrets-shaped fields', () => {
    const parsed = parseSppHostExecuteRequest({
      channel: SPP_HOST_BRIDGE_CHANNEL,
      type: 'SPP_HOST_EXECUTE_PRIVATE_PAYMENT',
      id: 'req-1',
      payload: {
        operation: 'deposit',
        poolContract: 'C'.padEnd(56, 'A'),
        amountStroops: '10',
        rpcUrl: 'https://soroban-testnet.stellar.org',
        nymMode: 'nym',
        nymConnected: true,
        sppSelected: true,
        mnemonic: 'should-be-stripped-by-schema',
      },
    });
    expect(parsed?.payload.operation).toBe('deposit');
    expect(parsed?.payload).not.toHaveProperty('mnemonic');
  });

  it('accepts optional account-sequence fields on execute requests', () => {
    const parsed = parseSppHostExecuteRequest({
      channel: SPP_HOST_BRIDGE_CHANNEL,
      type: 'SPP_HOST_EXECUTE_PRIVATE_PAYMENT',
      id: 'req-seq',
      payload: {
        operation: 'transfer',
        poolContract: 'C'.padEnd(56, 'A'),
        amountStroops: '10',
        recipient: 'G'.padEnd(56, 'B'),
        rpcUrl: 'https://soroban-testnet.stellar.org',
        nymMode: 'nym',
        nymConnected: true,
        sppSelected: true,
        signingAccount: 'G'.padEnd(56, 'A'),
        freshSequence: '100',
        nextFreshSequence: '101',
        operationFingerprint: 'deposit|pool|10|',
      },
    });
    expect(parsed?.payload.signingAccount).toBe('G'.padEnd(56, 'A'));
    expect(parsed?.payload.freshSequence).toBe('100');
    expect(parsed?.payload.nextFreshSequence).toBe('101');
    expect(parsed?.payload.operationFingerprint).toBe('deposit|pool|10|');

    expect(
      parseSppHostExecuteRequest({
        channel: SPP_HOST_BRIDGE_CHANNEL,
        type: 'SPP_HOST_EXECUTE_PRIVATE_PAYMENT',
        id: 'req-bad-seq',
        payload: {
          operation: 'deposit',
          poolContract: 'C'.padEnd(56, 'A'),
          amountStroops: '10',
          rpcUrl: 'https://soroban-testnet.stellar.org',
          nymMode: 'nym',
          nymConnected: true,
          sppSelected: true,
          freshSequence: 'not-a-number',
        },
      }),
    ).toBeNull();
  });

  it('validates account query envelopes for snapshot and lookup', () => {
    const req = parseSppHostAccountQueryRequest({
      channel: SPP_HOST_BRIDGE_CHANNEL,
      type: 'SPP_HOST_ACCOUNT_QUERY',
      id: 'aq-1',
      payload: {
        action: 'recipient_lookup',
        recipientAddress: 'G'.padEnd(56, 'B'),
        nymMode: 'nym',
        nymConnected: true,
      },
    });
    expect(req?.payload.action).toBe('recipient_lookup');

    const ok = parseSppHostAccountQueryResult({
      channel: SPP_HOST_BRIDGE_CHANNEL,
      type: 'SPP_HOST_ACCOUNT_QUERY_RESULT',
      id: 'aq-1',
      ok: true,
      action: 'snapshot',
      snapshot: {
        userAddress: 'G'.padEnd(56, 'A'),
        poolContract: 'C'.padEnd(56, 'A'),
        registered: false,
        privateBalanceStroops: '0',
        noteCount: 0,
      },
      rpcRoutedViaNym: true,
    });
    expect(ok?.ok).toBe(true);
  });

  it('distinguishes success and failure execute results', () => {
    const success = parseSppHostExecuteResult({
      channel: SPP_HOST_BRIDGE_CHANNEL,
      type: 'SPP_HOST_EXECUTE_PRIVATE_PAYMENT_RESULT',
      id: '1',
      ok: true,
      operation: 'withdraw',
      txHash: 'abc',
      rpcRoutedViaNym: true,
    });
    expect(success?.ok).toBe(true);

    const failure = parseSppHostExecuteResult({
      channel: SPP_HOST_BRIDGE_CHANNEL,
      type: 'SPP_HOST_EXECUTE_PRIVATE_PAYMENT_RESULT',
      id: '1',
      ok: false,
      code: 'SESSION_NOT_READY',
      message: 'no write pool',
    });
    expect(failure?.ok).toBe(false);
  });
});
