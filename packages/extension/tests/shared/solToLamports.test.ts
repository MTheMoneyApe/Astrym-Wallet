import { describe, expect, it } from 'vitest';
import { parseSolToLamports } from '../../src/shared/solToLamports.js';

describe('parseSolToLamports', () => {
  it('parses valid integer SOL', () => {
    expect(parseSolToLamports('1')).toBe('1000000000');
    expect(parseSolToLamports('42')).toBe('42000000000');
  });

  it('parses valid decimal SOL', () => {
    expect(parseSolToLamports('1.5')).toBe('1500000000');
    expect(parseSolToLamports('0.000000001')).toBe('1');
    expect(parseSolToLamports('1.234567891')).toBe('1234567891');
    expect(parseSolToLamports('0.1')).toBe('100000000');
  });

  it('rejects more than 9 decimal places', () => {
    expect(() => parseSolToLamports('1.2345678911')).toThrow('Invalid SOL amount format');
    expect(() => parseSolToLamports('0.0000000001')).toThrow('Invalid SOL amount format');
  });

  it('rejects zero and negative values', () => {
    expect(() => parseSolToLamports('0')).toThrow('Amount must be strictly positive');
    expect(() => parseSolToLamports('0.0')).toThrow('Amount must be strictly positive');
    expect(() => parseSolToLamports('0.000000000')).toThrow('Amount must be strictly positive');
    expect(() => parseSolToLamports('-1')).toThrow('Invalid SOL amount format');
    expect(() => parseSolToLamports('-0.5')).toThrow('Invalid SOL amount format');
  });

  it('rejects malformed strings', () => {
    expect(() => parseSolToLamports('')).toThrow('Amount cannot be empty');
    expect(() => parseSolToLamports('   ')).toThrow('Amount cannot be empty');
    expect(() => parseSolToLamports('1e-3')).toThrow('Invalid SOL amount format');
    expect(() => parseSolToLamports('NaN')).toThrow('Invalid SOL amount format');
    expect(() => parseSolToLamports('Infinity')).toThrow('Invalid SOL amount format');
    expect(() => parseSolToLamports('1.2.3')).toThrow('Invalid SOL amount format');
    expect(() => parseSolToLamports('.5')).toThrow('Invalid SOL amount format');
    expect(() => parseSolToLamports('1.')).toThrow('Invalid SOL amount format');
    expect(() => parseSolToLamports('abc')).toThrow('Invalid SOL amount format');
  });
});
