/**
 * entropy.test.ts
 *
 * Tests for the centralized CSPRNG module. Verifies that:
 *   - Output has the correct byte length
 *   - Consecutive calls produce different values (non-deterministic)
 *   - Invalid arguments are rejected
 *   - IV and salt helpers produce the expected sizes
 */

import { describe, expect, it } from 'vitest';
import { generateEntropy, generateIV, generateSalt } from '../../src/crypto/entropy.js';

describe('entropy.generateEntropy', () => {
  it('returns a Uint8Array of the requested length', () => {
    for (const len of [16, 32, 64, 128]) {
      const buf = generateEntropy(len);
      expect(buf).toBeInstanceOf(Uint8Array);
      expect(buf.byteLength).toBe(len);
    }
  });

  it('returns different values on successive calls (non-deterministic)', () => {
    const a = generateEntropy(32);
    const b = generateEntropy(32);
    // The probability of two random 32-byte arrays being identical is 1/2^256 — effectively impossible
    expect(Buffer.from(a).toString('hex')).not.toBe(Buffer.from(b).toString('hex'));
  });

  it('throws RangeError for byteLength = 0', () => {
    expect(() => generateEntropy(0)).toThrow(RangeError);
  });

  it('throws RangeError for negative byteLength', () => {
    expect(() => generateEntropy(-1)).toThrow(RangeError);
  });

  it('throws RangeError for non-integer byteLength', () => {
    expect(() => generateEntropy(1.5)).toThrow(RangeError);
  });
});

describe('entropy.generateIV', () => {
  it('returns exactly 12 bytes', () => {
    const iv = generateIV();
    expect(iv).toBeInstanceOf(Uint8Array);
    expect(iv.byteLength).toBe(12);
  });

  it('returns different values on successive calls', () => {
    const a = generateIV();
    const b = generateIV();
    expect(Buffer.from(a).toString('hex')).not.toBe(Buffer.from(b).toString('hex'));
  });
});

describe('entropy.generateSalt', () => {
  it('returns exactly 16 bytes', () => {
    const salt = generateSalt();
    expect(salt).toBeInstanceOf(Uint8Array);
    expect(salt.byteLength).toBe(16);
  });

  it('returns different values on successive calls', () => {
    const a = generateSalt();
    const b = generateSalt();
    expect(Buffer.from(a).toString('hex')).not.toBe(Buffer.from(b).toString('hex'));
  });
});
