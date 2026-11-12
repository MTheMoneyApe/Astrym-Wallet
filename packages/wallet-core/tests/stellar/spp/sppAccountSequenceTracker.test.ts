import { describe, expect, it } from 'vitest';
import {
  SppMultiAccountSequenceTracker,
  abortSppAccountOperation,
  assertFreshSequenceMatchesExpected,
  beginSppAccountOperation,
  confirmSppAccountOperation,
  createSppAccountSequenceState,
} from '../../../src/stellar/spp/sppAccountSequenceTracker.js';

describe('sppAccountSequenceTracker', () => {
  it('tracks sender and recipient independently and advances only on confirm', () => {
    const tracker = new SppMultiAccountSequenceTracker();
    const sender = tracker.seed('G'.padEnd(56, 'A'), '100');
    const recipient = tracker.seed('G'.padEnd(56, 'B'), '200');

    expect(assertFreshSequenceMatchesExpected(sender, '100').ok).toBe(true);
    expect(assertFreshSequenceMatchesExpected(sender, '101').ok).toBe(false);

    const begun = beginSppAccountOperation(sender, 'fp-sender-1');
    expect(begun.ok).toBe(true);
    if (!begun.ok) return;
    tracker.replace(begun.state);

    const confirmed = confirmSppAccountOperation(begun.state, {
      fingerprint: 'fp-sender-1',
      txHash: 'abcdef0123456789',
      nextFreshSequence: '101',
    });
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) return;
    tracker.replace(confirmed.state);

    expect(assertFreshSequenceMatchesExpected(confirmed.state, '101').ok).toBe(true);
    // Recipient unchanged
    expect(assertFreshSequenceMatchesExpected(recipient, '200').ok).toBe(true);
    expect(assertFreshSequenceMatchesExpected(recipient, '101').ok).toBe(false);
  });

  it('aborts without advancing and refuses duplicate in-flight', () => {
    let state = createSppAccountSequenceState({
      address: 'G'.padEnd(56, 'A'),
      approvedInitialSequence: '50',
    });
    const begun = beginSppAccountOperation(state, 'fp-abort-1');
    expect(begun.ok).toBe(true);
    if (!begun.ok) return;
    state = begun.state;
    expect(beginSppAccountOperation(state, 'fp-abort-2').ok).toBe(false);
    const aborted = abortSppAccountOperation(state, 'fp-abort-1');
    expect(aborted.ok).toBe(true);
    if (!aborted.ok) return;
    expect(aborted.state.expectedFreshSequence).toBe('50');
    expect(aborted.state.inFlightFingerprint).toBeNull();
  });

  it('refuses confirm without hash or when sequence did not advance', () => {
    const state = createSppAccountSequenceState({
      address: 'G'.padEnd(56, 'A'),
      approvedInitialSequence: '10',
    });
    const begun = beginSppAccountOperation(state, 'fp-confirm');
    expect(begun.ok).toBe(true);
    if (!begun.ok) return;
    expect(
      confirmSppAccountOperation(begun.state, {
        fingerprint: 'fp-confirm',
        txHash: '',
        nextFreshSequence: '11',
      }).ok,
    ).toBe(false);
    expect(
      confirmSppAccountOperation(begun.state, {
        fingerprint: 'fp-confirm',
        txHash: 'hashhashhash',
        nextFreshSequence: '10',
      }).ok,
    ).toBe(false);
  });
});
