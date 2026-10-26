/**
 * Fase 2.16/2.17 — adversarial tests for offline ApprovedIntent / IntentStore.
 * Synthetic only. No network, no SPP ops, no real signature gate.
 *
 * Classification tags in test titles / comments:
 *   REJECT_OK | ACCEPT_OK | GAP | LIMIT_ARCH
 */
import { describe, expect, it } from 'vitest';
import { sha256 } from '@noble/hashes/sha2.js';
import {
  APPROVED_INTENT_SCHEMA_VERSION,
  INTENT_LIMITS,
  IntentStore,
  IntentTransitionError,
  assertTrustedDigestFn,
  computeOperationDigest,
  computePlanDigest,
  createIntentStore,
  encodePlanPayload,
  probeDigestFnNotConstant,
  validateApprovedIntentStructure,
  wrapSha256AsTrusted,
  type ApprovedIntent,
  type Clock,
  type DigestFn,
  type TrustedDigestFn,
} from './index.js';
import { probeDigestFnNotConstant as probeDirect } from './digestSecurity.js';

const ACCOUNT = 'GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6';
const ACCOUNT2 = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';
const POOL = 'CACQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQLC2U';
const TOKEN = 'CADAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMSST';
const NETWORK = 'Test SDF Network ; September 2015';
const NETWORK_PUBLIC = 'Public Global Stellar Network ; September 2015';

const sha256Hex = (bytes: Uint8Array) => Buffer.from(sha256(bytes)).toString('hex');
const trusted: TrustedDigestFn = wrapSha256AsTrusted(sha256Hex);
const sha256Digest: DigestFn = (bytes) => trusted.digest(bytes);

const constantDigest: DigestFn = () => 'ab'.repeat(32);
const constantTrustedShape = {
  algorithm: 'sha256' as const,
  purpose: 'spp-approved-intent-v1' as const,
  digest: () => 'ab'.repeat(32) as ReturnType<TrustedDigestFn['digest']>,
};

function clockAt(ms: number): Clock {
  return () => ms;
}

function base(overrides: Partial<ApprovedIntent> = {}): ApprovedIntent {
  return {
    schemaVersion: APPROVED_INTENT_SCHEMA_VERSION,
    intentId: 'adv-intent-0001',
    op: 'deposit',
    account: ACCOUNT,
    networkPassphrase: NETWORK,
    poolContractId: POOL,
    asset: { kind: 'native', symbol: 'XLM' },
    amount: { units: '10000000', decimals: 7 },
    destination: { mode: 'none' },
    fees: [{ certainty: 'estimated', units: '100', note: 'hint' }],
    publicEffects: ['sender visible'],
    privacyLimits: ['rpc metadata'],
    digests: { planDigestHex: '00'.repeat(32), operationDigestHex: '00'.repeat(32) },
    createdAtMs: 1_000,
    expiresAtMs: 50_000,
    unknownCritical: [],
    ...overrides,
  };
}

function withDigests(
  intent: ApprovedIntent,
  opBytes: Uint8Array,
  digestFn: DigestFn = sha256Digest,
): ApprovedIntent {
  return {
    ...intent,
    digests: {
      planDigestHex: computePlanDigest(intent, digestFn),
      operationDigestHex: computeOperationDigest(opBytes, digestFn),
    },
  };
}

function toApproved(
  store: IntentStore,
  opBytes: Uint8Array,
  overrides: Partial<ApprovedIntent> = {},
): ReturnType<IntentStore['approve']> {
  const intentId = overrides.intentId ?? `adv-${Math.random().toString(16).slice(2, 10)}`;
  const intent = withDigests(base({ ...overrides, intentId }), opBytes);
  store.create({
    intent,
    trustedDigest: trusted,
    operationBytes: opBytes,
    clock: clockAt(2_000),
  });
  store.prepare(intentId, clockAt(2_100));
  store.markAwaitingApproval(intentId, clockAt(2_200));
  return store.approve(intentId, {
    clock: clockAt(2_300),
    trustedDigest: trusted,
    operationBytes: opBytes,
    authorizationId: 'authz-adversarial-01',
  });
}

