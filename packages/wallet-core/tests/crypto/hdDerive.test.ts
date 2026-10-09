/**
 * hdDerive.test.ts — SLIP-0010 Ed25519 derivation tests
 *
 * Organised into 5 describe blocks as required by implementation_plan.md:
 *   1. official spec vectors  (TV1: 8 assertions, TV2: 4 assertions)
 *   2. cross-validated vector (1 assertion — Solana account 0)
 *   3. regression vectors     (7 assertions — labelled clearly)
 *   4. output invariants      (4 assertions)
 *   5. negative tests         (15 assertions)
 *
 * SOURCE LABELS:
 *   ¹ Official spec: value published verbatim in the SLIP-0010 specification.
 *   ² Regression only: value produced by our algorithm against the seed.
 *     Passing this test does NOT constitute verification against an external reference.
 *   ³ Cross-validated: value matches the ed25519-hd-key npm package's test suite.
 *     Both are SLIP-0010 implementations; this is cross-implementation agreement,
 *     not spec verification.
 */

import { describe, expect, it } from 'vitest';
import {
  InvalidDerivationPathError,
  InvalidSeedError,
  NonHardenedDerivationError,
  deriveHardenedChild,
  deriveMasterKey,
  derivePath,
} from '../../src/crypto/hdDerive.js';
import { makeSeedPhrase } from '../../src/crypto/types.js';
import { mnemonicToSeed } from '../../src/crypto/mnemonic.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hex(buf: Uint8Array): string {
  return Buffer.from(buf).toString('hex');
}

function fromHex(h: string): Uint8Array {
  return Uint8Array.from(Buffer.from(h, 'hex'));
}

// ─── Test seeds ───────────────────────────────────────────────────────────────

/** SLIP-0010 Test Vector 1 seed */
const TV1_SEED = fromHex('000102030405060708090a0b0c0d0e0f');

/** SLIP-0010 Test Vector 2 seed (64 bytes) */
const TV2_SEED = fromHex(
  'fffcf9f6f3f0edeae7e4e1dedbd8d5d2cfccc9c6c3c0bdbab7b4b1aeaba8a5a2' +
  '9f9c999693908d8a8784817e7b7875726f6c696663605d5a5754514e4b484542',
);

/** BIP-39 seed for "abandon×11 + about" with empty passphrase */
const ABANDON_SEED = mnemonicToSeed(
  makeSeedPhrase('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'),
);

// ─── 1. Official spec vectors ─────────────────────────────────────────────────

describe('SLIP-0010 Ed25519 derivation — official spec vectors', () => {
  // TV1: 4 paths × (private key + chain code) = 8 assertions — all from spec¹

  it('TV1 m: private key matches official spec¹', () => {
    const node = deriveMasterKey(TV1_SEED);
    expect(hex(node.privateKey)).toBe(
      '2b4be7f19ee27bbf30c667b642d5f4aa69fd169872f8fc3059c08ebae2eb19e7',
    );
  });

  it('TV1 m: chain code matches official spec¹', () => {
    const node = deriveMasterKey(TV1_SEED);
    expect(hex(node.chainCode)).toBe(
      '90046a93de5380a72b5e45010748567d5ea02bbf6522f979e05c0d8d8ca9fffb',
    );
  });

  it("TV1 m/0': private key matches official spec¹", () => {
    const node = derivePath(TV1_SEED, "m/0'");
    expect(hex(node.privateKey)).toBe(
      '68e0fe46dfb67e368c75379acec591dad19df3cde26e63b93a8e704f1dade7a3',
    );
  });

  it("TV1 m/0': chain code matches official spec¹", () => {
    const node = derivePath(TV1_SEED, "m/0'");
    expect(hex(node.chainCode)).toBe(
      '8b59aa11380b624e81507a27fedda59fea6d0b779a778918a2fd3590e16e9c69',
    );
  });

  it("TV1 m/0'/1': private key matches official spec¹", () => {
    const node = derivePath(TV1_SEED, "m/0'/1'");
    expect(hex(node.privateKey)).toBe(
      'b1d0bad404bf35da785a64ca1ac54b2617211d2777696fbffaf208f746ae84f2',
    );
  });

  it("TV1 m/0'/1': chain code matches official spec¹", () => {
    const node = derivePath(TV1_SEED, "m/0'/1'");
    expect(hex(node.chainCode)).toBe(
      'a320425f77d1b5c2505a6b1b27382b37368ee640e3557c315416801243552f14',
    );
  });

  it("TV1 m/0'/1'/2': private key matches official spec¹", () => {
    const node = derivePath(TV1_SEED, "m/0'/1'/2'");
    expect(hex(node.privateKey)).toBe(
      '92a5b23c0b8a99e37d07df3fb9966917f5d06e02ddbd909c7e184371463e9fc9',
    );
  });

  it("TV1 m/0'/1'/2': chain code matches official spec¹", () => {
    const node = derivePath(TV1_SEED, "m/0'/1'/2'");
    expect(hex(node.chainCode)).toBe(
      '2e69929e00b5ab250f49c3fb1c12f252de4fed2c1db88387094a0f8c4c9ccd6c',
    );
  });

  // TV2: 2 paths × (private key + chain code) = 4 assertions — all from spec¹

  it("TV2 m/0': private key matches official spec¹", () => {
    const node = derivePath(TV2_SEED, "m/0'");
    expect(hex(node.privateKey)).toBe(
      '1559eb2bbec5790b0c65d8693e4d0875b1747f4970ae8b650486ed7470845635',
    );
  });

  it("TV2 m/0': chain code matches official spec¹", () => {
    const node = derivePath(TV2_SEED, "m/0'");
    expect(hex(node.chainCode)).toBe(
      '0b78a3226f915c082bf118f83618a618ab6dec793752624cbeb622acb562862d',
    );
  });

  it("TV2 m/0'/2147483647': private key matches official spec¹", () => {
    const node = derivePath(TV2_SEED, "m/0'/2147483647'");
    expect(hex(node.privateKey)).toBe(
      'ea4f5bfe8694d8bb74b7b59404632fd5968b774ed545e810de9c32a4fb4192f4',
    );
  });

  it("TV2 m/0'/2147483647': chain code matches official spec¹", () => {
    const node = derivePath(TV2_SEED, "m/0'/2147483647'");
    expect(hex(node.chainCode)).toBe(
      '138f0b2551bcafeca6ff2aa88ba8ed0ed8de070841f0c4ef0165df8181eaad7f',
    );
  });
});

