/**
 * Popup UI for SPP account surface: private balance, notes, registry, recipient lookup.
 * Uses real IPC (SPP_ACCOUNT_*). Never invents readiness or success.
 */

import React, { useState } from 'react';
import { StrKey } from '@solanym/wallet-core';
import { sendIpcMessage } from './ipc.js';

export type SppAccountPanelProps = {
  preparePhase: string;
  nymConnected: boolean;
  defaultLookupAddress?: string;
};

type Snapshot = {
  userAddress: string;
  poolContract: string;
  registered: boolean | null;
  privateBalanceStroops: string | null;
  noteCount: number | null;
};

type Lookup = {
  address: string;
  found: boolean;
  registryFullySynced: boolean | null;
  networkTipLedger: number | null;
  noteKeyPresent: boolean;
  encryptionKeyPresent: boolean;
};

function stroopsToXlm(stroops: string | null): string {
  if (!stroops) return '—';
  try {
    const n = BigInt(stroops);
    const whole = n / 10_000_000n;
    const frac = (n % 10_000_000n).toString().padStart(7, '0');
    return `${whole.toString()}.${frac} XLM`;
  } catch {
    return stroops;
  }
}

export function SppAccountPanel({
  preparePhase,
  nymConnected,
  defaultLookupAddress = '',
}: SppAccountPanelProps) {
  const writeReady = preparePhase === 'ready';
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [lookupAddress, setLookupAddress] = useState(defaultLookupAddress);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [registerNote, setRegisterNote] = useState<string | null>(null);

  const gateClosed = !nymConnected || !writeReady;

  const refresh = () => {
    setError(null);
    setBusy('snapshot');
    void sendIpcMessage('SPP_ACCOUNT_SNAPSHOT', {})
      .then((result) => {
        setSnapshot(result);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'No se pudo leer el snapshot SPP');
      })
      .finally(() => setBusy(null));
  };

  const sync = () => {
    setError(null);
    setBusy('sync');
    void sendIpcMessage('SPP_ACCOUNT_SYNC', {})
      .then((result) => {
        if (result.snapshot) setSnapshot(result.snapshot);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'Sync SPP falló');
      })
      .finally(() => setBusy(null));
  };

  const doLookup = () => {
    setError(null);
    setLookup(null);
    const address = lookupAddress.trim();
    if (!StrKey.isValidEd25519PublicKey(address)) {
      setError('Introduce un destinatario G… válido');
      return;
    }
    setBusy('lookup');
    void sendIpcMessage('SPP_RECIPIENT_LOOKUP', { address })
      .then((result) => setLookup(result))
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'Lookup de destinatario falló');
      })
      .finally(() => setBusy(null));
  };

  const registerKeys = () => {
    setError(null);
    setRegisterNote(null);
    // Registration requires an approved packet (sequence + tx fingerprint + registry).
    // Without those fields the IPC schema refuses — do not invent placeholders.
    setBusy('register');
    setError(
      'Registro retenido: falta paquete de aprobación (freshSequence + transactionFingerprint + registryContract). El gate global de mutators permanece OFF.',
    );
    setRegisterNote(
      'register_public_keys usa autorización scoped (solo registro). Deposit/transfer/withdraw no quedan autorizados.',
    );
    setBusy(null);
  };

  return (
    <section
      className="card"
      style={{ display: 'grid', gap: 10, marginTop: 12 }}
      data-testid="spp-account-panel"
      data-spp-account-ready={writeReady ? 'yes' : 'no'}
    >
      <h4 style={{ margin: 0, fontSize: '0.9rem' }}>Cuenta privada SPP</h4>
      <p className="text-secondary" style={{ margin: 0, fontSize: '0.75rem' }}>
        Saldo privado, notas y discovery de destinatarios vía IPC real al host (Nym). No inventa éxito.
      </p>
      {gateClosed ? (
        <p className="text-secondary" style={{ margin: 0, fontSize: '0.75rem' }} data-testid="spp-account-gate">
          Requiere Nym conectado y prepare.phase = ready (write_pool_ready).
        </p>
      ) : null}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button
          type="button"
          className="btn-secondary"
          data-testid="spp-account-refresh"
          disabled={gateClosed || busy !== null}
          onClick={refresh}
        >
          {busy === 'snapshot' ? 'Leyendo…' : 'Saldo / notas'}
        </button>
        <button
          type="button"
          className="btn-secondary"
          data-testid="spp-account-sync"
          disabled={gateClosed || busy !== null}
          onClick={sync}
        >
          {busy === 'sync' ? 'Sync…' : 'Sync índice'}
        </button>
        <button
          type="button"
          className="btn-secondary"
          data-testid="spp-account-register"
          disabled={gateClosed || busy !== null}
          onClick={registerKeys}
        >
          {busy === 'register' ? 'Registrando…' : 'Registrar claves (gated)'}
        </button>
      </div>

      {snapshot ? (
        <div
          data-testid="spp-account-snapshot"
          style={{ fontSize: '0.78rem', display: 'grid', gap: 4 }}
        >
          <span className="address-wrap">Cuenta: {snapshot.userAddress}</span>
          <span className="address-wrap">Pool: {snapshot.poolContract}</span>
          <span data-testid="spp-account-registered">
            Registrada: {snapshot.registered === null ? 'desconocido' : snapshot.registered ? 'sí' : 'no'}
          </span>
          <span data-testid="spp-account-balance">
            Saldo privado: {stroopsToXlm(snapshot.privateBalanceStroops)}
          </span>
          <span data-testid="spp-account-notes">
            Notas: {snapshot.noteCount === null ? '—' : snapshot.noteCount}
          </span>
        </div>
      ) : null}

      <label style={{ fontSize: '0.8rem' }}>
        Lookup destinatario G…
        <input
          className="input-field address-wrap"
          style={{ width: '100%', marginTop: 4 }}
          value={lookupAddress}
          disabled={gateClosed || busy !== null}
          data-testid="spp-lookup-address"
          onChange={(event) => setLookupAddress(event.target.value)}
        />
      </label>
      <button
        type="button"
        className="btn-primary"
        data-testid="spp-lookup-submit"
        disabled={gateClosed || busy !== null}
        onClick={doLookup}
      >
        {busy === 'lookup' ? 'Buscando…' : 'Buscar en registry'}
      </button>

      {lookup ? (
        <div
          data-testid="spp-lookup-result"
          data-found={lookup.found ? 'yes' : 'no'}
          style={{ fontSize: '0.78rem', display: 'grid', gap: 4 }}
        >
          <span>{lookup.found ? 'Destinatario encontrado en registry' : 'No encontrado en registry'}</span>
          <span>Sync completo: {lookup.registryFullySynced === null ? '—' : String(lookup.registryFullySynced)}</span>
          <span>Ledger tip: {lookup.networkTipLedger ?? '—'}</span>
          <span>noteKey: {lookup.noteKeyPresent ? 'sí' : 'no'} · encKey: {lookup.encryptionKeyPresent ? 'sí' : 'no'}</span>
        </div>
      ) : null}

      {registerNote ? (
        <p className="text-secondary" style={{ margin: 0, fontSize: '0.75rem' }} data-testid="spp-register-note">
          {registerNote}
        </p>
      ) : null}
      {error ? (
        <p className="error-text" role="alert" data-testid="spp-account-error">
          {error}
        </p>
      ) : null}
    </section>
  );
}
