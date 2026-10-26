/**
 * Fase 2.19 — offline adversarial tests for partial semantic validator.
 * Synthetic XDR only. No network, no SPP Client, no signing, no production wiring.
 */
import { describe, expect, it } from 'vitest';
import { Networks, nativeToScVal, xdr } from '@stellar/stellar-sdk';
import {
  FIXTURE_ACCOUNT,
  FIXTURE_ACCOUNT_2,
  FIXTURE_NETWORK,
  FIXTURE_POOL,
  FIXTURE_TOKEN,
  acceptSurfaceVerification,
  buildAuthEntryXdr,
  buildDepositEvidence,
  buildExtDataScVal,
  buildTransactTxXdr,
  buildTransactTxXdrWithExtraOp,
  buildWithdrawEvidence,
  dummyProofScVal,
  extractTransactFacts,
  validateSemanticConcordance,
  type ExpectedSemanticIntent,
} from './index.js';

function depositIntent(over: Partial<ExpectedSemanticIntent> = {}): ExpectedSemanticIntent {
  return {
    op: 'deposit',
    account: FIXTURE_ACCOUNT,
    networkPassphrase: FIXTURE_NETWORK,
    poolContractId: FIXTURE_POOL,
    tokenContractId: FIXTURE_TOKEN,
    amountUnits: '10000000',
    destination: { mode: 'none' },
    planTxCount: 1,
    ...over,
  };
}

function withdrawIntent(over: Partial<ExpectedSemanticIntent> = {}): ExpectedSemanticIntent {
  return {
    op: 'withdraw',
    account: FIXTURE_ACCOUNT,
    networkPassphrase: FIXTURE_NETWORK,
    poolContractId: FIXTURE_POOL,
    tokenContractId: FIXTURE_TOKEN,
    amountUnits: '5000000',
    destination: { mode: 'self' },
    planTxCount: 1,
    ...over,
  };
}

describe('2.19 happy paths (verifiable_complete for checkable surface)', () => {
  it('deposit: ExtData+auth tree match intent', () => {
    const evidence = buildDepositEvidence({ amount: 10_000_000n });
    const result = validateSemanticConcordance(depositIntent(), evidence);
    expect(result.status).toBe('verifiable_complete');
    expect(result.classification).toBe('surface_verified_with_opaque_remainder');
    expect(result.safetyClaim).toBe('not_full_protocol_safety');
    expect(result.rejectionReasons).toEqual([]);
    expect(result.verifiedFields).toEqual(
      expect.arrayContaining([
        'ext_amount',
        'poolContractId',
        'sourceAccount',
        'sender',
        'tokenTransferAmount',
        'authRoot',
        'authTxBinding',
        'op',
      ]),
    );
    expect(result.unverifiedFields.map((u) => u.field)).toEqual(
      expect.arrayContaining(['proof', 'encrypted_output0', 'opaqueDigest']),
    );
    expect(result.summary).toMatch(/NOT full private-payment safety/i);
    expect(Object.isFrozen(result)).toBe(true);
    const accepted = acceptSurfaceVerification(result, depositIntent(), evidence);
    expect(accepted.ok).toBe(true);
    if (accepted.ok) {
      expect(accepted.authorizesSigning).toBe(false);
      expect(accepted.fullProtocolSafety).toBe(false);
    }
  });

  it('withdraw: recipient + negative ext_amount match', () => {
    const evidence = buildWithdrawEvidence({ amount: 5_000_000n, recipient: FIXTURE_ACCOUNT });
    const result = validateSemanticConcordance(withdrawIntent(), evidence);
    expect(result.status).toBe('verifiable_complete');
    expect(result.verifiedFields).toEqual(expect.arrayContaining(['recipient', 'ext_amount', 'authTree']));
  });

  it('withdraw to explicit g_address', () => {
    const evidence = buildWithdrawEvidence({
      amount: 5_000_000n,
      recipient: FIXTURE_ACCOUNT_2,
    });
    const result = validateSemanticConcordance(
      withdrawIntent({ destination: { mode: 'g_address', gAddress: FIXTURE_ACCOUNT_2 } }),
      evidence,
    );
    expect(result.status).toBe('verifiable_complete');
  });
});

