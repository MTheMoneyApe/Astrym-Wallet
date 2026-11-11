import { afterEach, describe, expect, it } from 'vitest';
import { Networks } from '@stellar/stellar-sdk';
import {
  approveSppStorageUnlockRequest,
  assertSppStorageUnlockSignatureStillPermitted,
  authorizeSppStorageUnlockSignature,
  createSppStorageUnlockMessage,
  sppStorageUnlockOriginFromUrl,
  resetSppStorageUnlockApprovalsForTests,
  revokeSppStorageUnlockApprovals,
} from '../../../src/stellar/spp/sppStorageUnlockGate.js';

const ACCOUNT = 'GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6';
const ORIGIN = 'chrome-extension://peanjgnchnfcfaclipankhfkligmlklc';
const SALT = Buffer.alloc(32, 9).toString('base64');

afterEach(() => resetSppStorageUnlockApprovalsForTests());

describe('SPP storage unlock gate', () => {
  it('binds creation consent to account, origin, exact message and two deterministic signatures', () => {
    const message = createSppStorageUnlockMessage({ origin: ORIGIN, account: ACCOUNT, salt: SALT });
    expect(message).toBe([
      'Stellar Private Payments storage unlock v1',
      `Origin: ${ORIGIN}`,
      `Account: ${ACCOUNT}`,
      `Salt: ${SALT}`,
    ].join('\\n'));
    const token = approveSppStorageUnlockRequest({ account: ACCOUNT, message, prepareGeneration: 4, uses: 2 });
    expect(token).toBeTruthy();
    const first = authorizeSppStorageUnlockSignature({
      account: ACCOUNT, message, prepareGeneration: 4, approvalToken: token!,
      networkPassphrase: Networks.TESTNET,
    });
    const second = authorizeSppStorageUnlockSignature({
      account: ACCOUNT, message, prepareGeneration: 4, approvalToken: token!,
      networkPassphrase: Networks.TESTNET,
    });
    expect(first.digest).toEqual(second.digest);
    expect(() => authorizeSppStorageUnlockSignature({
      account: ACCOUNT, message, prepareGeneration: 4, approvalToken: token!,
      networkPassphrase: Networks.TESTNET,
    })).toThrow(/approval/);
    expect(() => assertSppStorageUnlockSignatureStillPermitted(first.permissionEpoch)).not.toThrow();
  });

  it('allows exactly one signature for reopening an existing database', () => {
    const message = createSppStorageUnlockMessage({ origin: ORIGIN, account: ACCOUNT, salt: SALT });
    const token = approveSppStorageUnlockRequest({ account: ACCOUNT, message, prepareGeneration: 5, uses: 1 });
    expect(token).toBeTruthy();
    authorizeSppStorageUnlockSignature({
      account: ACCOUNT, message, prepareGeneration: 5, approvalToken: token!,
      networkPassphrase: Networks.TESTNET,
    });
    expect(() => authorizeSppStorageUnlockSignature({
      account: ACCOUNT, message, prepareGeneration: 5, approvalToken: token!,
      networkPassphrase: Networks.TESTNET,
    })).toThrow(/approval/);
  });

  it('rejects cross-account, stale-generation, altered-message and non-Testnet use', () => {
    const message = createSppStorageUnlockMessage({ origin: ORIGIN, account: ACCOUNT, salt: SALT });
    const token = approveSppStorageUnlockRequest({ account: ACCOUNT, message, prepareGeneration: 6, uses: 1 })!;
    expect(() => authorizeSppStorageUnlockSignature({
      account: 'G' + 'A'.repeat(55), message, prepareGeneration: 6, approvalToken: token,
      networkPassphrase: Networks.TESTNET,
    })).toThrow(/approval/);
    expect(() => authorizeSppStorageUnlockSignature({
      account: ACCOUNT, message: message + 'x', prepareGeneration: 6, approvalToken: token,
      networkPassphrase: Networks.TESTNET,
    })).toThrow(/approval/);
    expect(() => authorizeSppStorageUnlockSignature({
      account: ACCOUNT, message, prepareGeneration: 7, approvalToken: token,
      networkPassphrase: Networks.TESTNET,
    })).toThrow(/approval/);
    expect(() => authorizeSppStorageUnlockSignature({
      account: ACCOUNT, message, prepareGeneration: 6, approvalToken: token,
      networkPassphrase: 'Public Global Stellar Network ; September 2015',
    })).toThrow(/Testnet/);
  });

  it('revokes permits across preparation epochs', () => {
    const message = createSppStorageUnlockMessage({ origin: ORIGIN, account: ACCOUNT, salt: SALT });
    const token = approveSppStorageUnlockRequest({ account: ACCOUNT, message, prepareGeneration: 8, uses: 1 })!;
    const authorized = authorizeSppStorageUnlockSignature({
      account: ACCOUNT, message, prepareGeneration: 8, approvalToken: token,
      networkPassphrase: Networks.TESTNET,
    });
    revokeSppStorageUnlockApprovals();
    expect(() => assertSppStorageUnlockSignatureStillPermitted(authorized.permissionEpoch)).toThrow(/revoked/);
  });

  it('canonicalizes a full chrome-extension document URL without URL.origin', () => {
    expect(sppStorageUnlockOriginFromUrl(`${ORIGIN}/spp-host.html`)).toBe(ORIGIN);
    expect(sppStorageUnlockOriginFromUrl(`${ORIGIN}/popup.html?x=1`)).toBe(ORIGIN);
    expect(() => sppStorageUnlockOriginFromUrl('https://example.test/spp-host.html')).toThrow(/origin/);
  });

  it('rejects invalid origin, salt and database context before minting', () => {
    expect(() => createSppStorageUnlockMessage({
      origin: 'https://example.test', account: ACCOUNT, salt: SALT,
    })).toThrow(/origin/);
    expect(() => createSppStorageUnlockMessage({
      origin: ORIGIN, account: ACCOUNT, salt: 'AA==',
    })).toThrow(/32 bytes/);
  });
});