// ─── 2. Cross-validated vector ────────────────────────────────────────────────

describe('SLIP-0010 Ed25519 derivation — cross-validated vector', () => {
  it("Solana m/44'/501'/0'/0': private key matches ed25519-hd-key reference³", () => {
    // This value matches the expected output published in the ed25519-hd-key
    // npm package's own test suite, which is a separate SLIP-0010 implementation.
    // Cross-validation between two implementations; not spec-published.
    const node = derivePath(ABANDON_SEED, "m/44'/501'/0'/0'");
    expect(hex(node.privateKey)).toBe(
      '37df573b3ac4ad5b522e064e25b63ea16bcbe79d449e81a0268d1047948bb445',
    );
  });
});

// ─── 3. Regression vectors ────────────────────────────────────────────────────

describe('SLIP-0010 Ed25519 derivation — regression vectors', () => {
  // IMPORTANT: These values are NOT published in the official SLIP-0010 spec.
  // They were produced by running this implementation against the seed.
  // They serve as change-detection guards only.
  // Passing these tests does NOT constitute verification against an external reference.

  it("TV1 m/0'/1'/2'/2': private key (regression²)", () => {
    const node = derivePath(TV1_SEED, "m/0'/1'/2'/2'");
    expect(hex(node.privateKey)).toBe(
      '30d1dc7e5fc04c31219ab25a27ae00b50f6fd66622f6e9c913253d6511d1e662',
    );
  });

  it("TV1 m/0'/1'/2'/2': chain code (regression²)", () => {
    const node = derivePath(TV1_SEED, "m/0'/1'/2'/2'");
    expect(hex(node.chainCode)).toBe(
      '8f6d87f93d750e0efccda017d662a1b31a266e4a6f5993b15f5c1f07f74dd5cc',
    );
  });

  it("TV1 m/0'/1'/2'/2'/1000000000': private key (regression²)", () => {
    const node = derivePath(TV1_SEED, "m/0'/1'/2'/2'/1000000000'");
    expect(hex(node.privateKey)).toBe(
      '8f94d394a8e8fd6b1bc2f3f49f5c47e385281d5c17e65324b0f62483e37e8793',
    );
  });

  it('TV2 m: private key (regression²)', () => {
    const node = deriveMasterKey(TV2_SEED);
    expect(hex(node.privateKey)).toBe(
      '171cb88b1b3c1db25add599712e36245d75bc65a1a5c9e18d76f9f2b1eab4012',
    );
  });

  it('TV2 m: chain code (regression²)', () => {
    const node = deriveMasterKey(TV2_SEED);
    expect(hex(node.chainCode)).toBe(
      'ef70a74db9c3a5af931b5fe73ed8e1a53464133654fd55e7a66f8570b8e33c3b',
    );
  });

  it("Solana m/44'/501'/1'/0': private key (regression²)", () => {
    const node = derivePath(ABANDON_SEED, "m/44'/501'/1'/0'");
    expect(hex(node.privateKey)).toBe(
      'ba5e7b6e3680b4eb81db8e54c8e466b2e9a899355888403355d858ab985d2fc4',
    );
  });

  it("Solana m/44'/501'/2'/0': private key (regression²)", () => {
    const node = derivePath(ABANDON_SEED, "m/44'/501'/2'/0'");
    expect(hex(node.privateKey)).toBe(
      '2f2d4843b13aec3867edc61fbeac4a1fa58797a8629aa35217bd183405bcc202',
    );
  });
});

// ─── 4. Output invariants ─────────────────────────────────────────────────────

