/**
 * SPP status for settings. Private payments can be selected only while Nym is connected.
 */

import React from 'react';
import type { SppIntegrationSnapshot } from '@solanym/wallet-core/src/stellar/spp/SppIntegrationStatus.js';
import { describeSppIntegrationAvailability } from '@solanym/wallet-core/src/stellar/spp/SppIntegrationStatus.js';

export type SppStatusPanelProps = {
  snapshot: SppIntegrationSnapshot;
  probing?: boolean;
  sessionGeneration?: number;
  nymMode?: 'direct' | 'nym';
  nymConnected?: boolean;
  sppSelected?: boolean;
  onToggleSpp?: (next: boolean) => void;
  onOpenHost?: () => void;
};

export function SppStatusPanel({
  snapshot,
  probing = false,
  sessionGeneration = 0,
  nymMode = 'direct',
  nymConnected = false,
  sppSelected = false,
  onToggleSpp,
  onOpenHost,
}: SppStatusPanelProps) {
  const title = probing
    ? 'Comprobando assets SPP…'
    : describeSppIntegrationAvailability(snapshot.availability);
  const showPaymentsOff = !snapshot.capabilities.private_payments;
  const showRoOff = !snapshot.capabilities.read_only_session;
  const nymReady = nymMode === 'nym' && nymConnected;

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
      </ul>
      <p
        style={{ margin: '10px 0 0', fontSize: '0.72rem', color: 'var(--muted, #888)' }}
        data-spp-nym-gate={nymReady ? 'open' : 'closed'}
      >
        {nymReady
          ? 'Nym está conectado. Puedes activar Stellar Private Payments. El RPC de Soroban sale por MixFetch y no cae a clearnet.'
          : 'Stellar Private Payments requiere Nym conectado. En modo direct la opción queda cerrada.'}
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
      {nymReady && sppSelected ? (
        <button type="button" className="btn-secondary" style={{ marginTop: 8 }} onClick={onOpenHost} data-testid="spp-open-host">
          Preparar sesión SPP
        </button>
      ) : (
        <p style={{ margin: '8px 0 0', fontSize: '0.72rem', color: 'var(--muted, #888)' }}>
          Sin acciones de pago. La sesión solo aparece si el host la publica; no se inventa un estado listo.
        </p>
      )}
    </div>
  );
}
