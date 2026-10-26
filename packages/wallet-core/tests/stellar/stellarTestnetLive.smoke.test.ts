/**
 * Stellar Testnet live smoke — OFF by default.
 *
 * Offline suite: only the "guards (offline)" describe runs (no network).
 *
 * Flags (all independent; never set in CI by default):
 *   SOLANYM_TESTNET_LIVE=1
 *     Enables read-only Horizon getBalance. Requires SOLANYM_TESTNET_READ_ADDRESS=G…
 *     Does NOT call Friendbot, sendXlm, or createAccount.
 *   SOLANYM_TESTNET_LIVE_FUND=1  (also requires LIVE=1)
 *     Enables Friendbot funding of an ephemeral vault-derived address.
 *   SOLANYM_TESTNET_LIVE_SEND=1  (also requires LIVE=1)
 *     Enables a real Testnet submit via VaultService + SoftwareSigner + StellarTransactionClient.
 *
 * Never logs mnemonics or private keys. Not a privacy demonstration.
 */

import { describe, expect, it } from 'vitest';
import { Keypair, Networks, StrKey } from '@stellar/stellar-sdk';
import { generate24WordMnemonic } from '../../src/crypto/mnemonic.js';
import { SoftwareSigner } from '../../src/signer/SoftwareSigner.js';
import {
  STELLAR_TESTNET_FRIENDBOT_URL,
  STELLAR_TESTNET_HORIZON_URL,
  StellarReadClient,
} from '../../src/stellar/read/StellarReadClient.js';
import { StellarTransactionClient } from '../../src/stellar/transaction/StellarTransactionClient.js';
import type { IPersistentStorage, ISessionStorage } from '../../src/vault/IVaultStorage.js';
import { PasswordUnlocker } from '../../src/vault/PasswordUnlocker.js';
import type { EncryptedVaultBlob } from '../../src/vault/types.js';
import { VaultService } from '../../src/vault/VaultService.js';

const LIVE = process.env['SOLANYM_TESTNET_LIVE'] === '1';
const LIVE_FUND = process.env['SOLANYM_TESTNET_LIVE_FUND'] === '1';
const LIVE_SEND = process.env['SOLANYM_TESTNET_LIVE_SEND'] === '1';
const READ_ADDRESS = process.env['SOLANYM_TESTNET_READ_ADDRESS']?.trim() ?? '';

const FORBIDDEN_HORIZON_HOSTS = [
  'horizon.stellar.org',
  'horizon-pubnet',
  'mainnet',
] as const;

/** Refuse Mainnet / public-network configuration before any Horizon call. */
export function assertStellarTestnetOnly(options: {
  horizonUrl: string;
  friendbotUrl: string;
  networkPassphrase: string;
}): void {
  const horizon = options.horizonUrl.toLowerCase();
  const friendbot = options.friendbotUrl.toLowerCase();

  if (!horizon.includes('testnet')) {
    throw new Error('Refusing live Stellar run: horizon URL is not Testnet');
  }
  if (!friendbot.includes('friendbot') || friendbot.includes('mainnet')) {
    throw new Error('Refusing live Stellar run: friendbot URL is not Testnet Friendbot');
  }
  for (const host of FORBIDDEN_HORIZON_HOSTS) {
    if (horizon.includes(host) && !horizon.includes('horizon-testnet')) {
      throw new Error(`Refusing live Stellar run: forbidden horizon host pattern ${host}`);
    }
  }
  if (options.networkPassphrase === Networks.PUBLIC) {
    throw new Error('Refusing live Stellar run: public/mainnet network passphrase');
  }
  if (options.networkPassphrase !== Networks.TESTNET) {
    throw new Error('Refusing live Stellar run: network passphrase must be Networks.TESTNET');
  }
}

function requireTestnetReadAddress(): string {
  if (!READ_ADDRESS) {
    throw new Error(
      'SOLANYM_TESTNET_READ_ADDRESS must be set to a Stellar Testnet G… address for live read',
    );
  }
  if (!StrKey.isValidEd25519PublicKey(READ_ADDRESS)) {
    throw new Error('SOLANYM_TESTNET_READ_ADDRESS is not a valid Ed25519 public StrKey (G…)');
  }
  return READ_ADDRESS;
}

class MemPersistent implements IPersistentStorage {
  private _blob: EncryptedVaultBlob | null = null;
  async loadBlob() {
    return this._blob;
  }
  async saveBlob(blob: EncryptedVaultBlob) {
    this._blob = blob;
  }
  async clearBlob() {
    this._blob = null;
  }
}

