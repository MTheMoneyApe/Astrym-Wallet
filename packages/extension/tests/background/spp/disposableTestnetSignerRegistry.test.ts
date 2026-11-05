import { afterEach, describe, expect, it } from 'vitest';
import { Keypair, Networks } from '@stellar/stellar-sdk';
import { readFileSync } from 'node:fs';
import {
  bindDisposableTestnetSigner,
  clearDisposableTestnetSigners,
  getDisposableTestnetSigner,
  listDisposableTestnetSignerAddresses,
} from '../../../src/background/spp/disposableTestnetSignerRegistry.js';

const WALLETS_PATH = '/tmp/spp-e2e-test-wallets.json';
const SENDER = 'GDH76ERJT7WSYBV7A3VDZ4UTK7QFXWSBIS7ZRR6DNYTUHIRFRXBR5R7F';
const RECIPIENT = 'GDJ7V7FI7K6CRWM6XOLHZML6WIHCD3XTW7LRBAQZJCI4FDCDCHUYYY37';

afterEach(() => {
  clearDisposableTestnetSigners();
});

describe('disposableTestnetSignerRegistry', () => {
  it('refuses Mainnet', () => {
    const kp = Keypair.random();
    expect(() =>
      bindDisposableTestnetSigner({
        secret: kp.secret(),
        expectedAddress: kp.publicKey(),
        networkPassphrase: Networks.PUBLIC,
      }),
    ).toThrow(/Mainnet/);
  });

  it('binds both disposable Testnet wallets independently', async () => {
    const raw = JSON.parse(readFileSync(WALLETS_PATH, 'utf8')) as {
      senderSecret: string;
      recipientSecret: string;
    };
    bindDisposableTestnetSigner({ secret: raw.senderSecret, expectedAddress: SENDER });
    bindDisposableTestnetSigner({ secret: raw.recipientSecret, expectedAddress: RECIPIENT });

    expect(listDisposableTestnetSignerAddresses().sort()).toEqual([RECIPIENT, SENDER].sort());
    const sender = getDisposableTestnetSigner(SENDER);
    const recipient = getDisposableTestnetSigner(RECIPIENT);
    expect(sender).not.toBeNull();
    expect(recipient).not.toBeNull();
    expect(await sender!.getPublicKey()).toBe(SENDER);
    expect(await recipient!.getPublicKey()).toBe(RECIPIENT);
  });
});