describe('2.16/2.17 adversarial — post-approve field changes (REJECT_OK)', () => {
  const opBytes = new TextEncoder().encode('adv-op-base');

  it('1. reject amount change after approve via presentedIntent', () => {
    const store = createIntentStore();
    const record = toApproved(store, opBytes, { intentId: 'adv-amount-01' });
    const mutated = { ...record.intent, amount: { units: '1', decimals: 7 } };
    expect(() =>
      store.consume('adv-amount-01', {
        clock: clockAt(3_000),
        trustedDigest: trusted,
        operationBytes: opBytes,
        authorizationId: 'authz-adversarial-01',
        presentedIntent: mutated,
      }),
    ).toThrow(IntentTransitionError);
  });

  it('2. reject asset change after approve via presentedIntent', () => {
    const store = createIntentStore();
    const record = toApproved(store, opBytes, { intentId: 'adv-asset-01' });
    const mutated = {
      ...record.intent,
      asset: { kind: 'contract' as const, contractId: TOKEN, symbol: 'TOK' },
    };
    expect(() =>
      store.consume('adv-asset-01', {
        clock: clockAt(3_000),
        trustedDigest: trusted,
        operationBytes: opBytes,
        authorizationId: 'authz-adversarial-01',
        presentedIntent: mutated,
      }),
    ).toThrow(/mutat|fingerprint|digest/i);
  });

  it('3. reject destination change after approve', () => {
    const store = createIntentStore();
    const xferBytes = new TextEncoder().encode('adv-xfer');
    const record = toApproved(store, xferBytes, {
      intentId: 'adv-dest-01',
      op: 'private_transfer',
      destination: { mode: 'g_address', gAddress: ACCOUNT2 },
    });
    const mutated = {
      ...record.intent,
      destination: { mode: 'g_address' as const, gAddress: ACCOUNT },
    };
    expect(() =>
      store.consume('adv-dest-01', {
        clock: clockAt(3_000),
        trustedDigest: trusted,
        operationBytes: xferBytes,
        authorizationId: 'authz-adversarial-01',
        presentedIntent: mutated,
      }),
    ).toThrow(/mutat|fingerprint|digest/i);
  });

  it('4. reject account / network change after approve', () => {
    const store = createIntentStore();
    const record = toApproved(store, opBytes, { intentId: 'adv-acct-01' });
    expect(() =>
      store.consume('adv-acct-01', {
        clock: clockAt(3_000),
        trustedDigest: trusted,
        operationBytes: opBytes,
        authorizationId: 'authz-adversarial-01',
        presentedIntent: { ...record.intent, account: ACCOUNT2 },
      }),
    ).toThrow(/mutat|fingerprint/i);

    expect(() =>
      store.consume('adv-acct-01', {
        clock: clockAt(3_000),
        trustedDigest: trusted,
        operationBytes: opBytes,
        authorizationId: 'authz-adversarial-01',
        presentedIntent: { ...record.intent, networkPassphrase: NETWORK_PUBLIC },
      }),
    ).toThrow(/mutat|fingerprint/i);
  });

  it('5. reject plan digest tampering after approve', () => {
    const store = createIntentStore();
    const record = toApproved(store, opBytes, { intentId: 'adv-plandig01' });
    const mutated = {
      ...record.intent,
      digests: { ...record.intent.digests, planDigestHex: '11'.repeat(32) },
    };
    expect(() =>
      store.consume('adv-plandig01', {
        clock: clockAt(3_000),
        trustedDigest: trusted,
        operationBytes: opBytes,
        authorizationId: 'authz-adversarial-01',
        presentedIntent: mutated,
      }),
    ).toThrow(/mutat|fingerprint|digest/i);
  });

  it('6. reject operation digest / bytes change after approve', () => {
    const store = createIntentStore();
    toApproved(store, opBytes, { intentId: 'adv-opdig-01' });
    const other = new TextEncoder().encode('tampered-bytes');
    expect(() =>
      store.consume('adv-opdig-01', {
        clock: clockAt(3_000),
        trustedDigest: trusted,
        operationBytes: other,
        authorizationId: 'authz-adversarial-01',
      }),
    ).toThrow(/digest|drift/i);
  });
});