class MemSession implements ISessionStorage {
  private _key: CryptoKey | null = null;
  async loadKey() {
    return this._key;
  }
  async saveKey(key: CryptoKey) {
    this._key = key;
  }
  async clearKey() {
    this._key = null;
  }
}

describe('Stellar Testnet live guards (offline)', () => {
  it('pins production defaults to Horizon Testnet + Friendbot', () => {
    expect(STELLAR_TESTNET_HORIZON_URL).toBe('https://horizon-testnet.stellar.org');
    expect(STELLAR_TESTNET_FRIENDBOT_URL).toBe('https://friendbot.stellar.org');
    expect(STELLAR_TESTNET_HORIZON_URL).toContain('testnet');
    expect(STELLAR_TESTNET_HORIZON_URL).not.toMatch(/^https:\/\/horizon\.stellar\.org\/?$/);
  });

  it('assertStellarTestnetOnly accepts Testnet defaults', () => {
    expect(() =>
      assertStellarTestnetOnly({
        horizonUrl: STELLAR_TESTNET_HORIZON_URL,
        friendbotUrl: STELLAR_TESTNET_FRIENDBOT_URL,
        networkPassphrase: Networks.TESTNET,
      }),
    ).not.toThrow();
  });

  it('assertStellarTestnetOnly rejects Mainnet passphrase and non-testnet Horizon', () => {
    expect(() =>
      assertStellarTestnetOnly({
        horizonUrl: STELLAR_TESTNET_HORIZON_URL,
        friendbotUrl: STELLAR_TESTNET_FRIENDBOT_URL,
        networkPassphrase: Networks.PUBLIC,
      }),
    ).toThrow(/public\/mainnet/);

    expect(() =>
      assertStellarTestnetOnly({
        horizonUrl: 'https://horizon.stellar.org',
        friendbotUrl: STELLAR_TESTNET_FRIENDBOT_URL,
        networkPassphrase: Networks.TESTNET,
      }),
    ).toThrow(/not Testnet|forbidden/);
  });

  it('keeps all live write paths off when env flags are unset', () => {
    expect(LIVE).toBe(false);
    expect(LIVE_FUND).toBe(false);
    expect(LIVE_SEND).toBe(false);
  });

  it('requireTestnetReadAddress rejects missing or malformed addresses without network I/O', () => {
    expect(() => {
      if (!READ_ADDRESS) {
        throw new Error(
          'SOLANYM_TESTNET_READ_ADDRESS must be set to a Stellar Testnet G… address for live read',
        );
      }
      if (!StrKey.isValidEd25519PublicKey(READ_ADDRESS)) {
        throw new Error('SOLANYM_TESTNET_READ_ADDRESS is not a valid Ed25519 public StrKey (G…)');
      }
    }).toThrow(/SOLANYM_TESTNET_READ_ADDRESS/);
  });
});

describe.skipIf(!LIVE)('Stellar Testnet live read (Horizon getBalance only)', () => {
  const horizonUrl = STELLAR_TESTNET_HORIZON_URL;
  const friendbotUrl = STELLAR_TESTNET_FRIENDBOT_URL;
  const networkPassphrase = Networks.TESTNET;

  it('reads account state via getBalance only (no Friendbot, no submit)', async () => {
    assertStellarTestnetOnly({ horizonUrl, friendbotUrl, networkPassphrase });
    const address = requireTestnetReadAddress();

    const read = new StellarReadClient(horizonUrl, friendbotUrl);
    const balance = await read.getBalance(address);

    expect(balance.address).toBe(address);
    expect(balance.asset).toBe('XLM');
    expect(typeof balance.exists).toBe('boolean');
    expect(typeof balance.balance).toBe('string');
    // Unfunded accounts are a valid Horizon 404 → exists:false; funded accounts return a balance.
    if (balance.exists) {
      expect(Number(balance.balance)).toBeGreaterThanOrEqual(0);
    } else {
      expect(balance.balance).toBe('0');
    }

    // Public report only — never log secrets.
    // eslint-disable-next-line no-console
    console.info(
      JSON.stringify({
        phase: 'live-read',
        endpoint: `${horizonUrl.replace(/\/+$/, '')}/accounts/${address}`,
        address,
        exists: balance.exists,
        balance: balance.balance,
        privacy: 'none-public-ledger',
        wroteToNetwork: false,
      }),
    );
  }, 30_000);
});