describe('2.19 adversarial — mismatches (REJECT)', () => {
  it('different recipient than approved (withdraw)', () => {
    const evidence = buildWithdrawEvidence({ recipient: FIXTURE_ACCOUNT_2 });
    const result = validateSemanticConcordance(withdrawIntent({ destination: { mode: 'self' } }), evidence);
    expect(result.status).toBe('rejected');
    expect(result.rejectionReasons.some((r) => /recipient/i.test(r))).toBe(true);
  });

  it('wrong source account', () => {
    const evidence = buildDepositEvidence({ source: FIXTURE_ACCOUNT_2 });
    const result = validateSemanticConcordance(depositIntent(), evidence);
    expect(result.status).toBe('rejected');
    expect(result.rejectionReasons.some((r) => /source|sender/i.test(r))).toBe(true);
  });

  it('wrong network passphrase on evidence', () => {
    const evidence = buildDepositEvidence();
    const result = validateSemanticConcordance(
      depositIntent({ networkPassphrase: Networks.PUBLIC }),
      evidence,
    );
    expect(result.status).toBe('rejected');
    expect(result.rejectionReasons.some((r) => /network/i.test(r))).toBe(true);
  });

  it('amount mismatch deposit', () => {
    const evidence = buildDepositEvidence({ amount: 1n });
    const result = validateSemanticConcordance(depositIntent({ amountUnits: '10000000' }), evidence);
    expect(result.status).toBe('rejected');
    expect(result.rejectionReasons.some((r) => /amount/i.test(r))).toBe(true);
  });

  it('missing required ExtData key (recipient omitted)', () => {
    const ext = xdr.ScVal.scvMap([
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol('encrypted_output0'),
        val: xdr.ScVal.scvBytes(Buffer.alloc(32, 1)),
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol('encrypted_output1'),
        val: xdr.ScVal.scvBytes(Buffer.alloc(32, 2)),
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol('ext_amount'),
        val: xdr.ScVal.fromXDR(nativeToScVal(10n, { type: 'i256' }).toXDR(), 'raw'),
      }),
    ]);
    const proof = dummyProofScVal();
    const result = validateSemanticConcordance(depositIntent({ amountUnits: '10' }), {
      networkPassphrase: FIXTURE_NETWORK,
      transactionXdr: buildTransactTxXdr({
        source: FIXTURE_ACCOUNT,
        pool: FIXTURE_POOL,
        sender: FIXTURE_ACCOUNT,
        extData: ext,
        proof,
      }),
      authEntryXdrs: [
        buildAuthEntryXdr({
          pool: FIXTURE_POOL,
          proof,
          extData: ext,
          sender: FIXTURE_ACCOUNT,
          tokenTransfer: { token: FIXTURE_TOKEN, amount: 10n },
        }),
      ],
    });
    expect(result.status).toBe('rejected');
    expect(result.rejectionReasons[0]).toMatch(/EXT_DATA|unusable|missing/i);
  });

  it('malformed transaction XDR', () => {
    const result = validateSemanticConcordance(depositIntent(), {
      networkPassphrase: FIXTURE_NETWORK,
      transactionXdr: 'not-valid-xdr$$$',
      authEntryXdrs: ['also-bad'],
    });
    expect(result.status).toBe('rejected');
    expect(result.rejectionReasons[0]).toMatch(/MALFORMED|unusable/i);
  });

  it('extra operation in envelope (unverifiable extras / bad op count)', () => {
    const ext = buildExtDataScVal({ extAmount: 10_000_000n, recipient: FIXTURE_ACCOUNT });
    const proof = dummyProofScVal();
    const tx = buildTransactTxXdrWithExtraOp({
      source: FIXTURE_ACCOUNT,
      pool: FIXTURE_POOL,
      sender: FIXTURE_ACCOUNT,
      extData: ext,
    });
    const auth = buildAuthEntryXdr({
      pool: FIXTURE_POOL,
      proof,
      extData: ext,
      sender: FIXTURE_ACCOUNT,
      tokenTransfer: { token: FIXTURE_TOKEN, amount: 10_000_000n },
    });
    const result = validateSemanticConcordance(depositIntent(), {
      networkPassphrase: FIXTURE_NETWORK,
      transactionXdr: tx,
      authEntryXdrs: [auth],
    });
    expect(result.status).toBe('rejected');
    expect(result.rejectionReasons[0]).toMatch(/BAD_OP_COUNT|unusable|1 operation/i);
  });

  it('deposit auth missing token.transfer sub-invocation', () => {
    const ext = buildExtDataScVal({ extAmount: 10_000_000n, recipient: FIXTURE_ACCOUNT });
    const proof = dummyProofScVal();
    const evidence = {
      networkPassphrase: FIXTURE_NETWORK,
      transactionXdr: buildTransactTxXdr({
        source: FIXTURE_ACCOUNT,
        pool: FIXTURE_POOL,
        sender: FIXTURE_ACCOUNT,
        extData: ext,
        proof,
      }),
      authEntryXdrs: [
        buildAuthEntryXdr({
          pool: FIXTURE_POOL,
          proof,
          extData: ext,
          sender: FIXTURE_ACCOUNT,
          // no tokenTransfer
        }),
      ],
    };
    const result = validateSemanticConcordance(depositIntent(), evidence);
    expect(result.status).toBe('rejected');
    expect(result.rejectionReasons.some((r) => /auth tree/i.test(r))).toBe(true);
  });
});