describe('2.16/2.17 adversarial — plan vs XDR semantics (LIMIT_ARCH / GAP open)', () => {
  it('7. LIMIT_ARCH: self-consistent but semantically incompatible plan↔bytes still create', () => {
    // Architectural limit remains: model never parses XDR. Deposit plan + arbitrary
    // bytes are accepted if each digest matches its own payload. Opaque digests
    // do NOT close the semantic gap (documented in FASE-2.17).
    const store = createIntentStore();
    const pretendWithdrawXdr = new TextEncoder().encode('FAKE_WITHDRAW_XDR_NOT_PARSED');
    const intent = withDigests(
      base({
        intentId: 'adv-sem-gap01',
        op: 'deposit',
        amount: { units: '42', decimals: 7 },
        publicEffects: ['claims deposit'],
      }),
      pretendWithdrawXdr,
    );
    const record = store.create({
      intent,
      trustedDigest: trusted,
      operationBytes: pretendWithdrawXdr,
      clock: clockAt(2_000),
    });
    expect(record.status).toBe('created');
    expect(record.intent.op).toBe('deposit');
  });
});

describe('2.16/2.17 adversarial — omitted / invalid fields (REJECT_OK)', () => {
  it('8. omit fields required to understand the operation', () => {
    const bad = base({ intentId: 'adv-omit-01' }) as unknown as Record<string, unknown>;
    delete bad.publicEffects;
    delete bad.privacyLimits;
    const res = validateApprovedIntentStructure(bad);
    expect(res.ok).toBe(false);
  });

  it('9. decimal / amount boundary abuse', () => {
    expect(
      validateApprovedIntentStructure(
        base({
          intentId: 'adv-amt-dot01',
          amount: { units: '1.0', decimals: 7 },
          digests: { planDigestHex: 'ab'.repeat(32), operationDigestHex: 'cd'.repeat(32) },
        }),
      ).ok,
    ).toBe(false);

    expect(
      validateApprovedIntentStructure(
        base({
          intentId: 'adv-amt-lead01',
          amount: { units: '01', decimals: 7 },
          digests: { planDigestHex: 'ab'.repeat(32), operationDigestHex: 'cd'.repeat(32) },
        }),
      ).ok,
    ).toBe(false);

    expect(
      validateApprovedIntentStructure(
        base({
          intentId: 'adv-amt-huge01',
          amount: { units: '9'.repeat(40), decimals: 7 },
          digests: { planDigestHex: 'ab'.repeat(32), operationDigestHex: 'cd'.repeat(32) },
        }),
      ).ok,
    ).toBe(false);

    expect(
      validateApprovedIntentStructure(
        base({
          intentId: 'adv-dec-bad01',
          amount: { units: '1', decimals: 19 },
          digests: { planDigestHex: 'ab'.repeat(32), operationDigestHex: 'cd'.repeat(32) },
        }),
      ).ok,
    ).toBe(false);
  });
});

describe('2.16/2.17 adversarial — mutation after validate (REJECT_OK)', () => {
  it('10. frozen intent rejects in-place mutation of nested fields', () => {
    const store = createIntentStore();
    const opBytes = new TextEncoder().encode('adv-freeze');
    const record = toApproved(store, opBytes, { intentId: 'adv-freeze-01' });
    expect(Object.isFrozen(record.intent)).toBe(true);
    expect(Object.isFrozen(record.intent.amount)).toBe(true);
    expect(Object.isFrozen(record.intent.publicEffects)).toBe(true);
    expect(() => {
      (record.intent.amount as { units: string }).units = '0';
    }).toThrow();
    expect(() => {
      (record.intent.publicEffects as string[]).push('evil');
    }).toThrow();
  });
});

