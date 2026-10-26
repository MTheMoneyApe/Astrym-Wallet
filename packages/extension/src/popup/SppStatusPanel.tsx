/**
 * Fase 5F — presentational SPP integration status for popup settings.
 * Receives a precomputed snapshot; never imports or initializes the SPP SDK.
 */

import React from 'react';
import type { SppIntegrationSnapshot } from '@solanym/wallet-core/src/stellar/spp/SppIntegrationStatus.js';
import { describeSppIntegrationAvailability } from '@solanym/wallet-core/src/stellar/spp/SppIntegrationStatus.js';

export type SppStatusPanelProps = {
  snapshot: SppIntegrationSnapshot;
  /** True while the popup is still probing packaged assets. */
  probing?: boolean;
  /** Latest applied host publish generation (0 = none). */
  sessionGeneration?: number;
};

export function SppStatusPanel({
  snapshot,
  probing = false,
  sessionGeneration = 0,
}: SppStatusPanelProps) {
  const title = probing
    ? 'Comprobando assets SPP…'
    : describeSppIntegrationAvailability(snapshot.availability);
  const showPaymentsOff = !snapshot.capabilities.private_payments;
  const showRoOff = !snapshot.capabilities.read_only_session;

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
          {snapshot.sessionState === 'uninitialized'
            ? ' (construida, no inicializada)'
            : ''}
        </li>
        <li data-spp-cap="read_only_session">
          Sesión solo lectura: {showRoOff ? 'no activa' : 'activa'}
        </li>
        <li data-spp-cap="private_payments">
          Pagos privados: {showPaymentsOff ? 'no disponibles' : 'disponibles'}
        </li>
      </ul>
      <p style={{ margin: '10px 0 0', fontSize: '0.72rem', color: 'var(--muted, #888)' }}>
        Sin acciones de pago. La sesión solo aparece si el host la publica; no se inventa un estado listo.
      </p>
    </div>
  );
}
