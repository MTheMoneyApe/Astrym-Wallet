/**
 * endpoints.test.ts — Network policy tests (Phase 5a).
 *
 * Pure unit tests: no network access.
 */

import { describe, expect, it } from 'vitest';
import {
  ALLOWED_DEVNET_RPC_URLS,
  DEVNET_GENESIS_HASH,
  NetworkConfigError,
  resolveNetworkConfig,
} from '../../src/solana/rpc/endpoints.js';

const DEVNET = 'https://api.devnet.solana.com';

function expectRejected(input: unknown): NetworkConfigError {
  let caught: unknown;
  try {
    resolveNetworkConfig(input);
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(NetworkConfigError);
  return caught as NetworkConfigError;
}

// ─── Constants ────────────────────────────────────────────────────────────────

describe('endpoints — constants', () => {
  it('ALLOWED_DEVNET_RPC_URLS contains exactly the public Devnet endpoint', () => {
    expect([...ALLOWED_DEVNET_RPC_URLS]).toEqual([DEVNET]);
  });

  it('ALLOWED_DEVNET_RPC_URLS is frozen', () => {
    expect(Object.isFrozen(ALLOWED_DEVNET_RPC_URLS)).toBe(true);
  });

  it('DEVNET_GENESIS_HASH is the verified Devnet genesis hash', () => {
    expect(DEVNET_GENESIS_HASH).toBe('EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG');
  });
});

// ─── Accepted ─────────────────────────────────────────────────────────────────

describe('endpoints — accepted URL', () => {
  it('accepts the exact Devnet URL', () => {
    const cfg = resolveNetworkConfig(DEVNET);
    expect(cfg.network).toBe('devnet');
    expect(cfg.rpcUrl).toBe(DEVNET);
  });

  it('accepts a single trailing slash and normalises it away', () => {
    expect(resolveNetworkConfig(`${DEVNET}/`).rpcUrl).toBe(DEVNET);
  });

  it('returns a frozen config object', () => {
    expect(Object.isFrozen(resolveNetworkConfig(DEVNET))).toBe(true);
  });
});

// ─── Rejected ─────────────────────────────────────────────────────────────────

describe('endpoints — rejects non-string / empty input', () => {
  it.each([undefined, null, 42, {}, [], ''])('rejects %p', (input) => {
    expectRejected(input);
  });

  it('rejects leading/trailing whitespace', () => {
    expectRejected(` ${DEVNET}`);
    expectRejected(`${DEVNET} `);
    expectRejected(`${DEVNET}\n`);
  });

  it('rejects a non-URL string', () => {
    expectRejected('api.devnet.solana.com');
  });
});

describe('endpoints — rejects wrong schemes', () => {
  it.each([
    'http://api.devnet.solana.com',
    'wss://api.devnet.solana.com',
    'ws://api.devnet.solana.com',
    'ftp://api.devnet.solana.com',
    'file:///api.devnet.solana.com',
    'javascript:alert(1)',
  ])('rejects %s', (url) => {
    expectRejected(url);
  });
});

describe('endpoints — rejects other hosts', () => {
  it.each([
    'https://api.testnet.solana.com',
    'https://api.mainnet-beta.solana.com',
    'https://localhost',
    'https://127.0.0.1',
    'https://[::1]',
    'https://solana.com',
    'https://evil.example',
  ])('rejects %s', (url) => {
    expectRejected(url);
  });
});

describe('endpoints — rejects subdomains and lookalike domains', () => {
  it.each([
    'https://x.api.devnet.solana.com',
    'https://devnet.solana.com',
    'https://api.devnet.solana.com.evil.example',
    'https://api-devnet.solana.com',
    'https://api.devnet.so1ana.com',
    'https://api.devnet.solana.co',
    'https://apidevnet.solana.com',
    'https://api.devnet.solana.com.',
    'https://\u0430pi.devnet.solana.com', // Cyrillic 'а' (IDN homograph)
    'https://API.DEVNET.SOLANA.COM', // non-canonical spelling
    'https://evil.example/api.devnet.solana.com',
  ])('rejects %s', (url) => {
    expectRejected(url);
  });
});

describe('endpoints — rejects credentials', () => {
  it.each([
    'https://user:pass@api.devnet.solana.com',
    'https://user@api.devnet.solana.com',
    'https://:pass@api.devnet.solana.com',
    'https://api.devnet.solana.com@evil.example',
  ])('rejects %s', (url) => {
    expectRejected(url);
  });

  it('error message does not echo the URL or the credentials', () => {
    const err = expectRejected('https://alice:hunter2@api.devnet.solana.com');
    expect(err.message).not.toContain('hunter2');
    expect(err.message).not.toContain('alice');
    expect(err.message).not.toContain('api.devnet.solana.com');
  });
});

describe('endpoints — rejects paths', () => {
  it.each([
    'https://api.devnet.solana.com/rpc',
    'https://api.devnet.solana.com//',
    'https://api.devnet.solana.com/./',
    'https://api.devnet.solana.com/%2e/',
    'https://api.devnet.solana.com/api.devnet.solana.com',
  ])('rejects %s', (url) => {
    expectRejected(url);
  });
});

describe('endpoints — rejects query strings', () => {
  it.each([
    'https://api.devnet.solana.com?',
    'https://api.devnet.solana.com/?',
    'https://api.devnet.solana.com?a=1',
    'https://api.devnet.solana.com/?u=https://evil.example',
  ])('rejects %s', (url) => {
    expectRejected(url);
  });
});

describe('endpoints — rejects fragments', () => {
  it.each([
    'https://api.devnet.solana.com#',
    'https://api.devnet.solana.com/#',
    'https://api.devnet.solana.com#x',
  ])('rejects %s', (url) => {
    expectRejected(url);
  });
});

describe('endpoints — rejects ports', () => {
  it.each([
    'https://api.devnet.solana.com:8899',
    'https://api.devnet.solana.com:8080',
    'https://api.devnet.solana.com:80',
    'https://api.devnet.solana.com:443', // explicit default port: non-canonical
  ])('rejects %s', (url) => {
    expectRejected(url);
  });
});

describe('endpoints — rejects parser-normalised spellings', () => {
  it.each([
    'https:\\\\api.devnet.solana.com',
    'https:api.devnet.solana.com',
    'https:/api.devnet.solana.com',
    'HTTPS://api.devnet.solana.com',
  ])('rejects %s', (url) => {
    expectRejected(url);
  });
});
