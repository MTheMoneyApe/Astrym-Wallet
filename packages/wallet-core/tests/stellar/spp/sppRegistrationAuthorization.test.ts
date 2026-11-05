import { afterEach, describe, expect, it } from 'vitest';
import {
  assertSppRegistrationAuthorizedForAddress,
  getSppRegistrationApprovalPacket,
  isSppRegistrationBroadcastAuthorized,
  rememberSppRegistrationApprovalPacket,
  resetSppRegistrationAuthorizationForTests,
  setSppRegistrationBroadcastAuthorized,
  validateSppRegistrationSubmitIntent,
  type SppRegistrationApprovalPacket,
} from '../../../src/stellar/spp/sppRegistrationAuthorization.js';
import { isSppTestnetBroadcastAuthorized } from '../../../src/stellar/spp/sppBroadcastGate.js';

const PASS = 'Test SDF Network ; September 2015';
const POOL = 'CAMWBUWHYXEGBM3Q7M5DBGW7LLJL3I4QGANQEZFEWLRNTOJMTT2WG24U';
const REGISTRY = 'CARXHKOPSGMUMFRDI72KNCRENVOTCJIGXPCPYOW42APDY2NEYF7CLKIL';
const SENDER = 'GDH76ERJT7WSYBV7A3VDZ4UTK7QFXWSBIS7ZRR6DNYTUHIRFRXBR5R7F';
const RECIPIENT = 'GDJ7V7FI7K6CRWM6XOLHZML6WIHCD3XTW7LRBAQZJCI4FDCDCHUYYY37';

const packet: SppRegistrationApprovalPacket = {
  version: '2026-11-04-register-v1',
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
      sourceAddress: SENDER,
      sequenceAtApproval: '23863074519777280',
      registryContract: REGISTRY,
      networkPassphrase: PASS,
      maxFeeStroops: '5000000',
      transactionFingerprint: 'aaaaaaaaaaaaaaaa',
    },
    {
      step: 2,
      role: 'recipient',
      sourceAddress: RECIPIENT,
      sequenceAtApproval: '23863083109711872',
      registryContract: REGISTRY,
      networkPassphrase: PASS,
      maxFeeStroops: '5000000',
      transactionFingerprint: 'bbbbbbbbbbbbbbbb',
    },
  ],
  totalMaxFeeExposureStroops: '10000000',
  preparedAt: '2026-11-04T00:00:00.000Z',
};

afterEach(() => {
  resetSppRegistrationAuthorizationForTests();
});

describe('sppRegistrationAuthorization', () => {
  it('defaults OFF and does not affect global mutator gate', () => {
    expect(isSppRegistrationBroadcastAuthorized()).toBe(false);
    expect(isSppTestnetBroadcastAuthorized()).toBe(false);
  });

  it('refuses submit while registration gate is OFF', () => {
    rememberSppRegistrationApprovalPacket(packet);
    const result = validateSppRegistrationSubmitIntent({
      step: 1,
      role: 'sender',
      sourceAddress: SENDER,
      freshSequence: '23863074519777280',
      registryContract: REGISTRY,
      networkPassphrase: PASS,
      maxFeeStroops: '5000000',
      transactionFingerprint: 'aaaaaaaaaaaaaaaa',
      operation: 'register_public_keys',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('REGISTRATION_AWAITING_APPROVAL');
  });

  it('accepts exact approved registration and rejects drift', () => {
    rememberSppRegistrationApprovalPacket(packet);
    setSppRegistrationBroadcastAuthorized(true);
    expect(getSppRegistrationApprovalPacket()?.operations).toHaveLength(2);

    const ok = validateSppRegistrationSubmitIntent({
      step: 1,
      role: 'sender',
      sourceAddress: SENDER,
      freshSequence: '23863074519777280',
      registryContract: REGISTRY,
      networkPassphrase: PASS,
      maxFeeStroops: '5000000',
      transactionFingerprint: 'aaaaaaaaaaaaaaaa',
      operation: 'register_public_keys',
    });
    expect(ok.ok).toBe(true);

    const seqDrift = validateSppRegistrationSubmitIntent({
      step: 1,
      role: 'sender',
      sourceAddress: SENDER,
      freshSequence: '999',
      registryContract: REGISTRY,
      networkPassphrase: PASS,
      maxFeeStroops: '5000000',
      transactionFingerprint: 'aaaaaaaaaaaaaaaa',
      operation: 'register_public_keys',
    });
    expect(seqDrift.ok).toBe(false);
    if (!seqDrift.ok) expect(seqDrift.code).toBe('SEQUENCE_DRIFT');

    const fpDrift = validateSppRegistrationSubmitIntent({
      step: 1,
      role: 'sender',
      sourceAddress: SENDER,
      freshSequence: '23863074519777280',
      registryContract: REGISTRY,
      networkPassphrase: PASS,
      maxFeeStroops: '5000000',
      transactionFingerprint: 'ffffffffffffffff',
      operation: 'register_public_keys',
    });
    expect(fpDrift.ok).toBe(false);
    if (!fpDrift.ok) expect(fpDrift.code).toBe('PACKET_MISMATCH');

    const feeOver = validateSppRegistrationSubmitIntent({
      step: 1,
      role: 'sender',
      sourceAddress: SENDER,
      freshSequence: '23863074519777280',
      registryContract: REGISTRY,
      networkPassphrase: PASS,
      maxFeeStroops: '5000001',
      transactionFingerprint: 'aaaaaaaaaaaaaaaa',
      operation: 'register_public_keys',
    });
    expect(feeOver.ok).toBe(false);
    if (!feeOver.ok) expect(feeOver.code).toBe('FEE_CEILING');
  });

  it('address helper refuses until gate ON', () => {
    rememberSppRegistrationApprovalPacket(packet);
    expect(() =>
      assertSppRegistrationAuthorizedForAddress({
        sourceAddress: SENDER,
        freshSequence: '23863074519777280',
        registryContract: REGISTRY,
        networkPassphrase: PASS,
        maxFeeStroops: '5000000',
        transactionFingerprint: 'aaaaaaaaaaaaaaaa',
      }),
    ).toThrow(/REGISTRATION_AWAITING_APPROVAL/);

    setSppRegistrationBroadcastAuthorized(true);
    const approved = assertSppRegistrationAuthorizedForAddress({
      sourceAddress: SENDER,
      freshSequence: '23863074519777280',
      registryContract: REGISTRY,
      networkPassphrase: PASS,
      maxFeeStroops: '5000000',
      transactionFingerprint: 'aaaaaaaaaaaaaaaa',
    });
    expect(approved.role).toBe('sender');
    // Global mutator gate must remain untouched.
    expect(isSppTestnetBroadcastAuthorized()).toBe(false);
  });
});