describe('2.16/2.17 adversarial — reuse and terminal transitions (REJECT_OK)', () => {
  const opBytes = new TextEncoder().encode('adv-reuse');

  it('11. reject reusing the same approval (second consume)', () => {
    const store = createIntentStore();
    toApproved(store, opBytes, { intentId: 'adv-reuse-01' });
    const first = store.consume('adv-reuse-01', {
      clock: clockAt(3_000),
      trustedDigest: trusted,
      operationBytes: opBytes,
      authorizationId: 'authz-adversarial-01',
    });
    expect(first.status).toBe('consumed');
    expect(() =>
      store.consume('adv-reuse-01', {
        clock: clockAt(3_100),
        trustedDigest: trusted,
        operationBytes: opBytes,
        authorizationId: 'authz-adversarial-01',
      }),
    ).toThrow(/consumed|not allowed/i);
  });

  it('12. reject repeating terminal transitions', () => {
    const store = createIntentStore();
    toApproved(store, opBytes, { intentId: 'adv-term-c01' });
    const cancelled = store.cancel('adv-term-c01', clockAt(3_000));
    expect(cancelled.status).toBe('cancelled');
    expect(() => store.cancel('adv-term-c01', clockAt(3_100))).toThrow(/not allowed/i);
  });

  it('12b. reject/fail are terminal', () => {
    const store = createIntentStore();
    const bytes = new TextEncoder().encode('adv-term-clean');
    store.create({
      intent: withDigests(base({ intentId: 'adv-term-clean' }), bytes),
      trustedDigest: trusted,
      operationBytes: bytes,
      clock: clockAt(2_000),
    });
    store.prepare('adv-term-clean', clockAt(2_100));
    store.markAwaitingApproval('adv-term-clean', clockAt(2_200));
    const rejected = store.reject('adv-term-clean', clockAt(2_300));
    expect(rejected.status).toBe('rejected');
    expect(() =>
      store.approve('adv-term-clean', {
        clock: clockAt(2_400),
        trustedDigest: trusted,
        operationBytes: bytes,
        authorizationId: 'authz-no-000001',
      }),
    ).toThrow(/not allowed/i);

    store.create({
      intent: withDigests(base({ intentId: 'adv-term-fail' }), bytes),
      trustedDigest: trusted,
      operationBytes: bytes,
      clock: clockAt(2_000),
    });
    const failed = store.fail('adv-term-fail', clockAt(2_050));
    expect(failed.status).toBe('failed');
    expect(() => store.prepare('adv-term-fail', clockAt(2_100))).toThrow(/not allowed/i);
  });
});

describe('2.16/2.17 adversarial — expiry boundary (REJECT_OK)', () => {
  it('13. consume at exact expiresAtMs is rejected (now >= expires)', () => {
    const store = createIntentStore();
    const bytes = new TextEncoder().encode('adv-exp-exact');
    toApproved(store, bytes, {
      intentId: 'adv-exp-exact',
      createdAtMs: 1_000,
      expiresAtMs: 10_000,
    });
    expect(() =>
      store.consume('adv-exp-exact', {
        clock: clockAt(10_000),
        trustedDigest: trusted,
        operationBytes: bytes,
        authorizationId: 'authz-adversarial-01',
      }),
    ).toThrow(/expired/i);

    // Fresh approval for one-ms-before case
    toApproved(store, bytes, {
      intentId: 'adv-exp-before',
      createdAtMs: 1_000,
      expiresAtMs: 10_000,
    });
    const ok = store.consume('adv-exp-before', {
      clock: clockAt(9_999),
      trustedDigest: trusted,
      operationBytes: bytes,
      authorizationId: 'authz-adversarial-01',
    });
    expect(ok.status).toBe('consumed');
  });
});

describe('2.17 adversarial — concurrent consume (REJECT_OK via IntentStore)', () => {
  it('14. two tryConsume on shared store: exactly one success (GAP closed in-process)', () => {
    const store = createIntentStore();
    const bytes = new TextEncoder().encode('adv-concurrent');
    toApproved(store, bytes, { intentId: 'adv-concurrent' });
    const args = {
      clock: clockAt(3_000),
      trustedDigest: trusted,
      operationBytes: bytes,
      authorizationId: 'authz-adversarial-01',
    };
    const a = store.tryConsume('adv-concurrent', args);
    const b = store.tryConsume('adv-concurrent', args);
    const okCount = [a, b].filter((r) => r.ok).length;
    expect(okCount).toBe(1);
    // Would FAIL this test if both consumers succeed (double-spend of approval).
    expect(store.get('adv-concurrent')?.status).toBe('consumed');
  });
});

