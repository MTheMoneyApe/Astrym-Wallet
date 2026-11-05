import { afterEach, describe, expect, it } from 'vitest';
import {
  assertSppDepositBroadcastAuthorized,
  getSppDepositApprovalPacket,
  isSppDepositBroadcastAuthorized,
  rememberSppDepositApprovalPacket,
  resetSppDepositAuthorizationForTests,
  setSppDepositBroadcastAuthorized,
  validateSppDepositSubmitIntent,
  type SppDepositApprovalPacket,
} from '../../../src/stellar/spp/sppDepositAuthorization.js';
import {
  isSppRegistrationBroadcastAuthorized,
  setSppRegistrationBroadcastAuthorized,
} from '../../../src/stellar/spp/sppRegistrationAuthorization.js';
import {
  isSppTestnetBroadcastAuthorized,
  setSppTestnetBroadcastAuthorized,
  resetSppBroadcastGateForTests,
} from '../../../src/stellar/spp/sppBroadcastGate.js';

const PASS = 'Test SDF Network ; September 2015';
const POOL = 'CAMWBUWHYXEGBM3Q7M5DBGW7LLJL3I4QGANQEZFEWLRNTOJMTT2WG24U';
const REGISTRY = 'CARXHKOPSGMUMFRDI72KNCRENVOTCJIGXPCPYOW42APDY2NEYF7CLKIL';
const SENDER = 'GDH76ERJT7WSYBV7A3VDZ4UTK7QFXWSBIS7ZRR6DNYTUHIRFRXBR5R7F';

const packet: SppDepositApprovalPacket = {
  version: '2026-11-05-deposit-v1',
  network: 'testnet',
  networkPassphrase: PASS,
  kdf_domain: 'Nethermind',
  poolContract: POOL,
  registryContract: REGISTRY,
  transport: 'nym',
  operations: [
    {
      step: 1,
      role: 'sender',
      operation: 'deposit',
      sourceAddress: SENDER,
      poolContract: POOL,
      amountStroops: '20000000',
      amountXlm: '2.0000000',
      sequenceAtApproval: '23863074519777281',
      networkPassphrase: PASS,
      maxFeeStroops: '8000000',
      transactionFingerprint: 'dddddddddddddddd',
    },
  ],
  totalMaxFeeExposureStroops: '8000000',
  preparedAt: '2026-11-05T00:00:00.000Z',
};

afterEach(() => {
  resetSppDepositAuthorizationForTests();
  resetSppBroadcastGateForTests();
  setSppRegistrationBroadcastAuthorized(false);
});

