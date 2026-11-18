import React, { useEffect, useMemo, useRef, useState } from 'react';
import { sendIpcMessage } from './ipc.js';
import { Send } from './Send.js';
import { SppStatusPanel } from './SppStatusPanel.js';
import { NymTransportPanel } from './NymTransportPanel.js';
import {
  SPP_BOOTNODE_URL_KEY,
  SPP_CONTRACT_CONFIG_KEY,
  SPP_POOL_CONTRACT_KEY,
  SPP_PREPARE_STATUS_KEY,
  isSppWriteReady,
  type SppPrepareStatus,
} from '../shared/sppPrepareStatus.js';
import { ensureSppAutoPrepareIfNeeded } from '../background/spp/sppAutoPrepare.js';
import { parseSppContractConfig } from '@solanym/wallet-core/src/stellar/spp/sppContractConfig.js';
import {
  getNethermindPublicTestnetContractConfig,
  NETHERMIND_PUBLIC_XLM_POOL_CONTRACT,
} from '@solanym/wallet-core/src/stellar/spp/nethermind/nethermindPublicTestnet.js';
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
import { PrivacyModeIndicator } from './privacyIndicator.js';
import { NYM_PRIVACY_PREFERENCE_STORAGE_KEY } from '../shared/nymPrivacyPreference.js';
import {
  TX_TRANSPORT_HISTORY_STORAGE_KEY,
  parseTxTransportHistory,
  readTxTransportHistory,
  recordTxTransport,
  stellarExpertTxUrl,
  type TxTransportHistoryMap,
  type TxTransportKind,
} from '../shared/txTransportHistory.js';
import { bindNymRuntimeStatus } from '../shared/nymRuntimeStatus.js';
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
  preferenceHydrated?: boolean;
  egressBlocked?: boolean;
  privacyPreference?: 'direct' | 'nym' | null;
  preferenceDurable?: boolean;
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
  if (snap.preferenceHydrated !== undefined) out.preferenceHydrated = snap.preferenceHydrated;
  if (snap.egressBlocked !== undefined) out.egressBlocked = snap.egressBlocked;
  if (snap.privacyPreference !== undefined) out.privacyPreference = snap.privacyPreference;
  if (snap.preferenceDurable !== undefined) out.preferenceDurable = snap.preferenceDurable;
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