describe('2.17 adversarial — DigestFn constant / trust (REJECT_OK)', () => {
  it('15. constant DigestFn fails probe; constant TrustedDigestFn rejected by store', () => {
    expect(probeDigestFnNotConstant(constantDigest).ok).toBe(false);
    expect(probeDirect(constantDigest)).toEqual({ ok: false, reason: 'CONSTANT_OUTPUT' });

    const check = assertTrustedDigestFn(constantTrustedShape);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toBe('CONSTANT_OUTPUT');

    const store = createIntentStore();
    const bytes = new TextEncoder().encode('anything');
    const intent = withDigests(base({ intentId: 'adv-const-fn01' }), bytes, constantDigest);
    expect(() =>
      store.create({
        intent,
        trustedDigest: constantTrustedShape as TrustedDigestFn,
        operationBytes: bytes,
        clock: clockAt(2_000),
      }),
    ).toThrow(/DIGEST_UNTRUSTED|TrustedDigestFn|CONSTANT/i);
  });

  it('15b. bare DigestFn (not TrustedDigestFn) rejected at create', () => {
    const store = createIntentStore();
    const bytes = new TextEncoder().encode('bare-fn');
    const intent = withDigests(base({ intentId: 'adv-bare-fn01' }), bytes);
    expect(() =>
      store.create({
        intent,
        trustedDigest: sha256Digest as unknown as TrustedDigestFn,
        operationBytes: bytes,
        clock: clockAt(2_000),
      }),
    ).toThrow(/DIGEST_UNTRUSTED|TrustedDigestFn|BAD_SHAPE/i);
  });

  it('15c. sha256 TrustedDigestFn passes probe and assertTrustedDigestFn', () => {
    expect(probeDigestFnNotConstant(sha256Digest).ok).toBe(true);
    const check = assertTrustedDigestFn(trusted);
    expect(check.ok).toBe(true);
    expect(trusted.algorithm).toBe('sha256');
    expect(trusted.purpose).toBe('spp-approved-intent-v1');
  });
});

describe('2.17 adversarial — length / text limits (REJECT_OK)', () => {
  it('16. extreme intentId / empty network / huge narratives rejected', () => {
    expect(
      validateApprovedIntentStructure(
        base({
          intentId: 'short',
          digests: { planDigestHex: 'ab'.repeat(32), operationDigestHex: 'cd'.repeat(32) },
        }),
      ).ok,
    ).toBe(false);

    expect(
      validateApprovedIntentStructure(
        base({
          intentId: 'adv-empty-net',
          networkPassphrase: '',
          digests: { planDigestHex: 'ab'.repeat(32), operationDigestHex: 'cd'.repeat(32) },
        }),
      ).ok,
    ).toBe(false);

    const huge = 'X'.repeat(INTENT_LIMITS.narrativeStringMax + 1);
    const hugeIntent = base({
      intentId: 'adv-huge-note',
      fees: [{ certainty: 'estimated', units: '1', note: huge }],
      publicEffects: [huge],
      privacyLimits: [huge],
      digests: { planDigestHex: 'ab'.repeat(32), operationDigestHex: 'cd'.repeat(32) },
    });
    expect(validateApprovedIntentStructure(hugeIntent).ok).toBe(false);
  });

  it('16b. length-prefix encoding distinguishes concatenated field boundaries', () => {
    const a = base({
      intentId: 'enc-a-0001',
      asset: { kind: 'classic', code: 'ab', issuer: 'c' },
    });
    const b = base({
      intentId: 'enc-b-0001',
      asset: { kind: 'classic', code: 'a', issuer: 'bc' },
    });
    const ea = encodePlanPayload(a);
    const eb = encodePlanPayload(b);
    expect(Buffer.from(ea).equals(Buffer.from(eb))).toBe(false);
  });

  it('16c. exact narrative max accepted; max+1 rejected', () => {
    const max = INTENT_LIMITS.narrativeStringMax;
    expect(
      validateApprovedIntentStructure(
        base({
          intentId: 'adv-narr-exact',
          publicEffects: ['n'.repeat(max)],
          digests: { planDigestHex: 'ab'.repeat(32), operationDigestHex: 'cd'.repeat(32) },
        }),
      ).ok,
    ).toBe(true);
    expect(
      validateApprovedIntentStructure(
        base({
          intentId: 'adv-narr-plus1',
          publicEffects: ['n'.repeat(max + 1)],
          digests: { planDigestHex: 'ab'.repeat(32), operationDigestHex: 'cd'.repeat(32) },
        }),
      ).ok,
    ).toBe(false);
  });
});

describe('2.16/2.17 index exports digestSecurity helpers', () => {
  it('probeDigestFnNotConstant is reachable from package surface used by tests', () => {
    expect(typeof probeDigestFnNotConstant).toBe('function');
    expect(typeof assertTrustedDigestFn).toBe('function');
  });
});