describe('sppDepositAuthorization', () => {
  it('defaults OFF and does not affect global or registration gates', () => {
    expect(isSppDepositBroadcastAuthorized()).toBe(false);
    expect(isSppTestnetBroadcastAuthorized()).toBe(false);
    expect(isSppRegistrationBroadcastAuthorized()).toBe(false);

    setSppDepositBroadcastAuthorized(true);
    expect(isSppDepositBroadcastAuthorized()).toBe(true);
    expect(isSppTestnetBroadcastAuthorized()).toBe(false);
    expect(isSppRegistrationBroadcastAuthorized()).toBe(false);
  });

  it('refuses deposit submit while deposit gate is OFF', () => {
    rememberSppDepositApprovalPacket(packet);
    const result = validateSppDepositSubmitIntent({
      step: 1,
      role: 'sender',
      sourceAddress: SENDER,
      poolContract: POOL,
      amountStroops: '20000000',
      freshSequence: '23863074519777281',
      networkPassphrase: PASS,
      maxFeeStroops: '8000000',
      transactionFingerprint: 'dddddddddddddddd',
      operation: 'deposit',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('DEPOSIT_AWAITING_APPROVAL');
  });

  it('accepts exact approved deposit and rejects amount/op/fee/sequence drift', () => {
    rememberSppDepositApprovalPacket(packet);
    setSppDepositBroadcastAuthorized(true);
    expect(getSppDepositApprovalPacket()?.operations).toHaveLength(1);

    const ok = validateSppDepositSubmitIntent({
      step: 1,
      role: 'sender',
      sourceAddress: SENDER,
      poolContract: POOL,
      amountStroops: '20000000',
      freshSequence: '23863074519777281',
      networkPassphrase: PASS,
      maxFeeStroops: '8000000',
      transactionFingerprint: 'dddddddddddddddd',
      operation: 'deposit',
    });
    expect(ok.ok).toBe(true);

    const amountDrift = validateSppDepositSubmitIntent({
      step: 1,
      role: 'sender',
      sourceAddress: SENDER,
      poolContract: POOL,
      amountStroops: '10000000',
      freshSequence: '23863074519777281',
      networkPassphrase: PASS,
      maxFeeStroops: '8000000',
      transactionFingerprint: 'dddddddddddddddd',
      operation: 'deposit',
    });
    expect(amountDrift.ok).toBe(false);
    if (!amountDrift.ok) expect(amountDrift.code).toBe('PACKET_MISMATCH');

    const feeOver = validateSppDepositSubmitIntent({
      step: 1,
      role: 'sender',
      sourceAddress: SENDER,
      poolContract: POOL,
      amountStroops: '20000000',
      freshSequence: '23863074519777281',
      networkPassphrase: PASS,
      maxFeeStroops: '8000001',
      transactionFingerprint: 'dddddddddddddddd',
      operation: 'deposit',
    });
    expect(feeOver.ok).toBe(false);
    if (!feeOver.ok) expect(feeOver.code).toBe('FEE_CEILING');

    const seqDrift = validateSppDepositSubmitIntent({
      step: 1,
      role: 'sender',
      sourceAddress: SENDER,
      poolContract: POOL,
      amountStroops: '20000000',
      freshSequence: '999',
      networkPassphrase: PASS,
      maxFeeStroops: '8000000',
      transactionFingerprint: 'dddddddddddddddd',
      operation: 'deposit',
    });
    expect(seqDrift.ok).toBe(false);
    if (!seqDrift.ok) expect(seqDrift.code).toBe('SEQUENCE_DRIFT');
  });

  it('refuses non-deposit operations even when deposit gate is ON', () => {
    rememberSppDepositApprovalPacket(packet);
    setSppDepositBroadcastAuthorized(true);
    // Simulate a hostile caller trying to slip register/transfer/withdraw through.
    for (const operation of ['register_public_keys', 'transfer', 'withdraw'] as const) {
      const result = validateSppDepositSubmitIntent({
        step: 1,
        role: 'sender',
        sourceAddress: SENDER,
        poolContract: POOL,
        amountStroops: '20000000',
        freshSequence: '23863074519777281',
        networkPassphrase: PASS,
        maxFeeStroops: '8000000',
        transactionFingerprint: 'dddddddddddddddd',
        operation,
      } as Parameters<typeof validateSppDepositSubmitIntent>[0]);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('OPERATION_NOT_DEPOSIT');
    }
  });

  it('assert helper refuses until gate ON; turning it on leaves other gates OFF', () => {
    rememberSppDepositApprovalPacket(packet);
    setSppTestnetBroadcastAuthorized(false);
    expect(() =>
      assertSppDepositBroadcastAuthorized({
        step: 1,
        role: 'sender',
        sourceAddress: SENDER,
        poolContract: POOL,
        amountStroops: '20000000',
        freshSequence: '23863074519777281',
        networkPassphrase: PASS,
        maxFeeStroops: '8000000',
        transactionFingerprint: 'dddddddddddddddd',
        operation: 'deposit',
      }),
    ).toThrow(/SPP_DEPOSIT_AWAITING_APPROVAL/);

    setSppDepositBroadcastAuthorized(true);
    assertSppDepositBroadcastAuthorized({
      step: 1,
      role: 'sender',
      sourceAddress: SENDER,
      poolContract: POOL,
      amountStroops: '20000000',
      freshSequence: '23863074519777281',
      networkPassphrase: PASS,
      maxFeeStroops: '8000000',
      transactionFingerprint: 'dddddddddddddddd',
      operation: 'deposit',
    });
    expect(isSppTestnetBroadcastAuthorized()).toBe(false);
    expect(isSppRegistrationBroadcastAuthorized()).toBe(false);
  });
});
