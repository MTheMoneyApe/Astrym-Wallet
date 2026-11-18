import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sendIpcMessage } from '../../src/popup/ipc.js';
import {
  AccountMenu,
  FRIENDBOT_MODE_CHECKING_NOTICE,
  FRIENDBOT_NYM_NOTICE,
  FriendbotFundButton,
  PrivacyModeSelector,
  RecentActivityCard,
  applyFriendbotModeStatus,
  createAccountOperationGate,
  copyPublicAddress,
  dismissAccountMenuOnEscape,
  executeOneClickPrivacyMode,
  formatPublicAddress,
  includeCreatedAccount,
  isCurrentBalanceResponse,
  mergeRecentTransactions,
  resolveRestoredAccountSelection,
  selectMenuAccount,
} from '../../src/popup/Dashboard.js';
import {
  TX_TRANSPORT_HISTORY_STORAGE_KEY,
  parseTxTransportHistory,
  stellarExpertTxUrl,
} from '../../src/shared/txTransportHistory.js';

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
    expect(markup).toContain('class="account-menu-row');
    expect(markup).toContain('class="account-copy-inline"');
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

function renderFriendbot(mode: 'direct' | 'nym', modeKnown: boolean, nymConnected = false) {
  return renderToStaticMarkup(
    React.createElement(FriendbotFundButton, {
      mode,
      modeKnown,
      nymConnected,
      fundingLoading: false,
      onFund: vi.fn(),
    }),
  );
}

describe('Friendbot fund button', () => {
  it('stays disabled while routing mode is unknown, after an IPC error, or when Nym is disconnected, and enables for Direct or connected Nym', () => {
    const unknown = renderFriendbot('direct', false);
    expect(unknown).toContain('disabled=""');
    expect(unknown).toContain(FRIENDBOT_MODE_CHECKING_NOTICE);
    expect(unknown).toContain('role="status"');
    expect(unknown).toContain('aria-describedby="friendbot-fund-notice"');
    expect(unknown).not.toContain(FRIENDBOT_NYM_NOTICE);

    const ipcError = applyFriendbotModeStatus({ ok: false });
    expect(ipcError).toEqual({ mode: 'direct', modeKnown: false, nymConnected: false });
    const errored = renderFriendbot(ipcError.mode, ipcError.modeKnown, ipcError.nymConnected);
    expect(errored).toContain('disabled=""');
    expect(errored).toContain(FRIENDBOT_MODE_CHECKING_NOTICE);

    const unhydrated = applyFriendbotModeStatus({
      ok: true,
      mode: 'nym',
      connected: true,
      preferenceHydrated: false,
    });
    expect(unhydrated.modeKnown).toBe(false);
    expect(renderFriendbot(unhydrated.mode, unhydrated.modeKnown, unhydrated.nymConnected)).toContain(
      'disabled=""',
    );

    const nymDisconnectedGate = applyFriendbotModeStatus({
      ok: true,
      mode: 'nym',
      connected: false,
    });
    const nymDisconnected = renderFriendbot(
      nymDisconnectedGate.mode,
      nymDisconnectedGate.modeKnown,
      nymDisconnectedGate.nymConnected,
    );
    expect(nymDisconnected).toContain('disabled=""');
    expect(nymDisconnected).toContain(FRIENDBOT_NYM_NOTICE);
    expect(nymDisconnected).toContain('role="status"');
    expect(nymDisconnected).toContain('aria-describedby="friendbot-fund-notice"');
    expect(nymDisconnected).not.toContain(FRIENDBOT_MODE_CHECKING_NOTICE);

    const nymConnectedGate = applyFriendbotModeStatus({
      ok: true,
      mode: 'nym',
      connected: true,
    });
    const nymConnected = renderFriendbot(
      nymConnectedGate.mode,
      nymConnectedGate.modeKnown,
      nymConnectedGate.nymConnected,
    );
    expect(nymConnected).not.toContain('disabled');
    expect(nymConnected).not.toContain(FRIENDBOT_NYM_NOTICE);
    expect(nymConnected).not.toContain(FRIENDBOT_MODE_CHECKING_NOTICE);
    expect(nymConnected).not.toContain('aria-describedby');
    expect(nymConnected).toContain('Fondear Testnet (10,000 XLM)');

    const directGate = applyFriendbotModeStatus({ ok: true, mode: 'direct' });
    const direct = renderFriendbot(directGate.mode, directGate.modeKnown, directGate.nymConnected);
    expect(direct).not.toContain('disabled');
    expect(direct).not.toContain(FRIENDBOT_NYM_NOTICE);
    expect(direct).not.toContain(FRIENDBOT_MODE_CHECKING_NOTICE);
    expect(direct).not.toContain('aria-describedby');
    expect(direct).toContain('Fondear Testnet (10,000 XLM)');
  });
});

