import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  copyRecoveryPhrase,
  Onboarding,
  parseRecoveryPhrase,
  validatePasswordPair,
} from '../../src/popup/Onboarding.js';

vi.mock('../../src/popup/ipc.js', () => ({ sendIpcMessage: vi.fn() }));

const valid12WordPhrase = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const valid24WordPhrase = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art';

describe('Onboarding', () => {
  it('renders the welcome actions without showing the import form or a second selector', () => {
    const markup = renderToStaticMarkup(React.createElement(Onboarding, { onComplete: vi.fn() }));

    expect(markup).toContain('Welcome to Astrym');
    expect(markup).toContain('Create New Wallet');
    expect(markup).toContain('Import Existing Wallet');
    expect(markup).not.toContain('Recovery phrase</span>');
    expect(markup).not.toContain('Import Wallet</button>');
  });

  it('accepts valid 12- and 24-word BIP39 phrases and normalizes whitespace', () => {
    expect(parseRecoveryPhrase(`  ${valid12WordPhrase.replaceAll(' ', '   ')}  `)).toEqual({
      ok: true,
      words: valid12WordPhrase.split(' '),
    });
    expect(parseRecoveryPhrase(valid24WordPhrase)).toEqual({
      ok: true,
      words: valid24WordPhrase.split(' '),
    });
  });

  it('reports unsupported word counts and invalid BIP39 checksums clearly', () => {
    expect(parseRecoveryPhrase('abandon abandon').ok).toBe(false);
    expect(parseRecoveryPhrase(Array(12).fill('abandon').join(' '))).toEqual({
      ok: false,
      message: 'That recovery phrase is invalid. Check the words and try again.',
    });
  });

  it('keeps password mismatch and minimum-length validation intact', () => {
    expect(validatePasswordPair('different-password', 'other-password')).toBe('Passwords do not match.');
    expect(validatePasswordPair('short', 'short')).toBe('Password must be at least 8 characters.');
    expect(validatePasswordPair('valid-password', 'valid-password')).toBeNull();
  });

  it('copies the recovery phrase exactly in its original order with single spaces', async () => {
    const words = valid24WordPhrase.split(' ');
    const writeText = vi.fn().mockResolvedValue(undefined);

    await expect(copyRecoveryPhrase(words, writeText)).resolves.toBeUndefined();

    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledWith(valid24WordPhrase);
    expect(words.join(' ')).toBe(valid24WordPhrase);
  });

  it('preserves the phrase and propagates a clipboard failure for UI handling', async () => {
    const words = valid24WordPhrase.split(' ');
    const writeText = vi.fn().mockRejectedValue(new Error('Clipboard unavailable'));

    await expect(copyRecoveryPhrase(words, writeText)).rejects.toThrow('Clipboard unavailable');
    expect(words.join(' ')).toBe(valid24WordPhrase);
  });
});