describe('SLIP-0010 Ed25519 derivation — output invariants', () => {
  it('privateKey output is always exactly 32 bytes', () => {
    const node = derivePath(ABANDON_SEED, "m/44'/501'/0'/0'");
    expect(node.privateKey.byteLength).toBe(32);
  });

  it('chainCode output is always exactly 32 bytes', () => {
    const node = derivePath(ABANDON_SEED, "m/44'/501'/0'/0'");
    expect(node.chainCode.byteLength).toBe(32);
  });

  it('accounts 0, 1, 2 all produce distinct private keys', () => {
    const k0 = hex(derivePath(ABANDON_SEED, "m/44'/501'/0'/0'").privateKey);
    const k1 = hex(derivePath(ABANDON_SEED, "m/44'/501'/1'/0'").privateKey);
    const k2 = hex(derivePath(ABANDON_SEED, "m/44'/501'/2'/0'").privateKey);
    expect(k0).not.toBe(k1);
    expect(k1).not.toBe(k2);
    expect(k0).not.toBe(k2);
  });

  it('handles max hardened index 2147483647 without integer overflow', () => {
    // 2147483647 = 2^31 - 1, the maximum allowed index before hardening.
    // After hardening: 2147483647 | 0x80000000 = 0xFFFFFFFF = 4294967295
    const node = derivePath(TV2_SEED, "m/0'/2147483647'");
    expect(node.privateKey.byteLength).toBe(32);
    expect(node.chainCode.byteLength).toBe(32);
    // Must match the official spec¹ value
    expect(hex(node.privateKey)).toBe(
      'ea4f5bfe8694d8bb74b7b59404632fd5968b774ed545e810de9c32a4fb4192f4',
    );
  });
});

// ─── 5. Negative tests ────────────────────────────────────────────────────────

describe('SLIP-0010 Ed25519 derivation — negative tests', () => {
  // ── Non-hardened derivation must be rejected ──

  it('throws NonHardenedDerivationError when last segment lacks apostrophe', () => {
    // m/44'/501'/0'/0 — last segment "0" has no apostrophe
    expect(() => derivePath(ABANDON_SEED, "m/44'/501'/0'/0")).toThrow(NonHardenedDerivationError);
  });

  it('throws NonHardenedDerivationError when first segment lacks apostrophe', () => {
    // m/44/501'/0'/0' — first segment "44" has no apostrophe
    expect(() => derivePath(ABANDON_SEED, "m/44/501'/0'/0'")).toThrow(NonHardenedDerivationError);
  });

  it('throws NonHardenedDerivationError when middle segment lacks apostrophe', () => {
    // m/44'/501/0'/0' — second segment "501" has no apostrophe
    expect(() => derivePath(ABANDON_SEED, "m/44'/501/0'/0'")).toThrow(NonHardenedDerivationError);
  });

  // ── Invalid path component values ──

  it("throws on a negative index in path segment (e.g. m/-1'/0')", () => {
    expect(() => derivePath(ABANDON_SEED, "m/-1'/0'")).toThrow(InvalidDerivationPathError);
  });

  it("throws on index ≥ 2^31 in path segment (e.g. m/2147483648'/0')", () => {
    // 2147483648 = 2^31 — one over the max allowed index
    expect(() => derivePath(ABANDON_SEED, "m/2147483648'/0'")).toThrow(InvalidDerivationPathError);
  });

  it("throws on a non-integer index in path segment (e.g. m/1.5'/0')", () => {
    expect(() => derivePath(ABANDON_SEED, "m/1.5'/0'")).toThrow(InvalidDerivationPathError);
  });

  it("throws on an empty segment in path (e.g. m//0')", () => {
    expect(() => derivePath(ABANDON_SEED, "m//0'")).toThrow(InvalidDerivationPathError);
  });

  it("throws on a non-numeric segment in path (e.g. m/abc'/0')", () => {
    expect(() => derivePath(ABANDON_SEED, "m/abc'/0'")).toThrow(InvalidDerivationPathError);
  });

  // ── Invalid seed input to deriveMasterKey ──

  it('throws when seed is empty (0 bytes)', () => {
    expect(() => deriveMasterKey(new Uint8Array(0))).toThrow(InvalidSeedError);
  });

  it('throws when seed is shorter than 16 bytes', () => {
    expect(() => deriveMasterKey(new Uint8Array(15))).toThrow(InvalidSeedError);
  });

  it('throws when seed is longer than 64 bytes', () => {
    expect(() => deriveMasterKey(new Uint8Array(65))).toThrow(InvalidSeedError);
  });

  it('throws when seed is not a Uint8Array (e.g. string passed)', () => {
    // @ts-expect-error — intentionally testing runtime type guard
    expect(() => deriveMasterKey('not a buffer')).toThrow(InvalidSeedError);
  });

  // ── Malformed path strings ──

  it('throws when path does not start with "m/"', () => {
    expect(() => derivePath(ABANDON_SEED, "44'/501'/0'/0'")).toThrow(InvalidDerivationPathError);
  });

  it('throws when path is exactly "m/" with no segments', () => {
    expect(() => derivePath(ABANDON_SEED, 'm/')).toThrow(InvalidDerivationPathError);
  });

  it('throws when path is an empty string', () => {
    expect(() => derivePath(ABANDON_SEED, '')).toThrow(InvalidDerivationPathError);
  });
});
