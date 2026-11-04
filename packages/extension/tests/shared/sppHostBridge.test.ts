import { describe, expect, it } from 'vitest';
import {
  SPP_HOST_BRIDGE_CHANNEL,
  isSppHostBridgeMessage,
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