describe('PrivacyModeSelector', () => {
  it('renders Modo Normal vs Modo Privado Nym with clear active aria-pressed states and status pill', () => {
    const directMarkup = renderToStaticMarkup(
      React.createElement(PrivacyModeSelector, {
        snapshot: {
          state: 'disconnected',
          lastError: null,
          connected: false,
          implementation: 'mix-fetch-offscreen',
          mode: 'direct',
          preferenceHydrated: true,
          egressBlocked: false,
          privacyPreference: null,
        },
        busy: false,
        onSelectDirect: vi.fn(),
        onSelectNym: vi.fn(),
      }),
    );
    expect(directMarkup).toContain('data-testid="dashboard-privacy-selector"');
    expect(directMarkup).toContain('Modo Normal');
    expect(directMarkup).toContain('Modo Privado Nym');
    expect(directMarkup).toContain('data-testid="dashboard-mode-direct" aria-pressed="true"');
    expect(directMarkup).toContain('data-testid="dashboard-mode-nym" aria-pressed="false"');
    expect(directMarkup).toContain('data-testid="privacy-mode-indicator"');

    const nymDisconnectedMarkup = renderToStaticMarkup(
      React.createElement(PrivacyModeSelector, {
        snapshot: {
          state: 'disconnected',
          lastError: null,
          connected: false,
          implementation: 'mix-fetch-offscreen',
          mode: 'nym',
          preferenceHydrated: true,
          egressBlocked: true,
          privacyPreference: 'nym',
        },
        busy: false,
        onSelectDirect: vi.fn(),
        onSelectNym: vi.fn(),
      }),
    );
    expect(nymDisconnectedMarkup).toContain('data-testid="dashboard-mode-nym" aria-pressed="true"');
    expect(nymDisconnectedMarkup).toContain('Red bloqueada por seguridad');
  });
});

describe('executeOneClickPrivacyMode', () => {
  it('switches to Nym and immediately connects in one click without falling back to direct on failure', async () => {
    const order: string[] = [];
    const setMode = vi.fn(async (mode: 'direct' | 'nym') => {
      order.push(`setMode:${mode}`);
    });
    const connect = vi.fn(async () => {
      order.push('connect');
    });
    const disconnect = vi.fn(async () => {
      order.push('disconnect');
    });

    await executeOneClickPrivacyMode('nym', {
      isNymActive: false,
      setMode,
      connect,
      disconnect,
    });
    expect(order).toEqual(['setMode:nym', 'connect']);
    expect(disconnect).not.toHaveBeenCalled();

    // Fail-closed: if connect fails, never calls setMode('direct')
    order.length = 0;
    const failingConnect = vi.fn(async () => {
      order.push('connect:fail');
      throw new Error('mixnet unreachable');
    });
    await expect(
      executeOneClickPrivacyMode('nym', {
        isNymActive: false,
        setMode,
        connect: failingConnect,
        disconnect,
      }),
    ).rejects.toThrow('mixnet unreachable');
    expect(order).toEqual(['setMode:nym', 'connect:fail']);
    expect(setMode).not.toHaveBeenCalledWith('direct');
  });

  it('switches to Direct and disconnects Nym only when Nym was active', async () => {
    const order: string[] = [];
    const setMode = vi.fn(async (mode: 'direct' | 'nym') => {
      order.push(`setMode:${mode}`);
    });
    const connect = vi.fn(async () => {
      order.push('connect');
    });
    const disconnect = vi.fn(async () => {
      order.push('disconnect');
    });

    await executeOneClickPrivacyMode('direct', {
      isNymActive: true,
      setMode,
      connect,
      disconnect,
    });
    expect(order).toEqual(['setMode:direct', 'disconnect']);
    expect(connect).not.toHaveBeenCalled();

    order.length = 0;
    await executeOneClickPrivacyMode('direct', {
      isNymActive: false,
      setMode,
      connect,
      disconnect,
    });
    expect(order).toEqual(['setMode:direct']);
  });
});

