import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sendIpcMessage } from '../../src/popup/ipc.js';
import {
  AccountMenu,
  createAccountOperationGate,
  copyPublicAddress,
  dismissAccountMenuOnEscape,
  formatPublicAddress,
  includeCreatedAccount,
  isCurrentBalanceResponse,
  resolveRestoredAccountSelection,
  selectMenuAccount,
} from '../../src/popup/Dashboard.js';

vi.mock('../../src/popup/ipc.js', () => ({ sendIpcMessage: vi.fn() }));

const accounts = [
  { index: 0, publicKey: '8xK2eFqvDzwsC1mYpd9Yw7GhBm6tR3nK2s4f5v6pQ7mA', label: 'Account 1' },
  { index: 1, publicKey: '9Nd1mBQtrCGZXm3XgMy5b2nStJcQG3FmPkWG3wVvjT8Q', label: 'Account 2' },
];

const baseMenuProps = {
  accounts,
  activeIndex: 0,
  activeAccount: { address: accounts[0]!.publicKey, label: accounts[0]!.label, index: 0 },
  open: false,
  loading: false,
  busy: false,
  error: '',
  notice: '',
  onToggle: vi.fn(),
  onClose: vi.fn(),
  onSelect: vi.fn().mockResolvedValue(true),
  onCreate: vi.fn().mockResolvedValue(true),
  onRename: vi.fn().mockResolvedValue(true),
};

describe('Dashboard account menu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the compact active-account trigger accessibly', () => {
    const markup = renderToStaticMarkup(React.createElement(AccountMenu, baseMenuProps));

    expect(markup).toContain('Account menu, active Account 1');
    expect(markup).toContain('aria-haspopup="menu"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('Account 1');
  });

  it('shows existing accounts, abbreviated addresses, create, and unavailable import when open', () => {
    const markup = renderToStaticMarkup(React.createElement(AccountMenu, { ...baseMenuProps, open: true }));

    expect(markup).toContain('role="menu"');
    expect(markup).toContain('Active account: Account 1');
    expect(markup).toContain('Select account: Account 2');
    expect(markup).toContain('Copy full public address for Account 1');
    expect(markup).toContain('8xK2...Q7mA');
    expect(markup).toContain('9Nd1...jT8Q');
    expect(markup).toContain('Create account');
    expect(markup).toContain('Import account');
    expect(markup).toContain('Account import is not available yet.');
  });

  it('keeps account import disabled and prevents menu actions while busy', () => {
    const markup = renderToStaticMarkup(React.createElement(AccountMenu, { ...baseMenuProps, open: true, busy: true }));

    expect(markup).toContain('Working...');
    expect(markup).toContain('disabled=""');
  });

  it('shows loading and disables account operations before hydration completes', () => {
    const markup = renderToStaticMarkup(React.createElement(AccountMenu, { ...baseMenuProps, open: true, loading: true }));

    expect(markup).toContain('Loading accounts...');
    expect(markup).not.toContain('No accounts yet.');
    expect(markup).toContain('aria-busy="true"');
  });

  it('restores only the backend-confirmed account and leaves INVALID neutral', () => {
    expect(resolveRestoredAccountSelection(accounts, { status: 'VALID', index: 1 }).selectedIndex).toBe(1);
    expect(resolveRestoredAccountSelection(accounts, { status: 'INVALID', index: null }).account).toBeNull();
    expect(resolveRestoredAccountSelection([], { status: 'NONE', index: null }).account).toBeNull();
  });

  it('formats public addresses without exposing more than the requested prefix and suffix', () => {
    expect(formatPublicAddress(accounts[0]!.publicKey)).toBe('8xK2...Q7mA');
  });

  it('copies the complete address and returns the success confirmation', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const selectAccount = vi.fn();

    await expect(copyPublicAddress(accounts[0]!.publicKey, writeText)).resolves.toBe('¡Dirección copiada!');
    expect(writeText).toHaveBeenCalledWith(accounts[0]!.publicKey);
    expect(sendIpcMessage).not.toHaveBeenCalled();
    expect(selectAccount).not.toHaveBeenCalled();
  });

  it('reports clipboard writer failures without swallowing them', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('Clipboard unavailable'));

    await expect(copyPublicAddress(accounts[1]!.publicKey, writeText)).rejects.toThrow('Clipboard unavailable');
    expect(writeText).toHaveBeenCalledWith(accounts[1]!.publicKey);
  });

  it('adds a created account to the list without changing the active account', () => {
    const created = { index: 2, publicKey: '7Nd1mBQtrCGZXm3XgMy5b2nStJcQG3FmPkWG3wVvjT8Q', label: 'Account 3' };

    expect(includeCreatedAccount(accounts, created)).toEqual([...accounts, created]);
    expect(baseMenuProps.activeIndex).toBe(0);
  });

  it('allows only one account mutation at a time', () => {
    const gate = createAccountOperationGate();

    expect(gate.acquire()).toBe(true);
    expect(gate.acquire()).toBe(false);
    gate.release();
    expect(gate.acquire()).toBe(true);
  });

  it('closes and restores focus only after a successful account selection', async () => {
    vi.mocked(sendIpcMessage).mockResolvedValue({ success: true } as never);
    const select = vi.fn(async (index: number) => {
      await sendIpcMessage('SET_ACTIVE_ACCOUNT', { index });
      return true;
    });
    const close = vi.fn();
    const focus = vi.fn();

    await expect(selectMenuAccount(1, select, close, focus)).resolves.toBe(true);
    expect(select).toHaveBeenCalledWith(1);
    expect(sendIpcMessage).toHaveBeenCalledWith('SET_ACTIVE_ACCOUNT', { index: 1 });
    expect(close).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledOnce();
  });

  it('keeps the menu open when account selection fails', async () => {
    const close = vi.fn();
    const focus = vi.fn();

    await expect(selectMenuAccount(1, vi.fn().mockResolvedValue(false), close, focus)).resolves.toBe(false);
    expect(close).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
  });

  it('closes on Escape and returns focus to the trigger', () => {
    const close = vi.fn();
    const focus = vi.fn();

    expect(dismissAccountMenuOnEscape('Escape', close, focus)).toBe(true);
    expect(close).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledOnce();
    expect(dismissAccountMenuOnEscape('Enter', close, focus)).toBe(false);
  });

  it('rejects out-of-order balance responses and responses for a different selection', () => {
    expect(isCurrentBalanceResponse(1, 2, 0, 1)).toBe(false);
    expect(isCurrentBalanceResponse(2, 2, 0, 1)).toBe(false);
    expect(isCurrentBalanceResponse(2, 2, 1, 1)).toBe(true);
    expect(isCurrentBalanceResponse(2, 2, 1, null)).toBe(false);
  });
});
