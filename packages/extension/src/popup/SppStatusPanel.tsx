/**
 * SPP status for settings. Private payments require Nym; host opens internally.
 */

import React, { useState } from 'react';
import type { SppIntegrationSnapshot } from '@solanym/wallet-core/src/stellar/spp/SppIntegrationStatus.js';
import { describeSppIntegrationAvailability } from '@solanym/wallet-core/src/stellar/spp/SppIntegrationStatus.js';
import {
  describeSppPreparePhase,
  type SppPrepareStatus,
} from '../shared/sppPrepareStatus.js';

export type SppStatusPanelProps = {
  snapshot: SppIntegrationSnapshot;
  probing?: boolean;
  sessionGeneration?: number;
  nymMode?: 'direct' | 'nym';
  nymConnected?: boolean;
  sppSelected?: boolean;
  prepareStatus?: SppPrepareStatus | null;
  poolContract?: string;
  onToggleSpp?: (next: boolean) => void;
  onPoolContractChange?: (contract: string) => void;
};

export function SppStatusPanel({
  snapshot,
  probing = false,
  sessionGeneration = 0,
  nymMode = 'direct',
  nymConnected = false,
  sppSelected = false,
  prepareStatus = null,
  poolContract = '',
  onToggleSpp,
  onPoolContractChange,
}: SppStatusPanelProps) {
  const title = probing
    ? 'Comprobando assets SPP…'
    : describeSppIntegrationAvailability(snapshot.availability);
  const showPaymentsOff = !snapshot.capabilities.private_payments;
  const showRoOff = !snapshot.capabilities.read_only_session;
  const nymReady = nymMode === 'nym' && nymConnected;
  const [localPool, setLocalPool] = useState(poolContract);

  return (
    <div
      className="card"
      style={{ marginBottom: 20 }}
      data-testid="spp-status-panel"
      data-spp-generation={sessionGeneration}
    >
      <h3 style={{ marginTop: 0, fontSize: '0.95rem' }}>Stellar Private Payments</h3>
      <p
        style={{ margin: '0 0 8px', fontSize: '0.85rem' }}
        data-spp-availability={probing ? 'probing' : snapshot.availability}
        data-spp-session={snapshot.sessionState ?? 'none'}
      >
        {title}
      </p>
      {snapshot.error && !probing ? (
        <p style={{ margin: '0 0 8px', fontSize: '0.8rem', color: 'var(--danger, #c44)' }} data-spp-error={snapshot.error.code}>
          {snapshot.error.message}
        </p>
      ) : null}
      <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.78rem', color: 'var(--muted, #888)' }}>
        <li data-spp-cap="facade">{snapshot.facadePackaged ? 'Fachada empaquetada' : 'Fachada no empaquetada'}</li>
        <li data-spp-cap="session" data-spp-session-state={snapshot.sessionState ?? 'none'}>
          Sesión: {snapshot.sessionState ?? 'ninguna'}
          {snapshot.sessionState === 'uninitialized' ? ' (construida, no inicializada)' : ''}
        </li>
        <li data-spp-cap="read_only_session">
          Sesión solo lectura: {showRoOff ? 'no activa' : 'activa'}
        </li>
        <li data-spp-cap="private_payments">
          Pagos privados: {showPaymentsOff ? 'no disponibles' : 'disponibles'}
        </li>
        <li data-testid="spp-prepare-phase" data-spp-prepare={prepareStatus?.phase ?? 'idle'}>
          Preparación: {describeSppPreparePhase(prepareStatus?.phase ?? 'idle')}
          {prepareStatus?.message ? ` — ${prepareStatus.message}` : ''}
        </li>
      </ul>
      <p
        style={{ margin: '10px 0 0', fontSize: '0.72rem', color: 'var(--muted, #888)' }}
        data-spp-nym-gate={nymReady ? 'open' : 'closed'}
      >
        {nymReady
          ? 'Nym conectado. SPP se prepara en segundo plano (host interno). El RPC Soroban no cae a clearnet.'
          : 'Horizon funciona sin Nym. Los pagos privados SPP requieren conectar Nym.'}
      </p>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, fontSize: '0.85rem' }}>
        <input
          type="checkbox"
          data-testid="spp-option-toggle"
          checked={nymReady && sppSelected}
          disabled={!nymReady || !onToggleSpp}
          onChange={(event) => onToggleSpp?.(event.target.checked)}
        />
        Usar pagos privados con Nym
      </label>
      {nymReady ? (
        <label style={{ display: 'grid', gap: 4, marginTop: 10, fontSize: '0.8rem' }}>
          Contrato del pool (C…)
          <input
            className="input-field"
            data-testid="spp-pool-contract"
            style={{ width: '100%' }}
            value={localPool}
            placeholder="C…"
            onChange={(event) => {
              setLocalPool(event.target.value);
              onPoolContractChange?.(event.target.value.trim());
            }}
          />
          <span className="text-secondary" style={{ fontSize: '0.7rem' }}>
            Se guarda en la wallet. Sin C… válido la preparación se detiene en «awaiting_pool_config».
          </span>
        </label>
      ) : null}
    </div>
  );
}
