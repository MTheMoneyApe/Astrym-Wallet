import React, { useEffect, useMemo, useRef, useState } from 'react';
import { sendIpcMessage } from './ipc.js';
import { Send } from './Send.js';
import { SppStatusPanel } from './SppStatusPanel.js';
import { NymTransportPanel } from './NymTransportPanel.js';
import { isThemePalette, THEME_PRESETS, type ThemePalette } from './App.js';
import { LOCK_TIMEOUT_OPTIONS_MINUTES, type LockTimeoutMinutes } from '@solanym/wallet-core/src/vault/IAlarmService.js';
import {
  SPP_SESSION_STATUS_STORAGE_KEY,
  SppIntegrationStatus,
  applyStoredSppSessionClearIfNewer,
  createPopupSppIntegrationProbe,
  probeSppFacadePackaged,
  type SppIntegrationSnapshot,
  type SppSessionStatusHandle,
} from '@solanym/wallet-core/src/stellar/spp/SppIntegrationStatus.js';
import type { NymTransportMode } from '@solanym/wallet-core/src/nym/NymTransportPolicy.js';
import type {
  NymHttpSmokeUiResult,
  NymPublicDataUiResult,
  NymStellarHorizonUiResult,
  NymUiSnapshot,
} from './NymTransportPanel.js';
import { beginGatewayPermissionRequestFromUserGesture } from './nymPermissionGesture.js';
import { NYM_LIVE_SMOKE_EXECUTION_AUTHORIZED } from '../nym-offscreen/liveSmokeAuth.js';
import { NYM_VERIFIED_GATEWAY } from '../nym-offscreen/verifiedGateway.js';

function coerceNymUiSnapshot(snap: {
  state: NymUiSnapshot['state'];
  lastError: string | null;
  connected: boolean;
  implementation: string;
  selfAddress?: string | null | undefined;
  mode: NymTransportMode;
  documentReady: boolean;
  diagnosticCode?: string | undefined;
  diagnosticStage?: string | null | undefined;
  assetsReady?: boolean | undefined;
  gatewayAllowlistConfigured?: boolean | undefined;
  selectedGateway?: string | null | undefined;
  gatewayIdentityKey?: string | null | undefined;
  gatewayHostPermissionGranted?: boolean | null | undefined;
  gatewayHostPermissionPattern?: string | null | undefined;
}): NymUiSnapshot {
  const out: NymUiSnapshot = {
    state: snap.state,
    lastError: snap.lastError,
    connected: snap.connected,
    implementation: snap.implementation,
    mode: snap.mode,
    documentReady: snap.documentReady,
  };
  if (snap.selfAddress !== undefined) out.selfAddress = snap.selfAddress;
  if (snap.diagnosticCode !== undefined) out.diagnosticCode = snap.diagnosticCode;
  if (snap.diagnosticStage !== undefined) out.diagnosticStage = snap.diagnosticStage;
  if (snap.assetsReady !== undefined) out.assetsReady = snap.assetsReady;
  if (snap.gatewayAllowlistConfigured !== undefined) {
    out.gatewayAllowlistConfigured = snap.gatewayAllowlistConfigured;
  }
  if (snap.selectedGateway !== undefined) out.selectedGateway = snap.selectedGateway;
  if (snap.gatewayIdentityKey !== undefined) out.gatewayIdentityKey = snap.gatewayIdentityKey;
  if (snap.gatewayHostPermissionGranted !== undefined) {
    out.gatewayHostPermissionGranted = snap.gatewayHostPermissionGranted;
  }
  if (snap.gatewayHostPermissionPattern !== undefined) {
    out.gatewayHostPermissionPattern = snap.gatewayHostPermissionPattern;
  }
  return out;
}

function isLockTimeoutMinutes(value: number): value is LockTimeoutMinutes {
  return LOCK_TIMEOUT_OPTIONS_MINUTES.some((option) => option === value);
}

export function resolveRestoredAccountSelection(
  accounts: Array<{ index: number; publicKey: string; label: string }>,
  activeState: { status: 'VALID' | 'NONE' | 'INVALID'; index: number | null } | null,
) {
  if (activeState?.status === 'VALID' && typeof activeState.index === 'number') {
    const selected = accounts.find((account) => account.index === activeState.index);
    if (selected) {
      return {
        selectedIndex: selected.index,
        confirmedActiveIndex: selected.index,
        account: { address: selected.publicKey, label: selected.label, index: selected.index },
      };
    }
  }

  return {
    selectedIndex: null,
    confirmedActiveIndex: null,
    account: null,
  };
}

type DashboardAccount = { index: number; publicKey: string; label: string };
export type AccountMenuProps = {
  accounts: DashboardAccount[];
  activeIndex: number | null;
  activeAccount: { address: string; label: string; index: number } | null;
  open: boolean;
  loading: boolean;
  busy: boolean;
  error: string;
  notice: string;
  onToggle: () => void;
  onClose: () => void;
  onSelect: (index: number) => Promise<boolean>;
  onCreate: () => Promise<boolean>;
  onRename: (index: number, label: string) => Promise<boolean>;
};

export function formatPublicAddress(address: string): string {
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

async function writeClipboardText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const input = document.createElement('textarea');
  input.value = text;
  input.setAttribute('readonly', '');
  input.style.position = 'fixed';
  input.style.left = '-9999px';
  document.body.appendChild(input);
  try {
    input.select();
    if (!document.execCommand('copy')) throw new Error('Clipboard unavailable');
  } finally {
    input.remove();
  }
}

export async function copyPublicAddress(
  address: string,
  writeText: (text: string) => Promise<void> = writeClipboardText,
): Promise<string> {
  await writeText(address);
  return '¡Dirección copiada!';
}

function CopyAddressButton({ address, label, menuItem = false }: { address: string; label: string; menuItem?: boolean }) {
  const [copyStatus, setCopyStatus] = useState('');
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (statusTimer.current !== null) clearTimeout(statusTimer.current);
  }, []);

  const handleCopy = async () => {
    try {
      setCopyStatus(await copyPublicAddress(address));
    } catch {
      setCopyStatus('No se pudo copiar la dirección. Comprueba el acceso al portapapeles.');
    }

    if (statusTimer.current !== null) clearTimeout(statusTimer.current);
    statusTimer.current = setTimeout(() => setCopyStatus(''), 2200);
  };

  return (
    <div style={{ minWidth: 0 }}>
      <button
        type="button"
        role={menuItem ? 'menuitem' : undefined}
        onClick={handleCopy}
        aria-label={`Copy full public address for ${label}`}
        title="Copy full public address"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, width: '100%', minHeight: 34, padding: '6px 8px', border: '1px solid var(--border-dark)', borderRadius: 6, background: 'transparent', color: 'var(--text-sec)', textAlign: 'left', cursor: 'pointer' }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace', fontSize: '0.72rem' }}>{formatPublicAddress(address)}</span>
        <span aria-hidden="true" style={{ position: 'relative', flex: '0 0 14px', width: 14, height: 14 }}>
          <span style={{ position: 'absolute', top: 1, left: 4, width: 8, height: 9, border: '1px solid currentColor', borderRadius: 2 }} />
          <span style={{ position: 'absolute', top: 4, left: 1, width: 8, height: 9, border: '1px solid currentColor', borderRadius: 2, background: 'var(--surface-color)' }} />
        </span>
      </button>
      {copyStatus && <p role={copyStatus === '¡Dirección copiada!' ? 'status' : 'alert'} style={{ margin: '4px 2px', color: copyStatus === '¡Dirección copiada!' ? 'var(--accent-color)' : 'var(--error-color)', fontSize: '0.72rem' }}>{copyStatus}</p>}
    </div>
  );
}

export function createAccountOperationGate() {
  let busy = false;
  return {
    acquire: () => {
      if (busy) return false;
      busy = true;
      return true;
    },
    release: () => {
      busy = false;
    },
  };
}

