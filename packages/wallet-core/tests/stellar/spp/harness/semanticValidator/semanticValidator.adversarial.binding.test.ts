/**
 * Fase 2.20 — adversarial binding / false-positive audit for semanticValidator.
 * Synthetic XDR only. Demonstrates cross-pairing rejection after hardening.
 */
import { describe, expect, it } from 'vitest';
import {
  Account,
  Address,
  FeeBumpTransaction,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  xdr,
} from '@stellar/stellar-sdk';
import {
  FIXTURE_ACCOUNT,
  FIXTURE_ACCOUNT_2,
  FIXTURE_NETWORK,
  FIXTURE_POOL,
  FIXTURE_TOKEN,
  assertResultBoundTo,
  buildAuthEntryXdr,
  buildDepositEvidence,
  buildExtDataScVal,
  buildTransactTxXdr,
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

function asXdrScVal(v: { toXDR(): Buffer } | xdr.ScVal): xdr.ScVal {
  if (v instanceof xdr.ScVal) return v;
  return xdr.ScVal.fromXDR(v.toXDR(), 'raw');
}

describe('2.20 false-positive audit — cross-paired evidence (must REJECT after harden)', () => {
  it('1. ExtData/auth from another deposit (same amount) cross-paired with TX → AUTH_TX_MISMATCH', () => {
    // TX uses ciphertext pattern 0x11…; auth uses 0x22… — both amount=10_000_000
    const extTx = buildExtDataScVal({
      extAmount: 10_000_000n,
      recipient: FIXTURE_ACCOUNT,
      enc0: new Uint8Array(32).fill(0x11),
      enc1: new Uint8Array(32).fill(0x11),
    });
    const extAuth = buildExtDataScVal({
      extAmount: 10_000_000n,
      recipient: FIXTURE_ACCOUNT,
      enc0: new Uint8Array(32).fill(0x22),
      enc1: new Uint8Array(32).fill(0x22),
    });
    const proof = dummyProofScVal();
    const evidence = {
      networkPassphrase: FIXTURE_NETWORK,
      transactionXdr: buildTransactTxXdr({
        source: FIXTURE_ACCOUNT,
        pool: FIXTURE_POOL,
        sender: FIXTURE_ACCOUNT,
        extData: extTx,
        proof,
      }),
      authEntryXdrs: [
        buildAuthEntryXdr({
          pool: FIXTURE_POOL,
          proof,
          extData: extAuth, // different ExtData — same surface amounts
          sender: FIXTURE_ACCOUNT,
          tokenTransfer: { token: FIXTURE_TOKEN, amount: 10_000_000n },
        }),
      ],
    };
    const result = validateSemanticConcordance(depositIntent(), evidence);
    expect(result.status).toBe('rejected');
    expect(result.classification).toBe('rejected');
    expect(result.rejectionReasons[0]).toMatch(/AUTH_TX_MISMATCH|unusable/i);
  });

  it('2. Auth tree from a different deposit op (different proof) → REJECT', () => {
    const ext = buildExtDataScVal({ extAmount: 10_000_000n, recipient: FIXTURE_ACCOUNT });
    const proofTx = dummyProofScVal();
    const proofAuth = xdr.ScVal.scvMap([
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol('harness_dummy_proof'),
        val: xdr.ScVal.scvU32(99),
      }),
    ]);
    const result = validateSemanticConcordance(depositIntent(), {
      networkPassphrase: FIXTURE_NETWORK,
      transactionXdr: buildTransactTxXdr({
        source: FIXTURE_ACCOUNT,
        pool: FIXTURE_POOL,
        sender: FIXTURE_ACCOUNT,
        extData: ext,
        proof: proofTx,
      }),
      authEntryXdrs: [
        buildAuthEntryXdr({
          pool: FIXTURE_POOL,
          proof: proofAuth,
          extData: ext,
          sender: FIXTURE_ACCOUNT,
          tokenTransfer: { token: FIXTURE_TOKEN, amount: 10_000_000n },
        }),
      ],
    });
    expect(result.status).toBe('rejected');
    expect(result.rejectionReasons[0]).toMatch(/AUTH_TX_MISMATCH|arg\[0\]/i);
  });

  it('3. Withdraw auth (no transfer) paired with deposit TX → REJECT', () => {
    const deposit = buildDepositEvidence();
    const withdraw = buildWithdrawEvidence({ amount: 10_000_000n });
    const result = validateSemanticConcordance(depositIntent(), {
      networkPassphrase: FIXTURE_NETWORK,
      transactionXdr: deposit.transactionXdr,
      authEntryXdrs: withdraw.authEntryXdrs,
    });
    expect(result.status).toBe('rejected');
  });

  it('4. Destination changed after intent construction (withdraw)', () => {
    const evidence = buildWithdrawEvidence({ amount: 5_000_000n, recipient: FIXTURE_ACCOUNT });
    const result = validateSemanticConcordance(
      {
        op: 'withdraw',
        account: FIXTURE_ACCOUNT,
        networkPassphrase: FIXTURE_NETWORK,
        poolContractId: FIXTURE_POOL,
        tokenContractId: FIXTURE_TOKEN,
        amountUnits: '5000000',
        destination: { mode: 'g_address', gAddress: FIXTURE_ACCOUNT_2 },
        planTxCount: 1,
      },
      evidence,
    );
    expect(result.status).toBe('rejected');
    expect(result.rejectionReasons.some((r) => /recipient/i.test(r))).toBe(true);
  });

  it('5. Fee-bump wrapper unsupported', () => {
    // Build fee-bump around a simple payment (invokeHostFunction fee-bump hits SDK
    // encode quirks in 17.3); extractor rejects FeeBumpTransaction before op decode.
    const { Asset, Transaction } = require('@stellar/stellar-sdk') as typeof import('@stellar/stellar-sdk');
    const innerTx = new TransactionBuilder(new Account(FIXTURE_ACCOUNT, '1'), {
      fee: '100',
      networkPassphrase: FIXTURE_NETWORK,
    })
      .addOperation(
        Operation.payment({
          destination: FIXTURE_ACCOUNT_2,
          asset: Asset.native(),
          amount: '1',
        }),
      )
      .setTimeout(30)
      .build();
    const feeKp = Keypair.random();
    const bump = TransactionBuilder.buildFeeBumpTransaction(
      feeKp,
      '200',
      innerTx,
      FIXTURE_NETWORK,
    );
    expect(bump).toBeInstanceOf(FeeBumpTransaction);
    const result = validateSemanticConcordance(depositIntent(), {
      networkPassphrase: FIXTURE_NETWORK,
      transactionXdr: bump.toXDR(),
      authEntryXdrs: buildDepositEvidence().authEntryXdrs,
    });
    expect(result.status).toBe('rejected');
    expect(result.rejectionReasons[0]).toMatch(/FEE_BUMP|unusable/i);
    void Transaction;
  });

  it('6. Unexpected contract arg count (2 args) → REJECT', () => {
    const proof = dummyProofScVal();
    const ext = buildExtDataScVal({ extAmount: 10_000_000n, recipient: FIXTURE_ACCOUNT });
    const sender = asXdrScVal(Address.fromString(FIXTURE_ACCOUNT).toScVal());
    const tx = new TransactionBuilder(new Account(FIXTURE_ACCOUNT, '1'), {
      fee: '100',
      networkPassphrase: FIXTURE_NETWORK,
    })
      .addOperation(
        Operation.invokeContractFunction({
          contract: FIXTURE_POOL,
          function: 'transact',
          args: [proof, ext], // missing sender
        }),
      )
      .setTimeout(30)
      .build()
      .toXDR();
    const result = validateSemanticConcordance(depositIntent(), {
      networkPassphrase: FIXTURE_NETWORK,
      transactionXdr: tx,
      authEntryXdrs: [
        buildAuthEntryXdr({
          pool: FIXTURE_POOL,
          proof,
          extData: ext,
          sender: FIXTURE_ACCOUNT,
          tokenTransfer: { token: FIXTURE_TOKEN, amount: 10_000_000n },
        }),
      ],
    });
    expect(result.status).toBe('rejected');
    expect(result.rejectionReasons[0]).toMatch(/BAD_ARGS|unusable/i);
    void sender;
  });

  it('7. Duplicate ExtData keys → REJECT', () => {
    const amount = asXdrScVal(nativeToScVal(10_000_000n, { type: 'i256' }));
    const recipient = asXdrScVal(Address.fromString(FIXTURE_ACCOUNT).toScVal());
    const ext = xdr.ScVal.scvMap([
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol('encrypted_output0'),
        val: xdr.ScVal.scvBytes(Buffer.alloc(32, 1)),
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol('encrypted_output1'),
        val: xdr.ScVal.scvBytes(Buffer.alloc(32, 2)),
      }),
      new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('ext_amount'), val: amount }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol('ext_amount'),
        val: asXdrScVal(nativeToScVal(1n, { type: 'i256' })),
      }),
      new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('recipient'), val: recipient }),
    ]);
    const proof = dummyProofScVal();
    const result = validateSemanticConcordance(depositIntent(), {
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
          tokenTransfer: { token: FIXTURE_TOKEN, amount: 10_000_000n },
        }),
      ],
    });
    expect(result.status).toBe('rejected');
    expect(result.rejectionReasons[0]).toMatch(/duplicate|BAD_EXT_DATA|unusable/i);
  });

  it('8. Appearances correct but incomplete binding (pre-harden class of bug) — still rejected when auth ExtData diverges', () => {
    // Same as case 1 — documents that "same amount + same pool" is insufficient
    const a = buildDepositEvidence({ amount: 10_000_000n });
    const b = buildDepositEvidence({
      amount: 10_000_000n,
      recipient: FIXTURE_ACCOUNT_2, // changes ExtData.recipient → different ExtData XDR
    });
    const result = validateSemanticConcordance(depositIntent(), {
      networkPassphrase: FIXTURE_NETWORK,
      transactionXdr: a.transactionXdr,
      authEntryXdrs: b.authEntryXdrs,
    });
    expect(result.status).toBe('rejected');
    expect(result.rejectionReasons[0]).toMatch(/AUTH_TX_MISMATCH|unusable/i);
  });

  it('9. claimFullOperationSafety / verifiable_complete must not imply full safety', () => {
    const ok = validateSemanticConcordance(depositIntent(), buildDepositEvidence());
    expect(ok.status).toBe('verifiable_complete');
    expect(ok.classification).toBe('surface_verified_with_opaque_remainder');
    expect(ok.safetyClaim).toBe('not_full_protocol_safety');
    expect(ok.unverifiedFields.map((u) => u.field)).toEqual(
      expect.arrayContaining(['proof', 'encrypted_output0', 'encrypted_output1']),
    );

    const claim = validateSemanticConcordance(depositIntent(), buildDepositEvidence(), {
      claimFullOperationSafety: true,
    });
    expect(claim.status).toBe('rejected');
  });

  it('10. Altered ciphertext lengths still opaque (unverified) when bound; swap breaks binding', () => {
    const evidence = buildDepositEvidence({ amount: 10_000_000n });
    const ok = validateSemanticConcordance(depositIntent(), evidence);
    expect(ok.status).toBe('verifiable_complete');
    expect(ok.unverifiedFields.some((u) => u.field === 'encrypted_output0')).toBe(true);

    // Incompatible: auth with different enc bytes
    const extAlt = buildExtDataScVal({
      extAmount: 10_000_000n,
      recipient: FIXTURE_ACCOUNT,
      enc0: new Uint8Array(64).fill(7),
      enc1: new Uint8Array(64).fill(8),
    });
    const proof = dummyProofScVal();
    const mixed = {
      networkPassphrase: FIXTURE_NETWORK,
      transactionXdr: evidence.transactionXdr,
      authEntryXdrs: [
        buildAuthEntryXdr({
          pool: FIXTURE_POOL,
          proof,
          extData: extAlt,
          sender: FIXTURE_ACCOUNT,
          tokenTransfer: { token: FIXTURE_TOKEN, amount: 10_000_000n },
        }),
      ],
    };
    expect(validateSemanticConcordance(depositIntent(), mixed).status).toBe('rejected');
  });

  it('11. Reusing validation result for another intent → assertResultBoundTo fails', () => {
    const evidence = buildDepositEvidence();
    const intentA = depositIntent();
    const result = validateSemanticConcordance(intentA, evidence);
    expect(result.status).toBe('verifiable_complete');
    expect(assertResultBoundTo(result, intentA, evidence).ok).toBe(true);

    const intentB = depositIntent({ amountUnits: '1' });
    const reuse = assertResultBoundTo(result, intentB, evidence);
    expect(reuse.ok).toBe(false);
    if (!reuse.ok) expect(reuse.reason).toMatch(/bindingId|reuse|mix/i);

    const evidenceB = buildDepositEvidence({ amount: 1n });
    const reuseEv = assertResultBoundTo(result, intentA, evidenceB);
    expect(reuseEv.ok).toBe(false);
  });

  it('12. Bound happy path sets authBoundToInvoke + classification', () => {
    const evidence = buildDepositEvidence();
    const result = validateSemanticConcordance(depositIntent(), evidence);
    expect(result.status).toBe('verifiable_complete');
    expect(result.classification).toBe('surface_verified_with_opaque_remainder');
    expect(result.extracted?.authBoundToInvoke).toBe(true);
    expect(result.verifiedFields).toContain('authTxBinding');
    expect(result.bindingId).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('2.20 extract binding unit', () => {
  it('extract throws AUTH_TX_MISMATCH on cross-paired auth', () => {
    const extA = buildExtDataScVal({
      extAmount: 5n,
      recipient: FIXTURE_ACCOUNT,
      enc0: new Uint8Array(32).fill(1),
    });
    const extB = buildExtDataScVal({
      extAmount: 5n,
      recipient: FIXTURE_ACCOUNT,
      enc0: new Uint8Array(32).fill(9),
    });
    const proof = dummyProofScVal();
    const tx = buildTransactTxXdr({
      source: FIXTURE_ACCOUNT,
      pool: FIXTURE_POOL,
      sender: FIXTURE_ACCOUNT,
      extData: extA,
      proof,
    });
    const auth = buildAuthEntryXdr({
      pool: FIXTURE_POOL,
      proof,
      extData: extB,
      sender: FIXTURE_ACCOUNT,
      tokenTransfer: { token: FIXTURE_TOKEN, amount: 5n },
    });
    expect(() => extractTransactFacts(tx, FIXTURE_NETWORK, [auth])).toThrow(
      /AUTH_TX_MISMATCH|cross-paired|does not match/i,
    );
  });
});
