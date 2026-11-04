/**
 * Account-scoped sequential transaction state machine for SPP Testnet runs.
 *
 * - Tracks expected sequence per G… independently (sender ≠ recipient).
 * - Advances only after verified confirmation (caller supplies nextSequence).
 * - Detects external/unexpected sequence drift and fail-closes.
 * - Does not broadcast and does not invent confirmations.
 */

export type SppAccountSequenceState = {
  address: string;
  /** Sequence approved at packet freeze (Horizon account.sequence). */
  approvedInitialSequence: string;
  /** Last sequence we verified on-chain for this account (after confirm). */
  confirmedSequence: string | null;
  /** Next sequence we expect Horizon to report before the next submit. */
  expectedFreshSequence: string;
  /** Confirmed tx hashes in order for this account. */
  confirmedTxHashes: string[];
  /** In-flight fingerprint (prevents duplicate submit). */
  inFlightFingerprint: string | null;
};

export type SppSequenceCheckResult =
  | { ok: true; state: SppAccountSequenceState }
  | { ok: false; code: string; message: string };

function parseSeq(value: string): bigint | null {
  if (!/^[0-9]+$/.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

export function createSppAccountSequenceState(input: {
  address: string;
  approvedInitialSequence: string;
}): SppAccountSequenceState {
  const seq = parseSeq(input.approvedInitialSequence);
  if (seq === null) {
    throw new Error('approvedInitialSequence must be a non-negative integer string');
  }
  return {
    address: input.address,
    approvedInitialSequence: input.approvedInitialSequence,
    confirmedSequence: null,
    expectedFreshSequence: input.approvedInitialSequence,
    confirmedTxHashes: [],
    inFlightFingerprint: null,
  };
}

/**
 * Before submit: fresh Horizon sequence must equal the expected next sequence
 * for this account (initial approval or post-confirmation advance).
 */
export function assertFreshSequenceMatchesExpected(
  state: SppAccountSequenceState,
  freshSequence: string,
): SppSequenceCheckResult {
  const fresh = parseSeq(freshSequence);
  if (fresh === null) {
    return {
      ok: false,
      code: 'INVALID_SEQUENCE',
      message: 'freshSequence must be a non-negative integer string',
    };
  }
  const expected = parseSeq(state.expectedFreshSequence);
  if (expected === null) {
    return {
      ok: false,
      code: 'INVALID_SEQUENCE',
      message: 'internal expectedFreshSequence corrupt',
    };
  }
  if (fresh !== expected) {
    return {
      ok: false,
      code: 'SEQUENCE_DRIFT',
      message: `Unexpected sequence for ${state.address}: expected=${state.expectedFreshSequence} fresh=${freshSequence}. External activity or missed confirmation — stop safely.`,
    };
  }
  return { ok: true, state };
}

/**
 * Mark an operation in-flight so a duplicate submit of the same fingerprint is refused.
 */
export function beginSppAccountOperation(
  state: SppAccountSequenceState,
  fingerprint: string,
): SppSequenceCheckResult {
  if (state.inFlightFingerprint) {
    return {
      ok: false,
      code: 'IN_FLIGHT',
      message: `Account ${state.address} already has an in-flight SPP operation.`,
    };
  }
  if (!fingerprint || fingerprint.length < 8) {
    return {
      ok: false,
      code: 'INVALID_REQUEST',
      message: 'Operation fingerprint required',
    };
  }
  return {
    ok: true,
    state: { ...state, inFlightFingerprint: fingerprint },
  };
}

/**
 * After verified ledger confirmation: advance expected sequence.
 * `nextFreshSequence` must be the Horizon sequence AFTER the confirmed tx
 * (typically previous + 1 for a single-source classic/Soroban fee bump source).
 */
export function confirmSppAccountOperation(
  state: SppAccountSequenceState,
  input: {
    fingerprint: string;
    txHash: string;
    /** Horizon sequence observed after confirmation. */
    nextFreshSequence: string;
  },
): SppSequenceCheckResult {
  if (!state.inFlightFingerprint || state.inFlightFingerprint !== input.fingerprint) {
    return {
      ok: false,
      code: 'CONFIRM_MISMATCH',
      message: 'Confirmation fingerprint does not match in-flight operation.',
    };
  }
  if (!input.txHash || input.txHash.length < 8) {
    return {
      ok: false,
      code: 'SUBMISSION_UNKNOWN',
      message: 'Refusing to advance sequence without a verified tx hash.',
    };
  }
  const next = parseSeq(input.nextFreshSequence);
  const expectedBefore = parseSeq(state.expectedFreshSequence);
  if (next === null || expectedBefore === null) {
    return {
      ok: false,
      code: 'INVALID_SEQUENCE',
      message: 'Invalid sequence on confirm',
    };
  }
  if (next <= expectedBefore) {
    return {
      ok: false,
      code: 'SEQUENCE_NOT_ADVANCED',
      message: `Post-confirm sequence ${input.nextFreshSequence} did not advance past ${state.expectedFreshSequence}.`,
    };
  }
  return {
    ok: true,
    state: {
      ...state,
      confirmedSequence: input.nextFreshSequence,
      expectedFreshSequence: input.nextFreshSequence,
      confirmedTxHashes: [...state.confirmedTxHashes, input.txHash],
      inFlightFingerprint: null,
    },
  };
}

/**
 * Failed / rejected / ambiguous: clear in-flight without advancing sequence.
 * Caller must NOT retry until Horizon is re-checked against expectedFreshSequence.
 */
export function abortSppAccountOperation(
  state: SppAccountSequenceState,
  fingerprint: string,
): SppSequenceCheckResult {
  if (state.inFlightFingerprint && state.inFlightFingerprint !== fingerprint) {
    return {
      ok: false,
      code: 'ABORT_MISMATCH',
      message: 'Abort fingerprint does not match in-flight operation.',
    };
  }
  return {
    ok: true,
    state: { ...state, inFlightFingerprint: null },
  };
}

/** Multi-account registry (sender and recipient tracked independently). */
export class SppMultiAccountSequenceTracker {
  private readonly byAddress = new Map<string, SppAccountSequenceState>();

  seed(address: string, approvedInitialSequence: string): SppAccountSequenceState {
    const state = createSppAccountSequenceState({ address, approvedInitialSequence });
    this.byAddress.set(address, state);
    return state;
  }

  get(address: string): SppAccountSequenceState | null {
    return this.byAddress.get(address) ?? null;
  }

  replace(state: SppAccountSequenceState): void {
    this.byAddress.set(state.address, state);
  }

  snapshot(): Record<string, SppAccountSequenceState> {
    const out: Record<string, SppAccountSequenceState> = {};
    for (const [k, v] of this.byAddress) out[k] = { ...v, confirmedTxHashes: [...v.confirmedTxHashes] };
    return out;
  }
}