describe('2.19 adversarial — blocked / unsupported (REJECT)', () => {
  it('transfer-to-keys / private_transfer rejected explicitly', () => {
    const evidence = buildDepositEvidence();
    for (const op of ['private_transfer', 'transfer_to_keys'] as const) {
      const result = validateSemanticConcordance(depositIntent({ op }), evidence);
      expect(result.status).toBe('rejected');
      expect(result.rejectionReasons[0]).toMatch(/BLOCKED|unsupported/i);
      expect(result.fieldVerdicts.some((v) => v.status === 'blocked')).toBe(true);
    }
  });

  it('privacy_keys destination blocked', () => {
    const result = validateSemanticConcordance(
      withdrawIntent({
        destination: {
          mode: 'privacy_keys',
          notePublicKeyHex: 'ab'.repeat(32),
        },
      }),
      buildWithdrawEvidence(),
    );
    expect(result.status).toBe('rejected');
    expect(result.rejectionReasons[0]).toMatch(/privacy_keys|BLOCKED/i);
  });

  it('multi-tx planTxCount > 1 rejected', () => {
    const result = validateSemanticConcordance(
      depositIntent({ planTxCount: 2 }),
      buildDepositEvidence(),
    );
    expect(result.status).toBe('rejected');
    expect(result.rejectionReasons[0]).toMatch(/multi-tx|BLOCKED/i);
  });

  it('claimFullOperationSafety refused (partial must not be presented as complete)', () => {
    const result = validateSemanticConcordance(depositIntent(), buildDepositEvidence(), {
      claimFullOperationSafety: true,
    });
    expect(result.status).toBe('rejected');
    expect(result.rejectionReasons[0]).toMatch(/claimFullOperationSafety|partial/i);
  });

  it('two auth entries refused', () => {
    const evidence = buildDepositEvidence();
    const result = validateSemanticConcordance(depositIntent(), {
      ...evidence,
      authEntryXdrs: [...evidence.authEntryXdrs, ...evidence.authEntryXdrs],
    });
    expect(result.status).toBe('rejected');
    expect(result.rejectionReasons[0]).toMatch(/auth entry|BAD_AUTH|unusable/i);
  });
});

describe('2.19 extract unit', () => {
  it('extracts deposit facts from synthetic evidence', () => {
    const evidence = buildDepositEvidence({ amount: 42n });
    const facts = extractTransactFacts(
      evidence.transactionXdr,
      evidence.networkPassphrase,
      evidence.authEntryXdrs,
    );
    expect(facts.extAmount).toBe(42n);
    expect(facts.functionName).toBe('transact');
    expect(facts.tokenTransfer?.amount).toBe(42n);
    expect(facts.poolContractId).toBe(FIXTURE_POOL);
  });
});
