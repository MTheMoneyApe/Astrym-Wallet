import { afterEach, describe, expect, it } from 'vitest';
import {
  resetSppBroadcastGateForTests,
  setSppTestnetBroadcastAuthorized,
} from '../../../src/stellar/spp/sppBroadcastGate.js';
import { SppMultiAccountSequenceTracker } from '../../../src/stellar/spp/sppAccountSequenceTracker.js';
import {
  confirmSppAccountOperation,
} from '../../../src/stellar/spp/sppAccountSequenceTracker.js';
import {
  dryValidateSppPresubmitIntent,
  seedSequenceTrackerFromPacket,
  validateSppPresubmitIntent,
  type SppApprovalPacketSnapshot,
} from '../../../src/stellar/spp/sppPresubmitValidation.js';

const PASS = 'Test SDF Network ; September 2015';
const POOL = 'C'.padEnd(56, 'A');
const SENDER = 'G'.padEnd(56, 'A');
const RECIP = 'G'.padEnd(56, 'B');

const packet: SppApprovalPacketSnapshot = {
  networkPassphrase: PASS,
  poolContract: POOL,
  operations: [
    {
      step: 1,
      operation: 'register_public_keys',
      amountStroops: null,
      senderAddress: SENDER,
      recipientAddress: null,
      poolContract: POOL,
      maxFeeStroops: '5000000',
      sequenceAtApproval: '100',
    },
    {
      step: 3,
      operation: 'deposit',
      amountStroops: '20000000',
      senderAddress: SENDER,
      recipientAddress: null,
      poolContract: POOL,
      maxFeeStroops: '8000000',
      sequenceAtApproval: '100',
    },
  ],
};

afterEach(() => {
  resetSppBroadcastGateForTests();
});

describe('validateSppPresubmitIntent multi-step', () => {
  it('refuses while broadcast gate is OFF', () => {
    const tracker = new SppMultiAccountSequenceTracker();
    seedSequenceTrackerFromPacket(packet, tracker);
    const result = validateSppPresubmitIntent(
      packet,
      {
        step: 1,
        operation: 'register_public_keys',
        amountStroops: null,
        senderAddress: SENDER,
        recipientAddress: null,
        poolContract: POOL,
        maxFeeStroops: '5000000',
        freshSequence: '100',
        networkPassphrase: PASS,
        fingerprint: 'fp-register-1',
      },
      tracker,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('BROADCAST_AWAITING_APPROVAL');
  });

  it('dryValidate succeeds with gate OFF for packet preparation', () => {
    const tracker = new SppMultiAccountSequenceTracker();
    seedSequenceTrackerFromPacket(packet, tracker);
    const result = dryValidateSppPresubmitIntent(
      packet,
      {
        step: 1,
        operation: 'register_public_keys',
        amountStroops: null,
        senderAddress: SENDER,
        recipientAddress: null,
        poolContract: POOL,
        maxFeeStroops: '5000000',
        freshSequence: '100',
        networkPassphrase: PASS,
        fingerprint: 'fp-register-dry',
      },
      tracker,
    );
    expect(result.ok).toBe(true);
  });

  it('allows step 3 only after step 1 confirmation advanced the sequence', () => {
    setSppTestnetBroadcastAuthorized(true);
    const tracker = new SppMultiAccountSequenceTracker();
    seedSequenceTrackerFromPacket(packet, tracker);

    const step1 = validateSppPresubmitIntent(
      packet,
      {
        step: 1,
        operation: 'register_public_keys',
        amountStroops: null,
        senderAddress: SENDER,
        recipientAddress: null,
        poolContract: POOL,
        maxFeeStroops: '5000000',
        freshSequence: '100',
        networkPassphrase: PASS,
        fingerprint: 'fp-register-1',
      },
      tracker,
    );
    expect(step1.ok).toBe(true);
    if (!step1.ok) return;

    // Deposit at seq 100 must fail while register is in-flight / not confirmed advance
    const tooEarly = validateSppPresubmitIntent(
      packet,
      {
        step: 3,
        operation: 'deposit',
        amountStroops: '20000000',
        senderAddress: SENDER,
        recipientAddress: null,
        poolContract: POOL,
        maxFeeStroops: '8000000',
        freshSequence: '100',
        networkPassphrase: PASS,
        fingerprint: 'fp-deposit',
      },
      tracker,
    );
    expect(tooEarly.ok).toBe(false);
    if (!tooEarly.ok) expect(tooEarly.code).toBe('IN_FLIGHT');

    const confirmed = confirmSppAccountOperation(step1.sequenceState, {
      fingerprint: 'fp-register-1',
      txHash: 'reghash0123456789',
      nextFreshSequence: '101',
    });
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) return;
    tracker.replace(confirmed.state);

    const deposit = validateSppPresubmitIntent(
      packet,
      {
        step: 3,
        operation: 'deposit',
        amountStroops: '20000000',
        senderAddress: SENDER,
        recipientAddress: null,
        poolContract: POOL,
        maxFeeStroops: '8000000',
        freshSequence: '101',
        networkPassphrase: PASS,
        fingerprint: 'fp-deposit',
      },
      tracker,
    );
    expect(deposit.ok).toBe(true);

    const drift = validateSppPresubmitIntent(
      packet,
      {
        step: 3,
        operation: 'deposit',
        amountStroops: '20000000',
        senderAddress: SENDER,
        recipientAddress: null,
        poolContract: POOL,
        maxFeeStroops: '8000000',
        freshSequence: '999',
        networkPassphrase: PASS,
        fingerprint: 'fp-deposit-2',
      },
      tracker,
    );
    expect(drift.ok).toBe(false);
    if (!drift.ok) expect(['SEQUENCE_DRIFT', 'IN_FLIGHT']).toContain(drift.code);
  });
});