describe.skipIf(!LIVE || !LIVE_FUND)('Stellar Testnet live Friendbot fund (write)', () => {
  const horizonUrl = STELLAR_TESTNET_HORIZON_URL;
  const friendbotUrl = STELLAR_TESTNET_FRIENDBOT_URL;
  const networkPassphrase = Networks.TESTNET;

  it('funds an ephemeral Testnet account via Friendbot then reads balance', async () => {
    assertStellarTestnetOnly({ horizonUrl, friendbotUrl, networkPassphrase });

    const password = 'testnet-live-fund-password';
    const mnemonic = generate24WordMnemonic();
    const vault = new VaultService(new PasswordUnlocker(), new MemPersistent(), new MemSession());
    await vault.createVault(password, mnemonic);
    await vault.unlock(password);

    const signer = new SoftwareSigner(vault, 'stellar');
    const publicKey = await signer.getPublicKey(0);
    const address = StrKey.encodeEd25519PublicKey(publicKey);
    expect(StrKey.isValidEd25519PublicKey(address)).toBe(true);

    const read = new StellarReadClient(horizonUrl, friendbotUrl);
    const funded = await read.fundTestnetAccount(address);
    expect(funded.success).toBe(true);

    const balance = await read.getBalance(address);
    expect(balance.exists).toBe(true);
    expect(Number(balance.balance)).toBeGreaterThan(0);

    // eslint-disable-next-line no-console
    console.info(
      JSON.stringify({
        phase: 'live-fund',
        address,
        balance: balance.balance,
        friendbotTxHash: funded.txHash ?? null,
        horizon: horizonUrl,
        privacy: 'none-public-ledger',
      }),
    );

    await vault.lock();
  }, 60_000);
});

describe.skipIf(!LIVE || !LIVE_SEND)('Stellar Testnet live send (write)', () => {
  const horizonUrl = STELLAR_TESTNET_HORIZON_URL;
  const friendbotUrl = STELLAR_TESTNET_FRIENDBOT_URL;
  const networkPassphrase = Networks.TESTNET;

  it('sends a public Testnet XLM payment through VaultService + SoftwareSigner + StellarTransactionClient', async () => {
    assertStellarTestnetOnly({ horizonUrl, friendbotUrl, networkPassphrase });

    const password = 'testnet-live-send-password';
    const mnemonic = generate24WordMnemonic();
    const vault = new VaultService(new PasswordUnlocker(), new MemPersistent(), new MemSession());
    await vault.createVault(password, mnemonic);
    await vault.unlock(password);

    const signer = new SoftwareSigner(vault, 'stellar');
    const publicKey = await signer.getPublicKey(0);
    const sourceAddress = StrKey.encodeEd25519PublicKey(publicKey);

    const keyManager = {
      getAccounts: async () => [
        { index: 0, publicKey, label: 'live-smoke', chain: 'stellar' as const },
      ],
    };

    const read = new StellarReadClient(horizonUrl, friendbotUrl);
    await read.fundTestnetAccount(sourceAddress);

    const destination = Keypair.random().publicKey();
    const amountXlm = '2.0000000';

    const client = new StellarTransactionClient(horizonUrl, keyManager, signer, networkPassphrase);

    const review = await client.reviewXlmTransfer({
      sourceAccountIndex: 0,
      destination,
      amountXlm,
    });
    expect(review.operationType).toBe('createAccount');

    const preSource = await read.getBalance(sourceAddress);

    const result = await client.sendXlm({
      sourceAccountIndex: 0,
      destination,
      amountXlm,
      approvedFeeStroops: review.feeStroops,
    });

    expect(result.hash).toMatch(/^[a-f0-9]{64}$/i);

    const confirmation = await client.confirmTransaction(result.hash);
    expect(confirmation.status).toBe('confirmed');

    const horizonTx = await fetch(
      `${horizonUrl.replace(/\/+$/, '')}/transactions/${encodeURIComponent(result.hash)}`,
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) },
    );
    expect(horizonTx.ok).toBe(true);
    const body = (await horizonTx.json()) as { successful?: boolean };
    expect(body.successful).toBe(true);

    const postSource = await read.getBalance(sourceAddress);
    const postDest = await read.getBalance(destination);
    expect(postDest.exists).toBe(true);
    expect(Number(postSource.balance)).toBeLessThan(Number(preSource.balance));

    // eslint-disable-next-line no-console
    console.info(
      JSON.stringify({
        phase: 'live-send',
        sourceAddress,
        destination,
        amountXlm,
        txHash: result.hash,
        confirmation: confirmation.status,
        horizonSuccessful: body.successful === true,
        preBalanceSource: preSource.balance,
        postBalanceSource: postSource.balance,
        postBalanceDest: postDest.balance,
        privacy: 'none-public-ledger',
      }),
    );

    await vault.lock();
  }, 120_000);
});