export function includeCreatedAccount(accounts: DashboardAccount[], createdAccount: DashboardAccount): DashboardAccount[] {
  return [...accounts.filter((account) => account.index !== createdAccount.index), createdAccount]
    .sort((first, second) => first.index - second.index);
}

export function isCurrentBalanceResponse(
  requestId: number,
  latestRequestId: number,
  accountIndex: number | undefined,
  selectedIndex: number | null,
): boolean {
  return requestId === latestRequestId && (accountIndex === undefined || accountIndex === selectedIndex);
}

export async function selectMenuAccount(
  index: number,
  onSelect: (index: number) => Promise<boolean>,
  onClose: () => void,
  focusTrigger: () => void,
): Promise<boolean> {
  if (!await onSelect(index)) return false;
  onClose();
  focusTrigger();
  return true;
}

export function dismissAccountMenuOnEscape(key: string, onClose: () => void, focusTrigger: () => void): boolean {
  if (key !== 'Escape') return false;
  onClose();
  focusTrigger();
  return true;
}

export function AccountMenu({
  accounts,
  activeIndex,
  activeAccount,
  open,
  loading,
  busy,
  error,
  notice,
  onToggle,
  onClose,
  onSelect,
  onCreate,
  onRename,
}: AccountMenuProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingLabel, setEditingLabel] = useState('');
  const actionsDisabled = loading || busy;

  useEffect(() => {
    if (!open) {
      setEditingIndex(null);
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      dismissAccountMenuOnEscape(event.key, onClose, () => triggerRef.current?.focus());
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onClose]);

  const handleRename = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (editingIndex === null) return;
    const saved = await onRename(editingIndex, editingLabel.trim());
    if (saved) setEditingIndex(null);
  };

  return (
    <div ref={wrapperRef} style={{ minWidth: 0, flex: 1 }}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={activeAccount ? `Account menu, active ${activeAccount.label}` : 'Choose an account'}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="solanym-account-menu"
        onClick={onToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          width: '100%',
          minWidth: 0,
          minHeight: 38,
          padding: '5px 9px',
          border: '1px solid var(--border-dark)',
          borderRadius: 10,
          background: 'var(--surface-color)',
          color: 'var(--text-main)',
          cursor: 'pointer',
        }}
      >
        <span aria-hidden="true" style={{ display: 'grid', placeItems: 'center', flex: '0 0 25px', width: 25, height: 25, borderRadius: '50%', background: 'var(--accent-color)', color: 'var(--bg-color)', fontSize: '0.76rem', fontWeight: 700 }}>
          {activeAccount?.label.trim().slice(0, 1).toUpperCase() || '?'}
        </span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left', flex: 1, fontSize: '0.82rem', fontWeight: 600 }}>
          {activeAccount?.label || 'Choose account'}
        </span>
        <span aria-hidden="true" style={{ flex: '0 0 auto', width: 7, height: 7, borderRight: '1.5px solid currentColor', borderBottom: '1.5px solid currentColor', transform: open ? 'rotate(225deg)' : 'rotate(45deg)', margin: open ? '4px 2px 0' : '0 2px 4px' }} />
      </button>

      {open && (
        <div
          id="solanym-account-menu"
          role="menu"
          aria-label="Wallet accounts"
          aria-busy={loading || busy}
          style={{ position: 'absolute', zIndex: 20, top: 'calc(100% + 8px)', right: 0, width: 'min(320px, calc(100vw - 40px))', maxHeight: 'min(440px, calc(100vh - 84px))', overflowY: 'auto', padding: 8, border: '1px solid var(--border-dark)', borderRadius: 12, background: 'var(--surface-color)', boxShadow: '0 12px 32px rgba(0,0,0,0.36)' }}
        >
          {loading ? (
            <p className="text-secondary" style={{ margin: 0, padding: '10px 8px', fontSize: '0.82rem' }}>Loading accounts...</p>
          ) : accounts.length === 0 ? (
            <p className="text-secondary" style={{ margin: 0, padding: '10px 8px', fontSize: '0.82rem' }}>No accounts yet.</p>
          ) : accounts.map((accountItem) => {
            const isActive = activeIndex === accountItem.index;
            const isEditing = editingIndex === accountItem.index;
            return (
              <div key={accountItem.index} role="group" aria-label={accountItem.label} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 4, borderRadius: 8, background: isActive ? 'rgba(143,232,208,0.08)' : 'transparent' }}>
                {isEditing ? (
                  <form onSubmit={handleRename} style={{ display: 'flex', gap: 6, flex: 1, minWidth: 0 }}>
                    <input
                      autoFocus
                      aria-label={`New name for ${accountItem.label}`}
                      value={editingLabel}
                      maxLength={40}
                      onChange={(event) => setEditingLabel(event.target.value)}
                      disabled={actionsDisabled}
                      style={{ minWidth: 0, flex: 1, padding: '7px 8px', border: '1px solid var(--border-dark)', borderRadius: 6, background: 'var(--bg-color)', color: 'var(--text-main)' }}
                    />
                    <button type="submit" className="btn-outline" disabled={actionsDisabled || !editingLabel.trim()} aria-label={`Save name for ${accountItem.label}`}>Save</button>
                    <button type="button" className="btn-outline" disabled={actionsDisabled} onClick={() => setEditingIndex(null)} aria-label="Cancel rename">Cancel</button>
                  </form>
                ) : (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={async () => {
                          await selectMenuAccount(accountItem.index, onSelect, onClose, () => triggerRef.current?.focus());
                        }}
                        disabled={actionsDisabled}
                        aria-current={isActive ? 'true' : undefined}
                        aria-label={`${isActive ? 'Active account' : 'Select account'}: ${accountItem.label}`}
                        style={{ display: 'flex', alignItems: 'center', gap: 9, flex: 1, minWidth: 0, padding: '8px 7px', border: 0, borderRadius: 6, background: 'transparent', color: 'var(--text-main)', textAlign: 'left', cursor: busy ? 'wait' : 'pointer' }}
                      >
                        <span aria-hidden="true" style={{ display: 'grid', placeItems: 'center', flex: '0 0 28px', width: 28, height: 28, borderRadius: '50%', border: `1px solid ${isActive ? 'var(--accent-color)' : 'var(--border-dark)'}`, color: isActive ? 'var(--accent-color)' : 'var(--text-sec)', fontSize: '0.75rem', fontWeight: 700 }}>
                          {accountItem.label.trim().slice(0, 1).toUpperCase() || '?'}
                        </span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1, fontSize: '0.84rem', fontWeight: 600 }}>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{accountItem.label}</span>
                          {isActive && <span style={{ flex: '0 0 auto', color: 'var(--accent-color)', fontSize: '0.68rem' }}>Active</span>}
                        </span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="btn-outline"
                        disabled={actionsDisabled}
                        aria-label={`Rename ${accountItem.label}`}
                        title={`Rename ${accountItem.label}`}
                        onClick={() => {
                          setEditingIndex(accountItem.index);
                          setEditingLabel(accountItem.label);
                        }}
                        style={{ padding: '6px 8px', fontSize: '0.72rem' }}
                      >
                        Rename
                      </button>
                    </div>
                    <CopyAddressButton address={accountItem.publicKey} label={accountItem.label} menuItem />
                  </>
                )}
              </div>
            );
          })}

          <div style={{ height: 1, margin: '6px 4px', background: 'var(--border-dark)' }} />
          <button type="button" role="menuitem" className="btn-outline" onClick={() => void onCreate()} disabled={actionsDisabled} style={{ width: '100%', textAlign: 'left', padding: '9px 10px' }}>
            {busy ? 'Working...' : '+  Create account'}
          </button>
          <button type="button" role="menuitem" className="btn-outline" disabled title="Account import is not available yet." style={{ width: '100%', marginTop: 6, textAlign: 'left', padding: '9px 10px', opacity: 0.5, cursor: 'not-allowed' }}>
            Import account
          </button>
          <p className="text-secondary" style={{ margin: '4px 4px 2px', fontSize: '0.68rem' }}>Account import is not available yet.</p>
          {error && <p role="alert" className="error-text" style={{ margin: '8px 4px 2px', fontSize: '0.78rem' }}>{error}</p>}
          {notice && <p role="status" className="text-secondary" style={{ margin: '8px 4px 2px', fontSize: '0.78rem' }}>{notice}</p>}
        </div>
      )}
    </div>
  );
}