describe('RecentActivityCard and txTransportHistory', () => {
  it('parses stored astrym.txTransportHistory safely and builds stellar.expert links', () => {
    expect(TX_TRANSPORT_HISTORY_STORAGE_KEY).toBe('astrym.txTransportHistory');
    expect(
      parseTxTransportHistory({
        abc123: 'nym',
        def456: 'direct',
        bad: 'clearnet',
        num: 42,
      }),
    ).toEqual({
      abc123: 'nym',
      def456: 'direct',
    });
    expect(parseTxTransportHistory(null)).toEqual({});
    expect(stellarExpertTxUrl('abcdef0123456789')).toBe(
      'https://stellar.expert/explorer/testnet/tx/abcdef0123456789',
    );
  });

  it('merges Horizon payments with session sends, attaches Nym/Directo tags, and caps at 5', () => {
    const merged = mergeRecentTransactions(
      [
        {
          id: '1',
          txHash: 'hash_nym_1111111111',
          direction: 'sent',
          amountXlm: '25.5',
          createdAt: '2026-11-18T10:00:00Z',
        },
        {
          id: '2',
          txHash: 'hash_direct_2222222',
          direction: 'received',
          amountXlm: '10000',
          createdAt: '2026-11-18T09:00:00Z',
        },
      ],
      [
        {
          id: 'hash_nym_1111111111',
          txHash: 'hash_nym_1111111111',
          direction: 'sent',
          amountXlm: '25.5',
          createdAt: '2026-11-18T10:00:00Z',
          transport: 'nym',
        },
        {
          id: 'hash_session_333333',
          txHash: 'hash_session_333333',
          direction: 'sent',
          amountXlm: '5',
          createdAt: '2026-11-18T11:00:00Z',
          transport: 'direct',
        },
      ],
      {
        hash_nym_1111111111: 'nym',
        hash_direct_2222222: 'direct',
      },
      5,
    );

    expect(merged).toHaveLength(3);
    expect(merged[0]).toMatchObject({ txHash: 'hash_session_333333', transport: 'direct' });
    expect(merged[1]).toMatchObject({ txHash: 'hash_nym_1111111111', transport: 'nym' });
    expect(merged[2]).toMatchObject({ txHash: 'hash_direct_2222222', transport: 'direct' });

    const markup = renderToStaticMarkup(
      React.createElement(RecentActivityCard, { items: merged }),
    );
    expect(markup).toContain('Historial reciente');
    expect(markup).toContain('Enviado');
    expect(markup).toContain('Recibido');
    expect(markup).toContain('-25.50 XLM');
    expect(markup).toContain('+10,000.00 XLM');
    expect(markup).toContain('tx-badge--nym');
    expect(markup).toContain('>Nym<');
    expect(markup).toContain('tx-badge--direct');
    expect(markup).toContain('>Directo<');
    expect(markup).toContain('https://stellar.expert/explorer/testnet/tx/hash_nym_1111111111');
  });

  it('shows fail-closed notice when Nym is disconnected and no items are loaded', () => {
    const markup = renderToStaticMarkup(
      React.createElement(RecentActivityCard, { items: [], blockedByNym: true }),
    );
    expect(markup).toContain('Conecta Nym para cargar el historial desde Horizon.');
  });
});
