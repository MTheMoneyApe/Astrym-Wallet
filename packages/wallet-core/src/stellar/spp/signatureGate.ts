/**
 * Contextual signature authorization for the SPP WalletSigner adapter.
 *
 * Guarantees of this gate (when used correctly):
 *   - Each lease is one-shot and bound to an exact {@link SignatureAuthContext}
 *     (kind, account, network passphrase, payload digest).
 *   - assertActive rejects context mismatches, revoked/ended leases, and reuse.
 *   - Concurrent leases cannot be crossed: lease L1 only matches the context
 *     stored at authorize(L1).
 *
 * Does NOT guarantee:
 *   - User UI review or semantic inspection of transactions / Soroban invocations.
 *   - Compatibility with extension {@code StateCoordinator.authorizeSignature()},
 *     which only tracks lifecycle/epoch locks and does NOT bind a payload.
 *     Future extension wiring must call {@link ContextualSignatureGate.approve}
 *     with the reviewed context (or an equivalent) before the adapter's
 *     {@link SignatureAuthorizationGate.authorize} can succeed under
 *     {@code require-prior-approval} mode.
 */

export type SignatureKind = 'message' | 'transaction' | 'auth_entry';

/** Exact signing intent that must be authorized and re-asserted before Ed25519. */
export type SignatureAuthContext = {
  kind: SignatureKind;
  /** Bound G… account that will produce the signature. */
  account: string;
  /** Network passphrase bound to the adapter / request. */
  networkPassphrase: string;
  /** Hex encoding of the exact 32-byte digest that will be passed to the signer. */
  payloadDigestHex: string;
};

/** Opaque one-shot lease token. */
export type SignatureLease = object;

export interface SignatureAuthorizationGate {
  authorize(context: SignatureAuthContext): SignatureLease;
  assertActive(lease: SignatureLease, context: SignatureAuthContext): void;
  end(lease: SignatureLease): void;
}

/**
 * Gate with optional prior-approval queue for extension UI wiring.
 *
 * - {@code require-prior-approval} (default): {@link approve} must have been
 *   called with an exactly matching context before {@link authorize} succeeds.
 * - {@code bind-on-authorize}: authorize binds the supplied context immediately
 *   (for offline unit tests of crypto paths). Still NOT a blank lease — assert
 *   requires the same context; leases remain one-shot.
 */
export type ContextualGateApprovalMode = 'require-prior-approval' | 'bind-on-authorize';

export interface ContextualSignatureGate extends SignatureAuthorizationGate {
  /** Record a reviewed context that may later be consumed by authorize (FIFO, exact match). */
  approve(context: SignatureAuthContext): void;
  /** Test/observability: number of active (not yet ended) leases. */
  activeLeaseCount(): number;
}

type StoredLease = {
  id: string;
  context: SignatureAuthContext;
  revoked: boolean;
};

let leaseSeq = 0;

function freezeContext(context: SignatureAuthContext): SignatureAuthContext {
  if (
    context.kind !== 'message' &&
    context.kind !== 'transaction' &&
    context.kind !== 'auth_entry'
  ) {
    throw new Error('Invalid signature kind');
  }
  if (typeof context.account !== 'string' || context.account.length === 0) {
    throw new Error('Signature context requires account');
  }
  if (typeof context.networkPassphrase !== 'string' || context.networkPassphrase.length === 0) {
    throw new Error('Signature context requires networkPassphrase');
  }
  if (
    typeof context.payloadDigestHex !== 'string' ||
    !/^[0-9a-f]{64}$/i.test(context.payloadDigestHex)
  ) {
    throw new Error('Signature context requires a 32-byte digest as 64 hex chars');
  }
  return Object.freeze({
    kind: context.kind,
    account: context.account,
    networkPassphrase: context.networkPassphrase,
    payloadDigestHex: context.payloadDigestHex.toLowerCase(),
  });
}

export function contextsEqual(a: SignatureAuthContext, b: SignatureAuthContext): boolean {
  return (
    a.kind === b.kind &&
    a.account === b.account &&
    a.networkPassphrase === b.networkPassphrase &&
    a.payloadDigestHex.toLowerCase() === b.payloadDigestHex.toLowerCase()
  );
}

export function digestToHex(digest: Uint8Array): string {
  if (digest.byteLength !== 32) {
    throw new Error('Signing digest must be exactly 32 bytes');
  }
  return Buffer.from(digest).toString('hex');
}

export function createContextualSignatureGate(
  approvalMode: ContextualGateApprovalMode = 'require-prior-approval',
): ContextualSignatureGate {
  const active = new Map<object, StoredLease>();
  const pendingApprovals: SignatureAuthContext[] = [];

  return {
    approve(context: SignatureAuthContext): void {
      pendingApprovals.push(freezeContext(context));
    },

    authorize(context: SignatureAuthContext): SignatureLease {
      const frozen = freezeContext(context);

      if (approvalMode === 'require-prior-approval') {
        const idx = pendingApprovals.findIndex((p) => contextsEqual(p, frozen));
        if (idx < 0) {
          throw new Error('Signature authorization denied: no matching prior approval for context');
        }
        pendingApprovals.splice(idx, 1);
      }

      const lease = Object.freeze({ __sppLease: ++leaseSeq });
      active.set(lease, {
        id: String(leaseSeq),
        context: frozen,
        revoked: false,
      });
      return lease;
    },

    assertActive(lease: SignatureLease, context: SignatureAuthContext): void {
      const stored = active.get(lease);
      if (!stored || stored.revoked) {
        throw new Error('Signature authorization is no longer active');
      }
      const expected = freezeContext(context);
      if (!contextsEqual(stored.context, expected)) {
        throw new Error('Signature authorization context mismatch');
      }
    },

    end(lease: SignatureLease): void {
      const stored = active.get(lease);
      if (!stored) return;
      stored.revoked = true;
      active.delete(lease);
    },

    activeLeaseCount(): number {
      return active.size;
    },
  };
}

/** Gate that refuses all signing (unauthorized). */
export function createRejectingSignatureGate(
  message = 'Signature authorization denied',
): SignatureAuthorizationGate {
  return {
    authorize(): SignatureLease {
      throw new Error(message);
    },
    assertActive(): void {
      throw new Error(message);
    },
    end(): void {},
  };
}