function ReceiveAddressView({ account, onBack }: { account: { address: string; label: string; index: number } | null; onBack: () => void }) {
  const [qrError, setQrError] = useState('');
  const [copyStatus, setCopyStatus] = useState('');

  if (!account) {
    return (
      <div className="view-container">
        <div className="header">
          <button onClick={onBack} className="btn-icon">&larr; Back</button>
          <h2>Receive</h2>
          <div style={{ width: 45 }} />
        </div>
        <div className="card" style={{ padding: 20 }}>
          <p className="text-secondary" style={{ margin: 0 }}>No active account is available to receive funds.</p>
        </div>
      </div>
    );
  }

  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(account.address)}`;

  const handleCopy = async () => {
    try {
      setCopyStatus(await copyPublicAddress(account.address));
    } catch {
      setCopyStatus('No se pudo copiar la dirección. Comprueba el acceso al portapapeles.');
    }
  };

  return (
    <div className="view-container" style={{ overflowY: 'auto' }}>
      <div className="header">
        <button onClick={onBack} className="btn-icon">&larr; Back</button>
        <h2>Receive</h2>
        <div style={{ width: 45 }} />
      </div>

      <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        <div style={{ background: 'var(--surface-color)', padding: 15, borderRadius: 16, border: '1px solid var(--border-dark)', display: 'grid', placeItems: 'center' }}>
          <img
            src={qrUrl}
            alt={`Receive address QR for ${account.address}`}
            style={{ width: 200, height: 200, display: 'block', background: '#fff', borderRadius: 12, border: '1px solid var(--border-dark)' }}
            onError={() => setQrError('Unable to load QR. Please copy the address below.')}
          />
        </div>

        {qrError ? <p className="error-text" style={{ margin: 0 }}>{qrError}</p> : null}

        <div style={{ width: '100%' }}>
          <p className="text-secondary" style={{ margin: '0 0 8px', fontSize: '0.72rem' }}>Public address</p>
          <div style={{ background: 'var(--bg-color)', border: '1px solid var(--border-dark)', borderRadius: 10, padding: '10px 12px', wordBreak: 'break-all', fontFamily: 'monospace', fontSize: '0.76rem', lineHeight: 1.5 }}>
            {account.address}
          </div>
        </div>

        <button onClick={() => void handleCopy()} className="btn-primary" style={{ width: '100%' }}>
          Copy address
        </button>

        {copyStatus ? <p role={copyStatus === '¡Dirección copiada!' ? 'status' : 'alert'} style={{ margin: 0, fontSize: '0.75rem', color: copyStatus === '¡Dirección copiada!' ? 'var(--accent-color)' : 'var(--error-color)' }}>{copyStatus}</p> : null}

        <p className="text-secondary" style={{ margin: 0, fontSize: '0.76rem', textAlign: 'center' }}>
          This is your public address for receiving {account.address.startsWith('G') ? 'XLM on Stellar Testnet' : 'SOL on Devnet'}.
        </p>
      </div>
    </div>
  );
}

export function Dashboard({ onLock }: { onLock: () => void }) {
  const [account, setAccount] = useState<{ address: string; label: string; index: number } | null>(null);
  const [balance, setBalance] = useState<string>('--');
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceError, setBalanceError] = useState('');
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [accountError, setAccountError] = useState('');
  const [accounts, setAccounts] = useState<Array<{ index: number; publicKey: string; label: string }>>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [confirmedActiveIndex, setConfirmedActiveIndex] = useState<number | null>(null);
  const [accountManagerOpen, setAccountManagerOpen] = useState(false);
  const [accountSwitchError, setAccountSwitchError] = useState('');
  const [accountManagerNotice, setAccountManagerNotice] = useState('');
  const [switchingAccount, setSwitchingAccount] = useState(false);
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [renamingAccount, setRenamingAccount] = useState(false);
  const [rpcStatus, setRpcStatus] = useState<'connecting' | 'connected' | 'unavailable' | 'idle'>('idle');
  const [currency, setCurrency] = useState<'XLM' | 'SOL'>('XLM');
  const [isUnfunded, setIsUnfunded] = useState(false);
  const [fundingLoading, setFundingLoading] = useState(false);
  const [fundingMessage, setFundingMessage] = useState('');
  const [view, setView] = useState<'dashboard' | 'send' | 'receive' | 'settings'>('dashboard');
  const latestBalanceRequest = useRef(0);
  const selectedIndexRef = useRef<number | null>(null);
  const accountMutationInFlight = useRef<ReturnType<typeof createAccountOperationGate> | null>(null);
  if (!accountMutationInFlight.current) accountMutationInFlight.current = createAccountOperationGate();
  
  // Settings / Recovery State
  const [recoveryPhrase, setRecoveryPhrase] = useState<string[] | null>(null);
  const [settingsPassword, setSettingsPassword] = useState('');
  const [settingsError, setSettingsError] = useState('');
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [autoLockTimeout, setAutoLockTimeout] = useState<LockTimeoutMinutes>(5);
  const [autoLockLoading, setAutoLockLoading] = useState(false);
  const [autoLockError, setAutoLockError] = useState('');
  const [autoLockSaved, setAutoLockSaved] = useState(false);

  // Theme State
  const [themePreset, setThemePreset] = useState<string>(
    typeof document !== 'undefined' && document.documentElement.classList.contains('astrym-webapp')
      ? 'astrym'
      : 'midnight',
  );
  const [customColors, setCustomColors] = useState<ThemePalette>({
    '--bg-color': '#11151B',
    '--surface-color': '#1B222B',
    '--accent-color': '#8FE8D0',
    '--text-main': '#F4F7F8',
    '--text-sec': '#A4ADBA'
  });

  useEffect(() => {
    selectedIndexRef.current = selectedIndex;
  }, [selectedIndex]);

  useEffect(() => {
    if (view === 'dashboard') {
      loadAccounts();
    } else {
      if (recoveryPhrase) setRecoveryPhrase(null);
      setSettingsPassword('');
      setSettingsError('');
    }
  }, [view]);

  useEffect(() => {
    if (view === 'settings') {
      setAutoLockLoading(true);
      setAutoLockError('');
      void sendIpcMessage('GET_AUTO_LOCK_TIMEOUT', {}).then((result) => {
        setAutoLockTimeout(result.timeoutMinutes);
      }).catch((cause: unknown) => {
        setAutoLockError(cause instanceof Error ? cause.message : 'Could not load auto-lock settings.');
      }).finally(() => setAutoLockLoading(false));

      chrome.storage.local.get(['themePreset', 'customColors'], (res) => {
        const storage = res as Record<string, unknown>;
        const presetValue = typeof storage['themePreset'] === 'string' ? String(storage['themePreset']) : null;
        if (presetValue) setThemePreset(presetValue);
        if (isThemePalette(storage['customColors'])) {
          setCustomColors(storage['customColors'] as ThemePalette);
        }
      });
    }
  }, [view]);

  const applyColors = (colors: ThemePalette) => {
    const root = document.documentElement;
    if (colors['--bg-color']) root.style.setProperty('--bg-color', colors['--bg-color']);
    if (colors['--surface-color']) root.style.setProperty('--surface-color', colors['--surface-color']);
    if (colors['--accent-color']) root.style.setProperty('--accent-color', colors['--accent-color']);
    if (colors['--text-main']) root.style.setProperty('--text-main', colors['--text-main']);
    if (colors['--text-sec']) root.style.setProperty('--text-sec', colors['--text-sec']);
    
    if (colors['--bg-color'] === '#F7FAF8') {
       root.style.setProperty('--border-color', '#E5E7EB');
       root.style.setProperty('--border-dark', '#D1D5DB');
    } else {
       root.style.setProperty('--border-color', '#2A323C');
       root.style.setProperty('--border-dark', '#333333');
    }
  };

  const handleThemeChange = (preset: string) => {
    setThemePreset(preset);
    const presetColors = preset === 'custom' ? customColors : (THEME_PRESETS[preset] as ThemePalette | undefined);
    const fallbackColors = THEME_PRESETS['midnight'] as ThemePalette;
    const colors: ThemePalette = (presetColors ?? fallbackColors) as ThemePalette;
    applyColors(colors);
    chrome.storage.local.set({ themePreset: preset, customColors: preset === 'custom' ? colors : undefined });
  };

  const handleCustomColorChange = (key: string, value: string) => {
    const newColors: ThemePalette = { ...customColors, [key as keyof ThemePalette]: value };
    setCustomColors(newColors);
    applyColors(newColors);
    chrome.storage.local.set({ themePreset: 'custom', customColors: newColors });
  };

  const loadAccounts = async () => {
    setLoadingAccounts(true);
    setAccountError('');
    setAccountSwitchError('');
    setAccountManagerNotice('');
    try {
      const [nextAccounts, activeState] = await Promise.all([
        sendIpcMessage('GET_ACCOUNTS', {}),
        sendIpcMessage('GET_ACTIVE_ACCOUNT', {}),
      ]);

      setAccounts(nextAccounts);

      if (nextAccounts.length === 0) {
        setSelectedIndex(null);
        selectedIndexRef.current = null;
        setConfirmedActiveIndex(null);
        setAccount(null);
        setAccountManagerOpen(false);
        return;
      }

      const restored = resolveRestoredAccountSelection(nextAccounts, activeState);
      if (restored.account) {
        setSelectedIndex(restored.selectedIndex);
        selectedIndexRef.current = restored.selectedIndex;
        setConfirmedActiveIndex(restored.confirmedActiveIndex);
        setAccount(restored.account);
        setAccountManagerOpen(false);
        await fetchBalance(restored.account.address, restored.account.index);
        return;
      }

      if (activeState.status === 'INVALID') {
        setAccountError('Saved active account is invalid or no longer exists. Select an account manually.');
        setAccountManagerOpen(true);
      }

      setSelectedIndex(null);
      selectedIndexRef.current = null;
      setConfirmedActiveIndex(null);
      setAccount(null);
    } catch (err: any) {
      setAccountError(err.message || 'Failed to load active account state');
      setSelectedIndex(null);
      selectedIndexRef.current = null;
      setConfirmedActiveIndex(null);
      setAccount(null);
      setAccountManagerOpen(false);
    } finally {
      setLoadingAccounts(false);
    }
  };

  const fetchBalance = async (address: string, accountIndex?: number) => {
    const requestId = ++latestBalanceRequest.current;
    setBalanceLoading(true);
    setBalanceError('');
    setFundingMessage('');
    setRpcStatus('connecting');

    const isStellar = address.startsWith('G') && address.length === 56;
    setCurrency(isStellar ? 'XLM' : 'SOL');

    try {
      if (isStellar) {
        const bal = await sendIpcMessage('GET_STELLAR_BALANCE', { address });
        if (!isCurrentBalanceResponse(requestId, latestBalanceRequest.current, accountIndex, selectedIndexRef.current)) {
          return;
        }
        if (!bal.exists) {
          setIsUnfunded(true);
          setBalance('0.0000');
        } else {
          setIsUnfunded(false);
          const num = Number(bal.balance);
          setBalance(isNaN(num) ? bal.balance : num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 }));
        }
        setRpcStatus('connected');
      } else {
        setIsUnfunded(false);
        const bal = await sendIpcMessage('GET_BALANCE', { address });
        if (!isCurrentBalanceResponse(requestId, latestBalanceRequest.current, accountIndex, selectedIndexRef.current)) {
          return;
        }
        const sol = (Number(bal.lamports) / 1000000000).toFixed(4);
        setBalance(sol);
        setRpcStatus('connected');
      }
    } catch (err: any) {
      if (latestBalanceRequest.current !== requestId) {
        return;
      }
      const rawError = err.message || 'Unknown error';
      if (rawError.includes('timeout')) {
        setBalanceError(`Timeout: ${rawError}`);
      } else if (rawError.includes('fetch')) {
        setBalanceError(`Network Error: ${rawError}`);
      } else {
        setBalanceError(`Error: ${rawError}`);
      }
      setBalance('--');
      setRpcStatus('unavailable');
    } finally {
      if (latestBalanceRequest.current === requestId) {
        setBalanceLoading(false);
      }
    }
  };

  const handleFundTestnet = async (targetAddress: string) => {
    setFundingLoading(true);
    setFundingMessage('');
    try {
      const res = await sendIpcMessage('FUND_STELLAR_TESTNET_ACCOUNT', { address: targetAddress });
      if (res.success) {
        setFundingMessage('Account funded with 10,000 Testnet XLM! Refreshing...');
        await fetchBalance(targetAddress, account?.index);
      } else {
        setFundingMessage(res.message);
      }
    } catch (err: any) {
      setFundingMessage(err.message || 'Failed to fund account.');
    } finally {
      setFundingLoading(false);
    }
  };

  const handleSelectAccount = async (index: number): Promise<boolean> => {
    const mutationGate = accountMutationInFlight.current!;
    if (!mutationGate.acquire()) return false;
    const nextAccount = accounts.find((acc) => acc.index === index);
    if (!nextAccount) {
      mutationGate.release();
      return false;
    }

    const previousIndex = selectedIndex;
    const previousAccount = account;
    setSwitchingAccount(true);
    setAccountSwitchError('');

    try {
      const response = await sendIpcMessage('SET_ACTIVE_ACCOUNT', { index });
      if (!response.success) throw new Error('The wallet did not confirm the account change.');
      setSelectedIndex(index);
      selectedIndexRef.current = index;
      setConfirmedActiveIndex(index);
      setAccount({ address: nextAccount.publicKey, label: nextAccount.label, index: nextAccount.index });
      setAccountError('');
      void fetchBalance(nextAccount.publicKey, nextAccount.index);
      return true;
    } catch (err: any) {
      setSelectedIndex(previousIndex);
      selectedIndexRef.current = previousIndex;
      if (previousAccount) {
        setAccount(previousAccount);
      }
      setConfirmedActiveIndex((current) => (current === index ? previousIndex : current));
      setAccountSwitchError(err.message || 'Unable to switch account');
      return false;
    } finally {
      setSwitchingAccount(false);
      mutationGate.release();
    }
  };

  const handleCreateAccount = async (): Promise<boolean> => {
    const mutationGate = accountMutationInFlight.current!;
    if (!mutationGate.acquire()) return false;
    setCreatingAccount(true);
    setAccountSwitchError('');
    setAccountManagerNotice('');
    try {
      const result = await sendIpcMessage('ADD_ACCOUNT', { idempotencyUuid: crypto.randomUUID() });
      setAccounts((current) => includeCreatedAccount(current, result.account));
      setAccountManagerNotice(`${result.account.label} created. Select it to make it active.`);
      return true;
    } catch (err: any) {
      setAccountSwitchError(err.message || 'Unable to create account');
      return false;
    } finally {
      setCreatingAccount(false);
      mutationGate.release();
    }
  };

  const handleRenameAccount = async (index: number, label: string): Promise<boolean> => {
    const mutationGate = accountMutationInFlight.current!;
    if (!mutationGate.acquire()) return false;
    setRenamingAccount(true);
    setAccountSwitchError('');
    setAccountManagerNotice('');
    try {
      const response = await sendIpcMessage('RENAME_ACCOUNT', { index, label });
      if (!response.success) throw new Error('The wallet did not confirm the account rename.');
      setAccounts((current) => current.map((item) => item.index === index ? { ...item, label } : item));
      setAccount((current) => current?.index === index ? { ...current, label } : current);
      setAccountManagerNotice('Account renamed.');
      return true;
    } catch (err: any) {
      setAccountSwitchError(err.message || 'Unable to rename account');
      return false;
    } finally {
      setRenamingAccount(false);
      mutationGate.release();
    }
  };

  const handleToggleAccountMenu = () => {
    setAccountSwitchError('');
    setAccountManagerNotice('');
    setAccountManagerOpen((open) => !open);
  };

  const closeAccountMenu = () => setAccountManagerOpen(false);

  const handleLock = async () => {
    try {
      await sendIpcMessage('LOCK_VAULT', {});
      setRecoveryPhrase(null);
      onLock();
    } catch (err: any) {
      setAccountError(err.message);
    }
  };

  const handleRevealMnemonic = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settingsPassword) return;
    setSettingsError('');
    setSettingsLoading(true);
    setCopySuccess(false);
    try {
      const res = await sendIpcMessage('REVEAL_RECOVERY_PHRASE', { auth: settingsPassword });
      setRecoveryPhrase(res.recoveryPhrase);
    } catch (err: any) {
      setSettingsError(err.message);
    } finally {
      setSettingsLoading(false);
      setSettingsPassword('');
    }
  };

  const handleAutoLockChange = async (timeoutMinutes: LockTimeoutMinutes) => {
    const previousTimeout = autoLockTimeout;
    setAutoLockTimeout(timeoutMinutes);
    setAutoLockLoading(true);
    setAutoLockError('');
    setAutoLockSaved(false);
    try {
      await sendIpcMessage('SET_AUTO_LOCK_TIMEOUT', { timeoutMinutes });
      setAutoLockSaved(true);
    } catch (cause) {
      setAutoLockTimeout(previousTimeout);
      setAutoLockError(cause instanceof Error ? cause.message : 'Could not save auto-lock settings.');
    } finally {
      setAutoLockLoading(false);
    }
  };

  const handleCopyPhrase = async () => {
    if (!recoveryPhrase) return;
    try {
      await navigator.clipboard.writeText(recoveryPhrase.join(' '));
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 3000);
    } catch (err) {
      setSettingsError('Failed to copy to clipboard.');
    }
  };

  const [sppFacadePackaged, setSppFacadePackaged] = useState(false);
  const [sppSessionHandle, setSppSessionHandle] = useState<SppSessionStatusHandle | null>(null);
  const [sppSessionGeneration, setSppSessionGeneration] = useState(0);
  const [sppProbeDone, setSppProbeDone] = useState(false);
  const sppGenerationRef = useRef(0);
  const sppHandleRef = useRef<SppSessionStatusHandle | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const metaUrl =
          typeof chrome !== 'undefined' && chrome.runtime?.getURL
            ? chrome.runtime.getURL('spp/SPP_ASSET_META.json')
            : '';
        const packaged = metaUrl ? await probeSppFacadePackaged(metaUrl) : false;
        if (!cancelled) setSppFacadePackaged(packaged);
      } catch {
        if (!cancelled) setSppFacadePackaged(false);
      } finally {
        if (!cancelled) setSppProbeDone(true);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local?.get) return;
    const applyStored = (raw: unknown) => {
      const next = applyStoredSppSessionClearIfNewer(raw, {
        handle: sppHandleRef.current,
        generation: sppGenerationRef.current,
      });
      if (!next.applied) return;
      sppGenerationRef.current = next.generation;
      sppHandleRef.current = next.handle;
      setSppSessionGeneration(next.generation);
      setSppSessionHandle(next.handle);
    };
    chrome.storage.local.get([SPP_SESSION_STATUS_STORAGE_KEY], (res) => {
      applyStored((res as Record<string, unknown>)[SPP_SESSION_STATUS_STORAGE_KEY]);
    });
    const onChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area !== 'local' || !changes[SPP_SESSION_STATUS_STORAGE_KEY]) return;
      applyStored(changes[SPP_SESSION_STATUS_STORAGE_KEY].newValue);
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  const sppStatusSnapshot: SppIntegrationSnapshot = useMemo(
    () =>
      new SppIntegrationStatus(
        createPopupSppIntegrationProbe({
          isFacadePackaged: () => sppFacadePackaged,
          getSession: () => sppSessionHandle,
        }),
      ).snapshot(),
    [sppFacadePackaged, sppSessionHandle],
  );

  const [nymSnapshot, setNymSnapshot] = useState<NymUiSnapshot>({
    state: 'disconnected',
    lastError: null,
    connected: false,
    implementation: 'mix-fetch-offscreen',
    mode: 'direct',
    documentReady: false,
  });
  const [nymBusy, setNymBusy] = useState(false);
  const [nymHttpSmokeResult, setNymHttpSmokeResult] = useState<NymHttpSmokeUiResult | null>(
    null,
  );
  const [nymPublicDataResult, setNymPublicDataResult] =
    useState<NymPublicDataUiResult | null>(null);
  const [nymStellarHorizonResult, setNymStellarHorizonResult] =
    useState<NymStellarHorizonUiResult | null>(null);

  useEffect(() => {
    if (view !== 'settings') return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await sendIpcMessage('NYM_STATUS', {});
        if (!cancelled) setNymSnapshot(coerceNymUiSnapshot(snap));
      } catch (err: unknown) {
        if (!cancelled) {
          setNymSnapshot((prev) => ({
            ...prev,
            state: 'error',
            connected: false,
            lastError: err instanceof Error ? err.message : 'NYM_STATUS failed',
            documentReady: false,
          }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [view]);

  const handleNymConnect = () => {
    const origin = nymSnapshot.selectedGateway || NYM_VERIFIED_GATEWAY.wssOrigin;
    const permissionsApi = typeof chrome !== 'undefined' ? chrome.permissions : undefined;
    let permissionPending: ReturnType<typeof beginGatewayPermissionRequestFromUserGesture> | null =
      null;
    if (permissionsApi && typeof permissionsApi.request === 'function') {
      try {
        permissionPending = beginGatewayPermissionRequestFromUserGesture(origin);
      } catch (err: unknown) {
        setNymSnapshot((prev) => ({
          ...prev,
          state: 'error',
          connected: false,
          documentReady: false,
          lastError: err instanceof Error ? err.message : 'Host permission request failed to start',
          diagnosticCode:
            err && typeof err === 'object' && 'code' in err
              ? String((err as { code: unknown }).code)
              : 'PERMISSION_REQUEST_FAILED',
          gatewayHostPermissionGranted: false,
        }));
        return;
      }
    }

    setNymBusy(true);
    setNymSnapshot((prev) => ({
      ...prev,
      state: 'connecting',
      connected: false,
      lastError: null,
    }));
    void (async () => {
      try {
        if (permissionPending) {
          const gesture = await permissionPending;
          if (!gesture.granted) {
            setNymSnapshot((prev) => ({
              ...prev,
              state: 'error',
              connected: false,
              documentReady: false,
              lastError:
                'Host permission not granted. Grant the gateway, then Connect. Permission ≠ Mixnet Ready.',
              diagnosticCode: 'PERMISSION_DENIED',
              gatewayHostPermissionGranted: false,
            }));
            return;
          }
        }
        const snap = await sendIpcMessage('NYM_CONNECT', {});
        setNymSnapshot(coerceNymUiSnapshot(snap));
      } catch (err: unknown) {
        setNymSnapshot((prev) => ({
          ...prev,
          state: 'error',
          connected: false,
          documentReady: false,
          lastError: err instanceof Error ? err.message : 'NYM_CONNECT failed',
        }));
      } finally {
        setNymBusy(false);
      }
    })();
  };

  const handleNymDisconnect = async () => {
    setNymBusy(true);
    try {
      const snap = await sendIpcMessage('NYM_DISCONNECT', {});
      setNymSnapshot(coerceNymUiSnapshot(snap));
    } catch (err: unknown) {
      setNymSnapshot((prev) => ({
        ...prev,
        state: 'error',
        connected: false,
        lastError: err instanceof Error ? err.message : 'NYM_DISCONNECT failed',
      }));
    } finally {
      setNymBusy(false);
    }
  };

  const handleNymSetMode = async (mode: NymTransportMode) => {
    setNymBusy(true);
    try {
      const snap = await sendIpcMessage('NYM_SET_MODE', { mode });
      setNymSnapshot(coerceNymUiSnapshot(snap));
    } catch (err: unknown) {
      setNymSnapshot((prev) => ({
        ...prev,
        lastError: err instanceof Error ? err.message : 'NYM_SET_MODE failed',
      }));
    } finally {
      setNymBusy(false);
    }
  };

  const handleNymConfigureGateway = async (origin: string, identityKey?: string) => {
    setNymBusy(true);
    try {
      const payload: { origin: string; identityKey?: string } = { origin };
      if (identityKey) payload.identityKey = identityKey;
      const res = await sendIpcMessage('NYM_CONFIGURE_GATEWAY', payload);
      setNymSnapshot(coerceNymUiSnapshot(res.snapshot));
    } catch (err: unknown) {
      setNymSnapshot((prev) => ({
        ...prev,
        state: 'error',
        connected: false,
        lastError: err instanceof Error ? err.message : 'NYM_CONFIGURE_GATEWAY failed',
        diagnosticCode: 'GATEWAY_CONFIG_FAILED',
      }));
    } finally {
      setNymBusy(false);
    }
  };

  const handleNymRequestPermission = () => {
    const origin = nymSnapshot.selectedGateway || NYM_VERIFIED_GATEWAY.wssOrigin;
    if (typeof chrome === 'undefined' || typeof chrome.permissions?.request !== 'function') {
      setNymSnapshot((prev) => ({
        ...prev,
        lastError:
          'El webapp de Android no usa permisos de host de Chrome. Pulsa Connect: el gateway verificado se configura solo y MixFetch corre en esta página.',
        diagnosticCode: 'OK',
      }));
      return;
    }

    // MV3: chrome.permissions.request must start on this click tick (no await/IPC first).
    let pending: ReturnType<typeof beginGatewayPermissionRequestFromUserGesture>;
    try {
      pending = beginGatewayPermissionRequestFromUserGesture(origin);
    } catch (err: unknown) {
      const code =
        err && typeof err === 'object' && 'code' in err
          ? String((err as { code: unknown }).code)
          : 'PERMISSION_REQUEST_FAILED';
      setNymSnapshot((prev) => ({
        ...prev,
        state: 'error',
        connected: false,
        lastError: err instanceof Error ? err.message : 'Host permission request failed to start',
        diagnosticCode: code,
        gatewayHostPermissionGranted: false,
      }));
      return;
    }

    void (async () => {
      setNymBusy(true);
      try {
        const gesture = await pending;
        // Refresh SW snapshot via contains-only IPC (never request from background).
        const res = await sendIpcMessage('NYM_REQUEST_GATEWAY_PERMISSION', {
          origin: gesture.origin,
        });
        const confirmed = gesture.granted && res.granted;
        setNymSnapshot(
          coerceNymUiSnapshot({
            ...res.snapshot,
            gatewayHostPermissionGranted: confirmed,
            gatewayHostPermissionPattern: gesture.hostPermissionPattern,
            connected: false,
            state:
              res.snapshot.state === 'connected' ? 'disconnected' : res.snapshot.state,
          }),
        );
        if (!confirmed) {
          setNymSnapshot((prev) => ({
            ...prev,
            state: 'disconnected',
            connected: false,
            lastError:
              'Host permission not granted (denied, dismissed, or Chrome contains()=false). Click Grant permission again; Connect will stay blocked until contains() is true. Permission ≠ Mixnet Ready.',
            diagnosticCode: 'PERMISSION_DENIED',
            gatewayHostPermissionGranted: false,
          }));
        } else {
          setNymSnapshot((prev) => ({
            ...prev,
            lastError: null,
            diagnosticCode: 'OK',
            gatewayHostPermissionGranted: true,
          }));
        }
      } catch (err: unknown) {
        const code =
          err && typeof err === 'object' && 'code' in err
            ? String((err as { code: unknown }).code)
            : 'PERMISSION_REQUEST_FAILED';
        setNymSnapshot((prev) => ({
          ...prev,
          state: 'error',
          connected: false,
          lastError: err instanceof Error ? err.message : 'Host permission request failed',
          diagnosticCode: code,
          gatewayHostPermissionGranted: false,
        }));
      } finally {
        setNymBusy(false);
      }
    })();
  };

  const handleNymLiveSmokeDryRun = async () => {
    setNymBusy(true);
    try {
      const res = await sendIpcMessage('NYM_LIVE_SMOKE', { confirmLiveSmoke: false });
      setNymSnapshot(
        coerceNymUiSnapshot({
          ...res.snapshot,
          connected: false,
          diagnosticCode: res.snapshot.diagnosticCode ?? 'SMOKE_DRY_RUN',
        }),
      );
    } catch (err: unknown) {
      setNymSnapshot((prev) => ({
        ...prev,
        connected: false,
        lastError: err instanceof Error ? err.message : 'NYM_LIVE_SMOKE dry-run failed',
        diagnosticCode: 'SMOKE_DRY_RUN',
      }));
    } finally {
      setNymBusy(false);
    }
  };

  const handleNymStellarHorizonProbe = async (transport: NymTransportMode) => {
    setNymBusy(true);
    setNymStellarHorizonResult({
      state: 'running',
      transport,
      url: '(resolving…)',
      logicalUrl: '(resolving…)',
      effectiveUrl: '(resolving…)',
      urlRewritten: false,
      rewriteReason: null,
      durationMs: 0,
      httpStatus: null,
      httpOk: null,
      contentType: null,
      horizonVersion: null,
      networkPassphrase: null,
      lastLedger: null,
      lastLedgerBaseFee: null,
      horizonErrorDetail: null,
      responsePreview: null,
      message: `Horizon probe via ${transport}…`,
      transportFetchInvoked: false,
    });
    try {
      const res = await sendIpcMessage('NYM_STELLAR_HORIZON_PROBE', { transport });
      setNymStellarHorizonResult({
        state: res.state,
        transport: res.transport,
        url: res.logicalUrl || res.url,
        logicalUrl: res.logicalUrl,
        effectiveUrl: res.effectiveUrl,
        urlRewritten: res.urlRewritten,
        rewriteReason: res.rewriteReason,
        durationMs: res.durationMs,
        httpStatus: res.httpStatus,
        httpOk: res.httpOk,
        contentType: res.contentType,
        horizonVersion: res.horizonVersion,
        networkPassphrase: res.networkPassphrase,
        lastLedger: res.lastLedger,
        lastLedgerBaseFee: res.lastLedgerBaseFee,
        horizonErrorDetail: res.horizonErrorDetail,
        responsePreview: res.responsePreview,
        message: res.message,
        transportFetchInvoked: res.transportFetchInvoked,
      });
      setNymSnapshot((prev) => ({ ...prev, mode: res.transport }));
    } catch (err: unknown) {
      setNymStellarHorizonResult({
        state: 'error',
        transport,
        url: '',
        logicalUrl: '',
        effectiveUrl: '',
        urlRewritten: false,
        rewriteReason: null,
        durationMs: 0,
        httpStatus: null,
        httpOk: null,
        contentType: null,
        horizonVersion: null,
        networkPassphrase: null,
        lastLedger: null,
        lastLedgerBaseFee: null,
        horizonErrorDetail: null,
        responsePreview: null,
        message: err instanceof Error ? err.message : 'NYM_STELLAR_HORIZON_PROBE failed',
        transportFetchInvoked: false,
      });
    } finally {
      setNymBusy(false);
    }
  };

  const handleNymPublicDataFetch = async (transport: NymTransportMode) => {
    setNymBusy(true);
    setNymPublicDataResult({
      state: 'running',
      transport,
      url: '(resolving…)',
      probeId: '…',
      durationMs: 0,
      httpStatus: null,
      httpOk: null,
      probeMatched: false,
      echoedProbeId: null,
      responsePreview: null,
      message: `Public data via ${transport}…`,
      transportFetchInvoked: false,
    });
    try {
      const res = await sendIpcMessage('NYM_PUBLIC_DATA_FETCH', { transport });
      setNymPublicDataResult({
        state: res.state,
        transport: res.transport,
        url: res.url,
        probeId: res.probeId,
        durationMs: res.durationMs,
        httpStatus: res.httpStatus,
        httpOk: res.httpOk,
        probeMatched: res.probeMatched,
        echoedProbeId: res.echoedProbeId,
        responsePreview: res.responsePreview,
        message: res.message,
        transportFetchInvoked: res.transportFetchInvoked,
      });
      setNymSnapshot((prev) => ({ ...prev, mode: res.transport }));
    } catch (err: unknown) {
      setNymPublicDataResult({
        state: 'error',
        transport,
        url: '',
        probeId: '',
        durationMs: 0,
        httpStatus: null,
        httpOk: null,
        probeMatched: false,
        echoedProbeId: null,
        responsePreview: null,
        message: err instanceof Error ? err.message : 'NYM_PUBLIC_DATA_FETCH failed',
        transportFetchInvoked: false,
      });
    } finally {
      setNymBusy(false);
    }
  };

  const handleNymHttpSmoke = async (url?: string) => {
    setNymBusy(true);
    setNymHttpSmokeResult({
      state: 'running',
      url: url?.trim() || '(resolving…)',
      probeId: '…',
      durationMs: 0,
      httpStatus: null,
      httpOk: null,
      probeMatched: false,
      echoedProbeId: null,
      message: 'MixFetch HTTP smoke running…',
      mixFetchInvoked: false,
    });
    try {
      const payload: { url?: string } = {};
      if (url?.trim()) payload.url = url.trim();
      const res = await sendIpcMessage('NYM_HTTP_SMOKE', payload);
      setNymHttpSmokeResult({
        state: res.state,
        url: res.url,
        probeId: res.probeId,
        durationMs: res.durationMs,
        httpStatus: res.httpStatus,
        httpOk: res.httpOk,
        probeMatched: res.probeMatched,
        echoedProbeId: res.echoedProbeId,
        message: res.message,
        mixFetchInvoked: res.mixFetchInvoked,
      });
    } catch (err: unknown) {
      setNymHttpSmokeResult({
        state: 'error',
        url: url?.trim() || '',
        probeId: '',
        durationMs: 0,
        httpStatus: null,
        httpOk: null,
        probeMatched: false,
        echoedProbeId: null,
        message: err instanceof Error ? err.message : 'NYM_HTTP_SMOKE failed',
        mixFetchInvoked: false,
      });
    } finally {
      setNymBusy(false);
    }
  };

  const handleNymLiveSmokeExecute = async () => {
    if (!NYM_LIVE_SMOKE_EXECUTION_AUTHORIZED) {
      setNymSnapshot((prev) => ({
        ...prev,
        connected: false,
        lastError:
          'Live smoke not authorized in this build. Run pnpm build:nym-live-smoke, reload, then retry.',
        diagnosticCode: 'SMOKE_NOT_AUTHORIZED',
      }));
      return;
    }
    setNymBusy(true);
    setNymSnapshot((prev) => ({
      ...prev,
      state: 'connecting',
      connected: false,
      lastError: null,
    }));
    try {
      const res = await sendIpcMessage('NYM_LIVE_SMOKE', { confirmLiveSmoke: true });
      setNymSnapshot(
        coerceNymUiSnapshot({
          ...res.snapshot,
          // Live smoke disconnects after createMixFetch; Ready was true mid-flight only.
          diagnosticCode: res.executedCreateMixFetch
            ? res.snapshot.diagnosticCode ?? 'OK'
            : res.snapshot.diagnosticCode ?? 'SMOKE_NOT_AUTHORIZED',
          lastError: res.executedCreateMixFetch
            ? res.snapshot.lastError ??
              'Live smoke: createMixFetch succeeded then disconnected (session complete)'
            : res.snapshot.lastError,
        }),
      );
    } catch (err: unknown) {
      setNymSnapshot((prev) => ({
        ...prev,
        state: 'error',
        connected: false,
        documentReady: false,
        lastError: err instanceof Error ? err.message : 'NYM_LIVE_SMOKE execute failed',
        diagnosticCode:
          err && typeof err === 'object' && 'code' in err
            ? String((err as { code: unknown }).code)
            : 'CONNECT_FAILED',
      }));
    } finally {
      setNymBusy(false);
    }
  };

  if (view === 'receive') {
    return <ReceiveAddressView account={account} onBack={() => setView('dashboard')} />;
  }

  if (view === 'send' && account) {
    return <Send onBack={() => setView('dashboard')} accountIndex={account.index} accountAddress={account.address} onComplete={() => setView('dashboard')} />;
  }

  if (view === 'settings') {
    return (
      <div className="view-container" style={{ overflowY: 'auto' }}>
        <div className="header">
          <button onClick={() => setView('dashboard')} className="btn-icon">&larr; Back</button>
          <h2>Settings</h2>
          <div style={{ width: 45 }}></div>
        </div>

        <SppStatusPanel
          snapshot={sppStatusSnapshot}
          probing={!sppProbeDone}
          sessionGeneration={sppSessionGeneration}
        />
        <NymTransportPanel
          snapshot={nymSnapshot}
          busy={nymBusy}
          onConnect={handleNymConnect}
          onDisconnect={handleNymDisconnect}
          onSetMode={handleNymSetMode}
          onConfigureGateway={handleNymConfigureGateway}
          onRequestGatewayPermission={handleNymRequestPermission}
          onLiveSmokeDryRun={handleNymLiveSmokeDryRun}
          onLiveSmokeExecute={handleNymLiveSmokeExecute}
          liveSmokeAuthorized={NYM_LIVE_SMOKE_EXECUTION_AUTHORIZED}
          onHttpSmoke={handleNymHttpSmoke}
          httpSmokeResult={nymHttpSmokeResult}
          onPublicDataFetch={handleNymPublicDataFetch}
          publicDataResult={nymPublicDataResult}
          onStellarHorizonProbe={handleNymStellarHorizonProbe}
          stellarHorizonResult={nymStellarHorizonResult}
        />

        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ margin: '0 0 10px 0' }}>Theme</h3>
          <select 
            value={themePreset} 
            onChange={e => handleThemeChange(e.target.value)}
            className="input-field"
            style={{ width: '100%', marginBottom: 15 }}
          >
            <option value="astrym">Astrym</option>
            <option value="midnight">Midnight Green</option>
            <option value="lightmint">Light Mint</option>
            <option value="forest">Forest</option>
            <option value="custom">Custom Colors</option>
          </select>
          
          {themePreset === 'custom' && (
            <div style={{ display: 'grid', gap: 10 }}>
              {Object.entries(customColors).map(([key, value]) => (
                <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ fontSize: '0.85em', color: 'var(--text-sec)' }}>{key.replace('--', '')}</label>
                  <input 
                    type="color" 
                    value={value} 
                    onChange={e => handleCustomColorChange(key, e.target.value)}
                    style={{ background: 'none', border: 'none', width: 30, height: 30, cursor: 'pointer', padding: 0 }}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 6px' }}>Auto-lock</h3>
          <p className="text-secondary" style={{ margin: '0 0 12px', fontSize: '0.78rem', lineHeight: 1.4 }}>
            Lock after this period without activity in the wallet. A real interaction resets the timer; service-worker restarts do not.
          </p>
          <label htmlFor="auto-lock-timeout" className="text-secondary" style={{ display: 'block', marginBottom: 6, fontSize: '0.76rem' }}>Inactivity period</label>
          <select
            id="auto-lock-timeout"
            className="input-field"
            value={autoLockTimeout}
            disabled={autoLockLoading}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (isLockTimeoutMinutes(value)) void handleAutoLockChange(value);
            }}
            style={{ width: '100%' }}
          >
            {LOCK_TIMEOUT_OPTIONS_MINUTES.map((minutes) => <option key={minutes} value={minutes}>{minutes} minute{minutes === 1 ? '' : 's'}</option>)}
          </select>
          {autoLockError && <p role="alert" className="error-text" style={{ margin: '8px 0 0', fontSize: '0.75rem' }}>{autoLockError}</p>}
          {autoLockSaved && <p role="status" className="text-accent" style={{ margin: '8px 0 0', fontSize: '0.75rem' }}>Auto-lock setting saved.</p>}
        </div>

        <div className="card">
          <h3 style={{ margin: '0 0 10px 0' }}>Wallet Backup</h3>
          <p className="text-secondary" style={{ marginBottom: 20, fontSize: '0.9em' }}>
            Your recovery phrase is the only way to restore your wallet. Never share it with anyone.
          </p>

          {recoveryPhrase ? (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}>
                {recoveryPhrase.map((word, i) => (
                  <div key={i} className="phrase-word">
                    <span className="text-secondary" style={{ userSelect: 'none' }}>{i + 1}.</span>
                    <span className="text-accent">{word}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={handleCopyPhrase} className="btn-secondary" style={{ flex: 1 }}>
                  {copySuccess ? 'Copied \u2713' : 'Copy'}
                </button>
                <button onClick={() => setRecoveryPhrase(null)} className="btn-secondary" style={{ flex: 1 }}>
                  Hide
                </button>
              </div>
              {copySuccess && (
                <p className="text-secondary" style={{ fontSize: '0.8em', marginTop: 10, textAlign: 'center' }}>
                  Clipboard contents may be accessible to other apps. Clear your clipboard after secure offline storage.
                </p>
              )}
            </div>
          ) : (
            <form onSubmit={handleRevealMnemonic} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input 
                type="password" 
                placeholder="Enter password to reveal"
                value={settingsPassword}
                onChange={e => setSettingsPassword(e.target.value)}
                className="input-field"
              />
              {settingsError && <p className="error-text">{settingsError}</p>}
              <button type="submit" disabled={settingsLoading || !settingsPassword} className="btn-primary">
                {settingsLoading ? 'Verifying...' : 'Reveal Recovery Phrase'}
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="view-container">
      <div className="header" style={{ position: 'relative', gap: 8 }}>
        <h2 className="text-accent" style={{ margin: 0, fontSize: '1.2rem' }}>Stellar Privacy</h2>
        <AccountMenu
          accounts={accounts}
          activeIndex={confirmedActiveIndex}
          activeAccount={account}
          open={accountManagerOpen}
          loading={loadingAccounts}
          busy={switchingAccount || creatingAccount || renamingAccount}
          error={accountSwitchError}
          notice={accountManagerNotice}
          onToggle={handleToggleAccountMenu}
          onClose={closeAccountMenu}
          onSelect={handleSelectAccount}
          onCreate={handleCreateAccount}
          onRename={handleRenameAccount}
        />
        <div style={{ display: 'flex', gap: 6, flex: '0 0 auto' }}>
          <button onClick={() => setView('settings')} className="btn-outline" style={{ padding: '6px 8px', fontSize: '0.82rem' }}>Settings</button>
          <button onClick={handleLock} className="btn-outline" style={{ padding: '6px 8px', fontSize: '0.82rem' }}>Lock</button>
        </div>
      </div>
      
      {accountError && (
        <div className="error-card">
          <span style={{ fontSize: '0.9em' }}>{accountError}</span>
          <button onClick={loadAccounts} className="btn-error">Retry</button>
        </div>
      )}
      
      {loadingAccounts ? (
        <div className="center-content">
          <p className="text-secondary">Loading account...</p>
        </div>
      ) : account ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="card balance-card" style={{ padding: 25, border: '1px solid var(--border-color)' }}>
            <div className="balance-indicator" data-status={rpcStatus}></div>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
              <div>
                <h3 style={{ margin: '0 0 4px 0', fontSize: '1rem', fontWeight: '500' }}>{account.label}</h3>
                <CopyAddressButton address={account.address} label={account.label} />
              </div>
              
              <div className="horizon-status" data-horizon-status={rpcStatus}>
                {rpcStatus === 'connecting' && <span className="text-secondary">Horizon pending</span>}
                {rpcStatus === 'connected' && <span className="text-accent">Horizon OK</span>}
                {rpcStatus === 'unavailable' && <span className="error-text">Horizon failed</span>}
              </div>
            </div>
            
            <h1 style={{ margin: '0', fontSize: '2.8rem', fontWeight: '700' }}>
              {balanceLoading ? <span className="text-secondary" style={{ fontSize: '2rem' }}>...</span> : balance} 
              <span className="text-secondary" style={{ fontSize: '1.2rem', fontWeight: 'normal', marginLeft: 8 }}>{currency}</span>
            </h1>

            {isUnfunded && (
              <div style={{ marginTop: 15, padding: '12px 14px', background: 'rgba(255, 193, 7, 0.12)', border: '1px solid rgba(255, 193, 7, 0.3)', borderRadius: 8 }}>
                <p style={{ margin: '0 0 8px 0', fontSize: '0.82rem', color: 'var(--text-main)' }}>
                  This account is unfunded on Stellar Testnet. You can request free Testnet XLM to fund it.
                </p>
                <button
                  type="button"
                  onClick={() => handleFundTestnet(account.address)}
                  disabled={fundingLoading}
                  className="btn-outline"
                  style={{ width: '100%', padding: '8px 12px', fontSize: '0.82rem', fontWeight: 600, color: 'var(--accent-color)', borderColor: 'var(--accent-color)', cursor: 'pointer' }}
                >
                  {fundingLoading ? 'Funding from Friendbot...' : 'Fund with Friendbot (10,000 Testnet XLM)'}
                </button>
                {fundingMessage && (
                  <p style={{ margin: '8px 0 0', fontSize: '0.78rem', color: 'var(--accent-color)' }}>{fundingMessage}</p>
                )}
              </div>
            )}

            {balanceError && (
              <div style={{ marginTop: 15, padding: 10, background: 'rgba(255, 107, 107, 0.1)', borderRadius: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="error-text" style={{ fontSize: '0.85em' }}>{balanceError}</span>
                <button onClick={() => fetchBalance(account.address, account.index)} disabled={balanceLoading} className="btn-error">Retry</button>
              </div>
            )}
          </div>

          <div className="action-grid">
            <button onClick={() => setView('send')} className="btn-primary" style={{ padding: 14 }}>Send</button>
            <button onClick={() => setView('receive')} className="btn-secondary" style={{ padding: 14 }}>Receive</button>
          </div>
        </div>
      ) : (
        <div className="center-content">
          <p className="text-secondary">{accounts.length > 0 ? 'Choose an account from the wallet menu.' : 'No accounts are available. Open the wallet menu to create one.'}</p>
        </div>
      )}
    </div>
  );
}