function CopyAddressButton({
  address,
  label,
  menuItem = false,
  compact = false,
}: {
  address: string;
  label: string;
  menuItem?: boolean;
  compact?: boolean;
}) {
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

  if (compact) {
    return (
      <div style={{ minWidth: 0, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <button
          type="button"
          role={menuItem ? 'menuitem' : undefined}
          onClick={handleCopy}
          aria-label={`Copy full public address for ${label}`}
          title={copyStatus || 'Copy full public address'}
          className="account-copy-inline"
        >
          <span>{copyStatus === '¡Dirección copiada!' ? 'Copiada ✓' : formatPublicAddress(address)}</span>
          <span aria-hidden="true" style={{ position: 'relative', flex: '0 0 12px', width: 12, height: 12 }}>
            <span style={{ position: 'absolute', top: 0, left: 3, width: 7, height: 8, border: '1px solid currentColor', borderRadius: 1.5 }} />
            <span style={{ position: 'absolute', top: 3, left: 0, width: 7, height: 8, border: '1px solid currentColor', borderRadius: 1.5, background: 'var(--bg-color)' }} />
          </span>
        </button>
      </div>
    );
  }

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
    <div ref={wrapperRef} className="account-menu-wrap">
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
          minHeight: 44,
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
          className="account-menu-panel"
          role="menu"
          aria-label="Wallet accounts"
          aria-busy={loading || busy}
        >
          {loading ? (
            <p className="text-secondary" style={{ margin: 0, padding: '8px 6px', fontSize: '0.8rem' }}>Loading accounts...</p>
          ) : accounts.length === 0 ? (
            <p className="text-secondary" style={{ margin: 0, padding: '8px 6px', fontSize: '0.8rem' }}>No accounts yet.</p>
          ) : accounts.map((accountItem) => {
            const isActive = activeIndex === accountItem.index;
            const isEditing = editingIndex === accountItem.index;
            return (
              <div
                key={accountItem.index}
                role="group"
                aria-label={accountItem.label}
                className={`account-menu-row ${isActive ? 'account-menu-row--active' : ''}`}
              >
                {isEditing ? (
                  <form onSubmit={handleRename} style={{ display: 'flex', gap: 6, flex: 1, minWidth: 0 }}>
                    <input
                      autoFocus
                      aria-label={`New name for ${accountItem.label}`}
                      value={editingLabel}
                      maxLength={40}
                      onChange={(event) => setEditingLabel(event.target.value)}
                      disabled={actionsDisabled}
                      style={{ minWidth: 0, flex: 1, padding: '5px 8px', border: '1px solid var(--border-dark)', borderRadius: 6, background: 'var(--bg-color)', color: 'var(--text-main)', fontSize: '0.8rem' }}
                    />
                    <button type="submit" className="btn-outline" disabled={actionsDisabled || !editingLabel.trim()} aria-label={`Save name for ${accountItem.label}`} style={{ padding: '4px 8px', fontSize: '0.72rem' }}>Save</button>
                    <button type="button" className="btn-outline" disabled={actionsDisabled} onClick={() => setEditingIndex(null)} aria-label="Cancel rename" style={{ padding: '4px 8px', fontSize: '0.72rem' }}>Cancel</button>
                  </form>
                ) : (
                  <>
                    <button
                      type="button"
                      role="menuitem"
                      className="account-menu-row__select"
                      onClick={async () => {
                        await selectMenuAccount(accountItem.index, onSelect, onClose, () => triggerRef.current?.focus());
                      }}
                      disabled={actionsDisabled}
                      aria-current={isActive ? 'true' : undefined}
                      aria-label={`${isActive ? 'Active account' : 'Select account'}: ${accountItem.label}`}
                      style={{ cursor: busy ? 'wait' : 'pointer' }}
                    >
                      <span aria-hidden="true" style={{ display: 'grid', placeItems: 'center', flex: '0 0 22px', width: 22, height: 22, borderRadius: '50%', border: `1px solid ${isActive ? 'var(--accent-color)' : 'var(--border-dark)'}`, color: isActive ? 'var(--accent-color)' : 'var(--text-sec)', fontSize: '0.7rem', fontWeight: 700 }}>
                        {accountItem.label.trim().slice(0, 1).toUpperCase() || '?'}
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0, flex: 1, fontSize: '0.8rem', fontWeight: 600 }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{accountItem.label}</span>
                        {isActive && <span style={{ flex: '0 0 auto', color: 'var(--accent-color)', fontSize: '0.65rem' }}>Active</span>}
                      </span>
                    </button>
                    <div className="account-menu-row__actions">
                      <CopyAddressButton address={accountItem.publicKey} label={accountItem.label} menuItem compact />
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
                        style={{ padding: '4px 6px', fontSize: '0.69rem', minBlockSize: 26 }}
                      >
                        Rename
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })}

          <div style={{ height: 1, margin: '5px 4px', background: 'var(--border-color)' }} />
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 6 }}>
            <button type="button" role="menuitem" className="btn-outline" onClick={() => void onCreate()} disabled={actionsDisabled} style={{ width: '100%', textAlign: 'center', padding: '6px 8px', fontSize: '0.76rem' }}>
              {busy ? 'Working...' : '+ Create account'}
            </button>
            <button type="button" role="menuitem" className="btn-outline" disabled title="Account import is not available yet." style={{ width: '100%', textAlign: 'center', padding: '6px 8px', fontSize: '0.76rem', opacity: 0.5, cursor: 'not-allowed' }}>
              Import account
            </button>
          </div>
          <p className="text-secondary" style={{ margin: '4px 4px 0', fontSize: '0.66rem' }}>Account import is not available yet.</p>
          {error && <p role="alert" className="error-text" style={{ margin: '6px 4px 2px', fontSize: '0.76rem' }}>{error}</p>}
          {notice && <p role="status" className="text-secondary" style={{ margin: '6px 4px 2px', fontSize: '0.76rem' }}>{notice}</p>}
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
            className="receive-qr"
            style={{ width: 200, height: 200, display: 'block', background: '#fff', borderRadius: 12, border: '1px solid var(--border-dark)' }}
            onError={() => setQrError('Unable to load QR. Please copy the address below.')}
          />
        </div>

        {qrError ? <p className="error-text" style={{ margin: 0 }}>{qrError}</p> : null}

        <div style={{ width: '100%' }}>
          <p className="text-secondary" style={{ margin: '0 0 8px', fontSize: '0.72rem' }}>Public address</p>
          <div className="address-wrap" style={{ background: 'var(--bg-color)', border: '1px solid var(--border-dark)', borderRadius: 10, padding: '10px 12px', fontSize: '0.76rem', lineHeight: 1.5 }}>
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

export const FRIENDBOT_NYM_NOTICE =
  'Connect Nym Mixnet or switch to Direct mode to fund this Testnet account with Friendbot.';

export const FRIENDBOT_MODE_CHECKING_NOTICE = 'Checking routing mode...';

const FRIENDBOT_FUND_NOTICE_ID = 'friendbot-fund-notice';

export type FriendbotModeGate = {
  mode: NymTransportMode;
  modeKnown: boolean;
  nymConnected: boolean;
};

export const FRIENDBOT_MODE_GATE_INITIAL: FriendbotModeGate = {
  mode: 'direct',
  modeKnown: false,
  nymConnected: false,
};

export function applyFriendbotModeStatus(
  result:
    | { ok: true; mode: NymTransportMode; connected?: boolean; preferenceHydrated?: boolean }
    | { ok: false },
): FriendbotModeGate {
  if (!result.ok || result.preferenceHydrated === false) return FRIENDBOT_MODE_GATE_INITIAL;
  return {
    mode: result.mode,
    modeKnown: true,
    nymConnected: result.connected === true,
  };
}

export function friendbotFundBlocked(
  mode: NymTransportMode,
  modeKnown: boolean,
  nymConnected = false,
): boolean {
  if (!modeKnown) return true;
  if (mode === 'direct') return false;
  if (mode === 'nym') return !nymConnected;
  const _exhaustive: never = mode;
  return _exhaustive;
}

function friendbotFundNotice(
  mode: NymTransportMode,
  modeKnown: boolean,
  nymConnected = false,
): string | null {
  if (!modeKnown) return FRIENDBOT_MODE_CHECKING_NOTICE;
  switch (mode) {
    case 'nym':
      return nymConnected ? null : FRIENDBOT_NYM_NOTICE;
    case 'direct':
      return null;
    default: {
      const _exhaustive: never = mode;
      return _exhaustive;
    }
  }
}

export function FriendbotFundButton({
  mode,
  modeKnown,
  nymConnected = false,
  fundingLoading,
  onFund,
}: {
  mode: NymTransportMode;
  modeKnown: boolean;
  nymConnected?: boolean;
  fundingLoading: boolean;
  onFund: () => void;
}) {
  const blocked = friendbotFundBlocked(mode, modeKnown, nymConnected);
  const notice = friendbotFundNotice(mode, modeKnown, nymConnected);
  return (
    <>
      <button
        type="button"
        onClick={onFund}
        disabled={fundingLoading || blocked}
        aria-describedby={notice ? FRIENDBOT_FUND_NOTICE_ID : undefined}
        className="btn-secondary"
        style={{
          width: '100%',
          padding: '9px 12px',
          fontSize: '0.84rem',
          fontWeight: 600,
          cursor: blocked ? 'not-allowed' : 'pointer',
          opacity: blocked ? 0.55 : 1,
        }}
      >
        {fundingLoading ? 'Fondeando en Testnet…' : 'Fondear Testnet (10,000 XLM)'}
      </button>
      {notice ? (
        <p id={FRIENDBOT_FUND_NOTICE_ID} role="status" style={{ margin: '8px 0 0', fontSize: '0.76rem', lineHeight: 1.4, color: 'var(--text-sec)' }}>
          {notice}
        </p>
      ) : null}
    </>
  );
}

/**
 * 1-click privacy switch orchestration without breaking fail-closed semantics:
 * - `'nym'` persists Nym mode first and immediately connects MixFetch.
 *   If connect fails, mode stays `'nym'` (fail-closed; never reverts to Direct).
 * - `'direct'` persists Direct mode explicitly and tears down Nym if active.
 */
export async function executeOneClickPrivacyMode(
  targetMode: NymTransportMode,
  deps: {
    isNymActive: boolean;
    setMode: (mode: NymTransportMode) => Promise<void>;
    connect: () => Promise<void>;
    disconnect: () => Promise<void>;
  },
): Promise<void> {
  if (targetMode === 'nym') {
    await deps.setMode('nym');
    await deps.connect();
    return;
  }
  await deps.setMode('direct');
  if (deps.isNymActive) {
    try {
      await deps.disconnect();
    } catch {
      /* explicit Direct choice is already persisted; ignore teardown error */
    }
  }
}

export type DashboardRecentTx = {
  id: string;
  txHash: string;
  direction: 'sent' | 'received';
  amountXlm: string;
  createdAt: string;
  transport?: TxTransportKind | undefined;
};

export function formatShortTxHash(txHash: string): string {
  if (txHash.length <= 12) return txHash;
  return `${txHash.slice(0, 6)}…${txHash.slice(-4)}`;
}

export function formatShortTxDate(iso: string): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return iso;
  try {
    return new Date(parsed).toLocaleString('es-ES', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return new Date(parsed).toISOString().slice(0, 16).replace('T', ' ');
  }
}

export function formatXlmAmount(raw: string): string {
  const num = Number(raw);
  if (Number.isNaN(num)) return raw;
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

export function mergeRecentTransactions(
  horizonPayments: readonly DashboardRecentTx[],
  sessionTxs: readonly DashboardRecentTx[],
  transportMap: TxTransportHistoryMap,
  limit = 5,
): DashboardRecentTx[] {
  const byHash = new Map<string, DashboardRecentTx>();
  for (const tx of sessionTxs) {
    if (!tx.txHash) continue;
    const mappedTransport = transportMap[tx.txHash] ?? tx.transport;
    byHash.set(tx.txHash, {
      ...tx,
      ...(mappedTransport ? { transport: mappedTransport } : {}),
    });
  }
  for (const tx of horizonPayments) {
    if (!tx.txHash) continue;
    const existing = byHash.get(tx.txHash);
    const mappedTransport = transportMap[tx.txHash] ?? existing?.transport ?? tx.transport;
    byHash.set(tx.txHash, {
      ...tx,
      ...(mappedTransport ? { transport: mappedTransport } : {}),
    });
  }
  return [...byHash.values()]
    .sort((a, b) => {
      const timeA = Date.parse(a.createdAt);
      const timeB = Date.parse(b.createdAt);
      const validA = Number.isNaN(timeA) ? 0 : timeA;
      const validB = Number.isNaN(timeB) ? 0 : timeB;
      return validB - validA;
    })
    .slice(0, Math.max(1, limit));
}

export function RecentActivityCard({
  items,
  loading = false,
  blockedByNym = false,
  error = '',
}: {
  items: readonly DashboardRecentTx[];
  loading?: boolean;
  blockedByNym?: boolean;
  error?: string;
}) {
  return (
    <section className="card activity-card" data-testid="dashboard-recent-activity">
      <h3 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 600 }}>Historial reciente</h3>
      {loading && items.length === 0 ? (
        <p className="text-secondary" style={{ margin: 0, fontSize: '0.8rem', lineHeight: 1.4 }}>
          Cargando historial…
        </p>
      ) : items.length > 0 ? (
        <ul className="activity-list">
          {items.map((item) => {
            const isSent = item.direction === 'sent';
            return (
              <li key={item.id || item.txHash} className="activity-item" data-testid="recent-tx-row">
                <div className="activity-item__main">
                  <div className="activity-item__top">
                    <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>
                      {isSent ? 'Enviado' : 'Recibido'}
                    </span>
                    {item.transport === 'nym' ? (
                      <span className="tx-badge tx-badge--nym" data-testid="tx-transport-badge">
                        Nym
                      </span>
                    ) : item.transport === 'direct' ? (
                      <span className="tx-badge tx-badge--direct" data-testid="tx-transport-badge">
                        Directo
                      </span>
                    ) : null}
                  </div>
                  <div className="activity-item__meta">
                    <span>{formatShortTxDate(item.createdAt)}</span>
                    <a
                      href={stellarExpertTxUrl(item.txHash)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="tx-explorer-link"
                      data-testid="tx-explorer-link"
                      title={item.txHash}
                    >
                      {formatShortTxHash(item.txHash)} ↗
                    </a>
                  </div>
                </div>
                <span
                  style={{
                    fontWeight: 700,
                    fontVariantNumeric: 'tabular-nums',
                    whiteSpace: 'nowrap',
                    color: isSent ? 'var(--text-main)' : 'var(--accent-color)',
                  }}
                >
                  {isSent ? '-' : '+'}
                  {formatXlmAmount(item.amountXlm)} XLM
                </span>
              </li>
            );
          })}
        </ul>
      ) : blockedByNym ? (
        <p className="text-secondary" style={{ margin: 0, fontSize: '0.8rem', lineHeight: 1.4 }}>
          Conecta Nym para cargar el historial desde Horizon.
        </p>
      ) : error ? (
        <p className="text-secondary" style={{ margin: 0, fontSize: '0.8rem', lineHeight: 1.4 }}>
          No se pudo cargar el historial reciente.
        </p>
      ) : (
        <p className="text-secondary" style={{ margin: 0, fontSize: '0.8rem', lineHeight: 1.4 }}>
          Aún no hay movimientos recientes en esta cuenta.
        </p>
      )}
    </section>
  );
}

export function PrivacyModeSelector({
  snapshot,
  busy,
  onSelectDirect,
  onSelectNym,
}: {
  snapshot: NymUiSnapshot;
  busy: boolean;
  onSelectDirect: () => void;
  onSelectNym: () => void;
}) {
  const hydrated = snapshot.preferenceHydrated === true;
  const isDirect = hydrated && snapshot.mode === 'direct' && snapshot.egressBlocked !== true;
  const isNym = hydrated && snapshot.mode === 'nym';
  const connecting = snapshot.state === 'connecting';

  return (
    <div className="card privacy-card" data-testid="dashboard-privacy-selector">
      <div className="privacy-switcher" role="group" aria-label="Modo de privacidad">
        <button
          type="button"
          className="privacy-switcher__btn"
          data-testid="dashboard-mode-direct"
          aria-pressed={isDirect}
          disabled={busy || isDirect}
          onClick={onSelectDirect}
        >
          <span className={`privacy-dot ${isDirect ? 'privacy-dot--direct' : ''}`} aria-hidden="true" />
          Modo Normal
        </button>
        <button
          type="button"
          className="privacy-switcher__btn"
          data-testid="dashboard-mode-nym"
          aria-pressed={isNym}
          disabled={busy || (isNym && snapshot.connected)}
          onClick={onSelectNym}
        >
          <span
            className={`privacy-dot ${isNym ? (snapshot.connected ? 'privacy-dot--nym' : 'privacy-dot--blocked') : ''}`}
            aria-hidden="true"
          />
          {connecting ? 'Conectando Nym…' : 'Modo Privado Nym'}
        </button>
      </div>
      <div className="row-between" style={{ flexWrap: 'wrap' }}>
        <PrivacyModeIndicator snapshot={snapshot} />
        {isNym && !snapshot.connected && !connecting ? (
          <span style={{ fontSize: '0.72rem', color: 'var(--text-sec)' }}>
            Red bloqueada por seguridad
          </span>
        ) : null}
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
  const [txTransportHistory, setTxTransportHistory] = useState<TxTransportHistoryMap>({});
  const [horizonPayments, setHorizonPayments] = useState<DashboardRecentTx[]>([]);
  const [sessionTxs, setSessionTxs] = useState<DashboardRecentTx[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
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
  const [themePreset, setThemePreset] = useState<string>('astrym');
  const [customColors, setCustomColors] = useState<ThemePalette>({
    '--bg-color': '#191A1C',
    '--surface-color': '#141416',
    '--accent-color': '#3CE894',
    '--text-main': '#FFFFFF',
    '--text-sec': '#D0D5DD'
  });

  useEffect(() => {
    selectedIndexRef.current = selectedIndex;
  }, [selectedIndex]);

  useEffect(() => {
    let cancelled = false;
    void readTxTransportHistory().then((map) => {
      if (!cancelled) setTxTransportHistory(map);
    });
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return () => { cancelled = true; };
    const onChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area !== 'local' || !changes[TX_TRANSPORT_HISTORY_STORAGE_KEY]) return;
      setTxTransportHistory(
        parseTxTransportHistory(changes[TX_TRANSPORT_HISTORY_STORAGE_KEY].newValue),
      );
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      cancelled = true;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, []);

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

  const fetchRecentPayments = async (
    address: string,
    requestId: number,
    accountIndex?: number,
  ) => {
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const res = await sendIpcMessage('GET_STELLAR_RECENT_PAYMENTS', { address, limit: 5 });
      if (!isCurrentBalanceResponse(requestId, latestBalanceRequest.current, accountIndex, selectedIndexRef.current)) {
        return;
      }
      setHorizonPayments(
        res.payments.map((p) => ({
          id: p.id,
          txHash: p.txHash,
          direction: p.direction,
          amountXlm: p.amountXlm,
          createdAt: p.createdAt,
        })),
      );
    } catch (err: unknown) {
      if (!isCurrentBalanceResponse(requestId, latestBalanceRequest.current, accountIndex, selectedIndexRef.current)) {
        return;
      }
      setHorizonPayments([]);
      setHistoryError(err instanceof Error ? err.message : 'Failed to load recent payments');
    } finally {
      if (latestBalanceRequest.current === requestId) {
        setHistoryLoading(false);
      }
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
          setHorizonPayments([]);
          setHistoryLoading(false);
        } else {
          setIsUnfunded(false);
          const num = Number(bal.balance);
          setBalance(isNaN(num) ? bal.balance : num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 }));
          void fetchRecentPayments(address, requestId, accountIndex);
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
        setFundingMessage('Cuenta fondeada con 10,000 XLM de Testnet. Actualizando saldo…');
        if (res.txHash) {
          const transport: TxTransportKind = nymSnapshot.mode === 'nym' ? 'nym' : 'direct';
          void recordTxTransport(res.txHash, transport).then((map) => setTxTransportHistory(map));
          setSessionTxs((prev) => [
            {
              id: res.txHash!,
              txHash: res.txHash!,
              direction: 'received',
              amountXlm: '10000',
              createdAt: new Date().toISOString(),
              transport,
            },
            ...prev.filter((item) => item.txHash !== res.txHash),
          ].slice(0, 5));
        }
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
      setHorizonPayments([]);
      setSessionTxs([]);
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
  const [sppSelected, setSppSelected] = useState(false);
  const [sendKind, setSendKind] = useState<'clear' | 'private'>('clear');
  const [sppPrepareStatus, setSppPrepareStatus] = useState<SppPrepareStatus | null>(null);
  const [sppPoolContract, setSppPoolContract] = useState('');
  const [sppContractConfigJson, setSppContractConfigJson] = useState('');
  const [sppBootnodeUrl, setSppBootnodeUrl] = useState('');
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

  const [nymSnapshot, setNymSnapshot] = useState<NymUiSnapshot>({
    state: 'disconnected',
    lastError: null,
    connected: false,
    implementation: 'mix-fetch-offscreen',
    // Fail closed until NYM_STATUS returns the runtime snapshot. Do not paint Direct.
    mode: 'nym',
    documentReady: false,
    preferenceHydrated: false,
    egressBlocked: true,
    privacyPreference: null,
  });
  const [friendbotGate, setFriendbotGate] = useState<FriendbotModeGate>(FRIENDBOT_MODE_GATE_INITIAL);
  const nymReadyForSpp = nymSnapshot.mode === 'nym' && nymSnapshot.connected;
  const sppStatusSnapshot: SppIntegrationSnapshot = useMemo(
    () =>
      new SppIntegrationStatus(
        createPopupSppIntegrationProbe({
          isFacadePackaged: () => sppFacadePackaged,
          getSession: () => sppSessionHandle,
          isPrivatePaymentsEnabled: () => sppSelected && nymReadyForSpp,
          isNymTransportActive: () => nymReadyForSpp,
        }),
      ).snapshot(),
    [sppFacadePackaged, sppSessionHandle, sppSelected, nymReadyForSpp],
  );

  const mergedRecentTxs = useMemo(
    () => mergeRecentTransactions(horizonPayments, sessionTxs, txTransportHistory, 5),
    [horizonPayments, sessionTxs, txTransportHistory],
  );

  useEffect(() => {
    if (!nymReadyForSpp && (sppSelected || sendKind === 'private')) {
      setSppSelected(false);
      setSendKind('clear');
    }
  }, [nymReadyForSpp, sppSelected, sendKind]);

  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local?.get) return;
    chrome.storage.local.get(
      [
        SPP_PREPARE_STATUS_KEY,
        SPP_POOL_CONTRACT_KEY,
        SPP_CONTRACT_CONFIG_KEY,
        SPP_BOOTNODE_URL_KEY,
      ],
      (res) => {
        const prep = res[SPP_PREPARE_STATUS_KEY] as SppPrepareStatus | undefined;
        if (prep?.phase) setSppPrepareStatus(prep);
        const pool = res[SPP_POOL_CONTRACT_KEY];
        if (typeof pool === 'string') setSppPoolContract(pool);
        else setSppPoolContract(NETHERMIND_PUBLIC_XLM_POOL_CONTRACT);
        const cfg = res[SPP_CONTRACT_CONFIG_KEY];
        if (cfg && typeof cfg === 'object') {
          setSppContractConfigJson(JSON.stringify(cfg, null, 2));
        } else if (typeof cfg === 'string') {
          setSppContractConfigJson(cfg);
        } else {
          const pinned = getNethermindPublicTestnetContractConfig();
          setSppContractConfigJson(JSON.stringify(pinned, null, 2));
          void chrome.storage.local.set({
            [SPP_CONTRACT_CONFIG_KEY]: pinned,
            [SPP_POOL_CONTRACT_KEY]: NETHERMIND_PUBLIC_XLM_POOL_CONTRACT,
          });
        }
        const boot = res[SPP_BOOTNODE_URL_KEY];
        if (typeof boot === 'string') setSppBootnodeUrl(boot);
      },
    );
    const onChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area !== 'local') return;
      if (changes[SPP_PREPARE_STATUS_KEY]?.newValue) {
        setSppPrepareStatus(changes[SPP_PREPARE_STATUS_KEY].newValue as SppPrepareStatus);
      }
      if (typeof changes[SPP_POOL_CONTRACT_KEY]?.newValue === 'string') {
        setSppPoolContract(changes[SPP_POOL_CONTRACT_KEY].newValue as string);
      }
      if (changes[SPP_CONTRACT_CONFIG_KEY]?.newValue) {
        const next = changes[SPP_CONTRACT_CONFIG_KEY].newValue;
        if (typeof next === 'string') setSppContractConfigJson(next);
        else if (next && typeof next === 'object') {
          setSppContractConfigJson(JSON.stringify(next, null, 2));
        }
      }
      if (typeof changes[SPP_BOOTNODE_URL_KEY]?.newValue === 'string') {
        setSppBootnodeUrl(changes[SPP_BOOTNODE_URL_KEY].newValue as string);
      } else if (
        changes[SPP_BOOTNODE_URL_KEY] &&
        changes[SPP_BOOTNODE_URL_KEY].newValue === undefined
      ) {
        setSppBootnodeUrl('');
      }
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);
  const [nymBusy, setNymBusy] = useState(false);
  const [nymHttpSmokeResult, setNymHttpSmokeResult] = useState<NymHttpSmokeUiResult | null>(
    null,
  );
  const [nymPublicDataResult, setNymPublicDataResult] =
    useState<NymPublicDataUiResult | null>(null);
  const [nymStellarHorizonResult, setNymStellarHorizonResult] =
    useState<NymStellarHorizonUiResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    const pull = async () => {
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
    };
    void pull();
    const onChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area !== 'local' || !changes[NYM_PRIVACY_PREFERENCE_STORAGE_KEY]) return;
      void pull();
    };
    if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener(onChanged);
    }
    const unbindStatus = bindNymRuntimeStatus(
      typeof chrome !== 'undefined' ? chrome.runtime?.onMessage : undefined,
      (snapshot) => {
        if (!cancelled) {
          setNymSnapshot(coerceNymUiSnapshot(snapshot));
          setFriendbotGate(
            applyFriendbotModeStatus({
              ok: true,
              mode: snapshot.mode,
              connected: snapshot.connected === true,
              ...(snapshot.preferenceHydrated !== undefined
                ? { preferenceHydrated: snapshot.preferenceHydrated }
                : {}),
            }),
          );
        }
      },
    );
    return () => {
      cancelled = true;
      unbindStatus();
      if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
        chrome.storage.onChanged.removeListener(onChanged);
      }
    };
  }, [view]);

  useEffect(() => {
    if (view !== 'dashboard') return;
    let cancelled = false;
    setFriendbotGate(FRIENDBOT_MODE_GATE_INITIAL);
    void sendIpcMessage('NYM_STATUS', {})
      .then((snap) => {
        if (cancelled) return;
        const gate = applyFriendbotModeStatus({
          ok: true,
          mode: snap.mode,
          connected: snap.connected === true,
          ...(snap.preferenceHydrated !== undefined
            ? { preferenceHydrated: snap.preferenceHydrated }
            : {}),
        });
        setFriendbotGate(gate);
        setNymSnapshot((prev) =>
          prev.mode === gate.mode && prev.connected === gate.nymConnected
            ? prev
            : { ...prev, mode: gate.mode, connected: gate.nymConnected },
        );
      })
      .catch(() => {
        if (!cancelled) setFriendbotGate(applyFriendbotModeStatus({ ok: false }));
      });
    return () => {
      cancelled = true;
    };
  }, [view]);

  const syncGateFromSnapshot = (snap: {
    mode: NymTransportMode;
    connected: boolean;
    preferenceHydrated?: boolean;
  }) => {
    setFriendbotGate(
      applyFriendbotModeStatus({
        ok: true,
        mode: snap.mode,
        connected: snap.connected === true,
        ...(snap.preferenceHydrated !== undefined
          ? { preferenceHydrated: snap.preferenceHydrated }
          : {}),
      }),
    );
  };

  const startGatewayPermissionGesture = (): ReturnType<
    typeof beginGatewayPermissionRequestFromUserGesture
  > | null => {
    const origin = nymSnapshot.selectedGateway || NYM_VERIFIED_GATEWAY.wssOrigin;
    const permissionsApi = typeof chrome !== 'undefined' ? chrome.permissions : undefined;
    if (!permissionsApi || typeof permissionsApi.request !== 'function') return null;
    try {
      return beginGatewayPermissionRequestFromUserGesture(origin);
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
      return null;
    }
  };

  const runNymConnect = async (
    permissionPending: ReturnType<typeof beginGatewayPermissionRequestFromUserGesture> | null,
  ): Promise<void> => {
    setNymSnapshot((prev) => ({
      ...prev,
      state: 'connecting',
      connected: false,
      lastError: null,
    }));
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
      const coerced = coerceNymUiSnapshot(snap);
      setNymSnapshot(coerced);
      syncGateFromSnapshot(coerced);
    } catch (err: unknown) {
      setNymSnapshot((prev) => ({
        ...prev,
        state: 'error',
        connected: false,
        documentReady: false,
        lastError: err instanceof Error ? err.message : 'NYM_CONNECT failed',
      }));
    }
  };

  const handleNymConnect = () => {
    const permissionPending = startGatewayPermissionGesture();
    if (
      typeof chrome !== 'undefined' &&
      typeof chrome.permissions?.request === 'function' &&
      permissionPending === null
    ) {
      return;
    }
    setNymBusy(true);
    void runNymConnect(permissionPending).finally(() => {
      setNymBusy(false);
    });
  };

  const handleNymDisconnect = async () => {
    setNymBusy(true);
    try {
      const snap = await sendIpcMessage('NYM_DISCONNECT', {});
      const coerced = coerceNymUiSnapshot(snap);
      setNymSnapshot(coerced);
      syncGateFromSnapshot(coerced);
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

  const handleNymSetMode = async (mode: NymTransportMode): Promise<void> => {
    const snap = await sendIpcMessage('NYM_SET_MODE', { mode });
    const coerced = coerceNymUiSnapshot(snap);
    setNymSnapshot(coerced);
    syncGateFromSnapshot(coerced);
  };

  const handleOneClickPrivacyMode = (targetMode: NymTransportMode) => {
    // Capture MV3 optional host permission synchronously on the user click stack before awaiting IPC.
    const permissionPending = targetMode === 'nym' ? startGatewayPermissionGesture() : null;
    const isNymActive =
      nymSnapshot.connected ||
      nymSnapshot.state === 'connected' ||
      nymSnapshot.state === 'connecting';

    setNymBusy(true);
    void executeOneClickPrivacyMode(targetMode, {
      isNymActive,
      setMode: handleNymSetMode,
      connect: async () => {
        if (
          typeof chrome !== 'undefined' &&
          typeof chrome.permissions?.request === 'function' &&
          permissionPending === null
        ) {
          return;
        }
        await runNymConnect(permissionPending);
      },
      disconnect: async () => {
        const snap = await sendIpcMessage('NYM_DISCONNECT', {});
        const coerced = coerceNymUiSnapshot(snap);
        setNymSnapshot(coerced);
        syncGateFromSnapshot(coerced);
      },
    })
      .catch((err: unknown) => {
        setNymSnapshot((prev) => ({
          ...prev,
          lastError: err instanceof Error ? err.message : 'Failed to switch privacy mode',
        }));
      })
      .finally(() => {
        setNymBusy(false);
      });
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
    return (
      <div className="view-container">
        <PrivacyModeIndicator snapshot={nymSnapshot} />
        <ReceiveAddressView account={account} onBack={() => setView('dashboard')} />
      </div>
    );
  }

  if (view === 'send' && account) {
    return (
      <>
        <PrivacyModeIndicator snapshot={nymSnapshot} />
        <Send
          onBack={() => setView('dashboard')}
          accountIndex={account.index}
          accountAddress={account.address}
          onComplete={() => {
            setView('dashboard');
          }}
          transportMode={nymSnapshot.mode === 'nym' ? 'nym' : 'direct'}
          onStellarSent={(tx) => {
            setTxTransportHistory((prev) => ({ ...prev, [tx.txHash]: tx.transport }));
            setSessionTxs((prev) => [
              {
                id: tx.txHash,
                txHash: tx.txHash,
                direction: 'sent',
                amountXlm: tx.amountXlm,
                createdAt: tx.createdAt,
                transport: tx.transport,
              },
              ...prev.filter((item) => item.txHash !== tx.txHash),
            ].slice(0, 5));
          }}
          privatePaymentsEnabled={sppSelected && nymReadyForSpp}
          privatePreparePhase={sppPrepareStatus?.phase ?? 'idle'}
          privatePoolContract={sppPoolContract}
          paymentMode={sendKind}
          onPaymentModeChange={(nextMode) => {
            setSendKind(nextMode);
            if (nextMode === 'private' && nymReadyForSpp && !isSppWriteReady(sppPrepareStatus)) {
              void ensureSppAutoPrepareIfNeeded({
                nymConnected: true,
                nymMode: 'nym',
              })
                .then((status) => {
                  if (status) setSppPrepareStatus(status);
                })
                .catch(() => {
                  /* prepare status publisher records failure */
                });
            }
          }}
        />
      </>
    );
  }

  if (view === 'settings') {
    const sppPanel = (
      <SppStatusPanel
        snapshot={sppStatusSnapshot}
        probing={!sppProbeDone}
        sessionGeneration={sppSessionGeneration}
        nymMode={
          nymSnapshot.preferenceHydrated === true &&
          nymSnapshot.mode === 'direct' &&
          nymSnapshot.egressBlocked !== true
            ? 'direct'
            : 'nym'
        }
        nymConnected={nymSnapshot.connected}
        sppSelected={sppSelected}
        prepareStatus={sppPrepareStatus ?? null}
        poolContract={sppPoolContract}
        contractConfigJson={sppContractConfigJson}
        bootnodeUrl={sppBootnodeUrl}
        onToggleSpp={(next) => {
          if (!nymReadyForSpp) return;
          setSppSelected(next);
          if (next) {
            if (!isSppWriteReady(sppPrepareStatus)) {
              void ensureSppAutoPrepareIfNeeded({
                nymConnected: true,
                nymMode: 'nym',
              })
                .then((status) => {
                  if (status) setSppPrepareStatus(status);
                })
                .catch(() => {
                  /* prepare status publisher records failure */
                });
            }
          } else {
            setSendKind('clear');
          }
        }}
        onPoolContractChange={(contract) => {
          setSppPoolContract(contract);
          if (typeof chrome !== 'undefined' && chrome.storage?.local) {
            void chrome.storage.local.set({ [SPP_POOL_CONTRACT_KEY]: contract });
          }
        }}
        onContractConfigJsonChange={(json) => {
          setSppContractConfigJson(json);
          if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
          const trimmed = json.trim();
          if (!trimmed) {
            void chrome.storage.local.remove(SPP_CONTRACT_CONFIG_KEY);
            return;
          }
          try {
            const parsed = parseSppContractConfig(JSON.parse(trimmed) as unknown);
            void chrome.storage.local.set({ [SPP_CONTRACT_CONFIG_KEY]: parsed });
          } catch {
            // Keep textarea text; do not persist invalid JSON as ready config.
          }
        }}
        onBootnodeUrlChange={(url) => {
          setSppBootnodeUrl(url);
          if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
          if (!url) {
            void chrome.storage.local.remove(SPP_BOOTNODE_URL_KEY);
            return;
          }
          void chrome.storage.local.set({ [SPP_BOOTNODE_URL_KEY]: url });
        }}
        onUseNethermindPublic={() => {
          const pinned = getNethermindPublicTestnetContractConfig();
          setSppPoolContract(NETHERMIND_PUBLIC_XLM_POOL_CONTRACT);
          setSppContractConfigJson(JSON.stringify(pinned, null, 2));
          if (typeof chrome !== 'undefined' && chrome.storage?.local) {
            void chrome.storage.local.set({
              [SPP_CONTRACT_CONFIG_KEY]: pinned,
              [SPP_POOL_CONTRACT_KEY]: NETHERMIND_PUBLIC_XLM_POOL_CONTRACT,
            });
          }
        }}
      />
    );

    return (
      <div className="view-container" style={{ overflowY: 'auto' }}>
        <div className="header">
          <button onClick={() => setView('dashboard')} className="btn-icon">&larr; Volver</button>
          <h2>Ajustes</h2>
          <div style={{ width: 52 }}></div>
        </div>

        <NymTransportPanel
          snapshot={nymSnapshot}
          busy={nymBusy}
          onConnect={handleNymConnect}
          onDisconnect={handleNymDisconnect}
          onSetMode={handleOneClickPrivacyMode}
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
          advancedChildren={sppPanel}
        />

        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 10px 0', fontSize: '0.96rem' }}>Apariencia</h3>
          <select 
            value={themePreset} 
            onChange={e => handleThemeChange(e.target.value)}
            className="input-field"
            style={{ width: '100%', marginBottom: themePreset === 'custom' ? 14 : 0 }}
          >
            <option value="astrym">Astrym (Oscuro)</option>
            <option value="midnight">Midnight Green</option>
            <option value="lightmint">Light Mint</option>
            <option value="forest">Forest</option>
            <option value="custom">Colores personalizados</option>
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
          <h3 style={{ margin: '0 0 6px', fontSize: '0.96rem' }}>Bloqueo automático</h3>
          <p className="text-secondary" style={{ margin: '0 0 12px', fontSize: '0.8rem', lineHeight: 1.45 }}>
            Bloquea la wallet tras este tiempo sin actividad para proteger tus fondos.
          </p>
          <label htmlFor="auto-lock-timeout" className="text-secondary" style={{ display: 'block', marginBottom: 6, fontSize: '0.78rem' }}>Tiempo de inactividad</label>
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
            {LOCK_TIMEOUT_OPTIONS_MINUTES.map((minutes) => <option key={minutes} value={minutes}>{minutes} minuto{minutes === 1 ? '' : 's'}</option>)}
          </select>
          {autoLockError && <p role="alert" className="error-text" style={{ margin: '8px 0 0', fontSize: '0.76rem' }}>{autoLockError}</p>}
          {autoLockSaved && <p role="status" className="text-accent" style={{ margin: '8px 0 0', fontSize: '0.76rem' }}>Ajuste guardado.</p>}
        </div>

        <div className="card">
          <h3 style={{ margin: '0 0 8px 0', fontSize: '0.96rem' }}>Copia de seguridad</h3>
          <p className="text-secondary" style={{ margin: '0 0 16px', fontSize: '0.82rem', lineHeight: 1.45 }}>
            Tu frase de recuperación es la única forma de restaurar tu wallet. Nunca la compartas con nadie.
          </p>

          {recoveryPhrase ? (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
                {recoveryPhrase.map((word, i) => (
                  <div key={i} className="phrase-word">
                    <span className="text-secondary" style={{ userSelect: 'none' }}>{i + 1}.</span>
                    <span className="text-accent">{word}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={handleCopyPhrase} className="btn-secondary" style={{ flex: 1 }}>
                  {copySuccess ? 'Copiada \u2713' : 'Copiar'}
                </button>
                <button onClick={() => setRecoveryPhrase(null)} className="btn-outline" style={{ flex: 1 }}>
                  Ocultar
                </button>
              </div>
              {copySuccess && (
                <p className="text-secondary" style={{ fontSize: '0.76rem', marginTop: 10, textAlign: 'center', lineHeight: 1.4 }}>
                  Recuerda vaciar el portapapeles después de guardar tu frase en un lugar seguro.
                </p>
              )}
            </div>
          ) : (
            <form onSubmit={handleRevealMnemonic} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input 
                type="password" 
                placeholder="Introduce tu contraseña"
                value={settingsPassword}
                onChange={e => setSettingsPassword(e.target.value)}
                className="input-field"
              />
              {settingsError && <p className="error-text" style={{ margin: 0, fontSize: '0.8rem' }}>{settingsError}</p>}
              <button type="submit" disabled={settingsLoading || !settingsPassword} className="btn-primary">
                {settingsLoading ? 'Verificando…' : 'Mostrar frase de recuperación'}
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="view-container dashboard">
      <div className="header" style={{ position: 'relative', gap: 8, marginBottom: 14 }}>
        <h2 className="text-accent" style={{ margin: 0, fontSize: '1.15rem', letterSpacing: '0.02em' }}>Astrym</h2>
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
          <button onClick={() => setView('settings')} className="btn-outline" style={{ padding: '6px 9px', fontSize: '0.8rem' }}>Ajustes</button>
          <button onClick={handleLock} className="btn-outline" style={{ padding: '6px 9px', fontSize: '0.8rem' }}>Bloquear</button>
        </div>
      </div>
      
      {accountError && (
        <div className="error-card">
          <span style={{ fontSize: '0.86rem' }}>{accountError}</span>
          <button onClick={loadAccounts} className="btn-error">Reintentar</button>
        </div>
      )}
      
      {loadingAccounts ? (
        <div className="center-content">
          <p className="text-secondary">Cargando cuenta…</p>
        </div>
      ) : account ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <PrivacyModeSelector
            snapshot={nymSnapshot}
            busy={nymBusy}
            onSelectDirect={() => handleOneClickPrivacyMode('direct')}
            onSelectNym={() => handleOneClickPrivacyMode('nym')}
          />

          <div className="card balance-card">
            <div className="balance-indicator" data-status={rpcStatus}></div>
            
            <div className="row-between" style={{ alignItems: 'flex-start', marginBottom: 14 }}>
              <div>
                <h3 style={{ margin: '0 0 4px 0', fontSize: '0.95rem', fontWeight: 600 }}>{account.label}</h3>
                <CopyAddressButton address={account.address} label={account.label} />
              </div>
              <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-sec)', padding: '3px 8px', borderRadius: 999, background: 'var(--bg-color)', border: '1px solid var(--border-color)' }}>
                Stellar Testnet
              </span>
            </div>
            
            <p className="text-secondary" style={{ margin: '0 0 4px 0', fontSize: '0.78rem' }}>Saldo disponible</p>
            <h1 className="balance-amount">
              {balanceLoading ? <span className="text-secondary" style={{ fontSize: '1.8rem' }}>…</span> : balance} 
              <span className="text-secondary" style={{ fontSize: '1.1rem', fontWeight: 500, marginLeft: 8 }}>{currency}</span>
            </h1>

            {isUnfunded && (
              <div style={{ marginTop: 14, padding: '12px', background: 'rgba(60, 232, 148, 0.08)', border: '1px solid rgba(60, 232, 148, 0.25)', borderRadius: 10 }}>
                <p style={{ margin: '0 0 8px 0', fontSize: '0.8rem', lineHeight: 1.4, color: 'var(--text-main)' }}>
                  Esta cuenta aún no tiene saldo en Testnet. Puedes solicitar XLM de prueba gratis.
                </p>
                <FriendbotFundButton
                  mode={friendbotGate.mode}
                  modeKnown={friendbotGate.modeKnown}
                  nymConnected={friendbotGate.nymConnected}
                  fundingLoading={fundingLoading}
                  onFund={() => handleFundTestnet(account.address)}
                />
                {fundingMessage && (
                  <p style={{ margin: '8px 0 0', fontSize: '0.76rem', color: 'var(--accent-color)' }}>{fundingMessage}</p>
                )}
              </div>
            )}

            {balanceError && (
              <div style={{ marginTop: 14, padding: 10, background: 'rgba(255, 107, 107, 0.1)', border: '1px solid rgba(255, 107, 107, 0.3)', borderRadius: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <span className="error-text" style={{ fontSize: '0.8rem' }}>{balanceError}</span>
                <button onClick={() => fetchBalance(account.address, account.index)} disabled={balanceLoading} className="btn-error">Reintentar</button>
              </div>
            )}
          </div>

          <div className="action-grid">
            <button onClick={() => setView('receive')} className="btn-secondary">Recibir</button>
            <button onClick={() => setView('send')} className="btn-primary">Enviar</button>
          </div>

          <RecentActivityCard
            items={mergedRecentTxs}
            loading={historyLoading}
            blockedByNym={nymSnapshot.mode === 'nym' && !nymSnapshot.connected}
            error={historyError}
          />
        </div>
      ) : (
        <div className="center-content">
          <p className="text-secondary">{accounts.length > 0 ? 'Selecciona una cuenta desde el menú superior.' : 'No hay cuentas disponibles. Abre el menú superior para crear una.'}</p>
        </div>
      )}
    </div>
  );
}
