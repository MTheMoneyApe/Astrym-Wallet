import { describe, expect, it } from 'vitest';
import { Keypair, Networks } from '@stellar/stellar-sdk';
import { readFileSync } from 'node:fs';
import {
  StellarSecretKeySignerError,
  StellarSecretKeyWalletSigner,
} from '../../../src/stellar/spp/StellarSecretKeyWalletSigner.js';

const WALLETS_PATH = '/tmp/spp-e2e-test-wallets.json';
const EXPECTED_SENDER = 'GDH76ERJT7WSYBV7A3VDZ4UTK7QFXWSBIS7ZRR6DNYTUHIRFRXBR5R7F';
const EXPECTED_RECIPIENT = 'GDJ7V7FI7K6CRWM6XOLHZML6WIHCD3XTW7LRBAQZJCI4FDCDCHUYYY37';

function loadDisposableSecrets(): { senderSecret: string; recipientSecret: string } {
  const raw = JSON.parse(readFileSync(WALLETS_PATH, 'utf8')) as {
    senderSecret: string;
    recipientSecret: string;
  };
  return { senderSecret: raw.senderSecret, recipientSecret: raw.recipientSecret };
}

describe('StellarSecretKeyWalletSigner', () => {
  it('refuses Mainnet passphrase', () => {
    const kp = Keypair.random();
    expect(
      () =>
        new StellarSecretKeyWalletSigner({
          secret: kp.secret(),
          expectedAddress: kp.publicKey(),
          networkPassphrase: Networks.PUBLIC,
        }),
    ).toThrow(StellarSecretKeySignerError);
  });

  it('refuses identity mismatch', () => {
    const a = Keypair.random();
    const b = Keypair.random();
    expect(
      () =>
        new StellarSecretKeyWalletSigner({
          secret: a.secret(),
          expectedAddress: b.publicKey(),
        }),
    ).toThrow(/expected G/);
  });

  it('binds disposable sender and recipient independently', async () => {
    const { senderSecret, recipientSecret } = loadDisposableSecrets();

    const sender = new StellarSecretKeyWalletSigner({
      secret: senderSecret,
      expectedAddress: EXPECTED_SENDER,
    });
    const recipient = new StellarSecretKeyWalletSigner({
      secret: recipientSecret,
      expectedAddress: EXPECTED_RECIPIENT,
    });

    expect(await sender.getPublicKey()).toBe(EXPECTED_SENDER);
    expect(await recipient.getPublicKey()).toBe(EXPECTED_RECIPIENT);

    const senderSig = await sender.signMessage('astrym-spp-identity-check');
    const recipientSig = await recipient.signMessage('astrym-spp-identity-check');
    expect(senderSig.signerAddress).toBe(EXPECTED_SENDER);
    expect(recipientSig.signerAddress).toBe(EXPECTED_RECIPIENT);
    expect(senderSig.signedMessage).not.toEqual(recipientSig.signedMessage);
  });
});
