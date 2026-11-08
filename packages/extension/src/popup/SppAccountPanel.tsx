/**
 * Popup UI for SPP account surface: private balance, notes, registry, recipient lookup.
 * Uses real IPC (SPP_ACCOUNT_*). Never invents readiness or success.
 */

import React, { useState } from 'react';
import { StrKey } from '@solanym/wallet-core';
import { maxFeeStroopsForOperation } from '@solanym/wallet-core/src/stellar/spp/sppFeePolicy.js';
import { sppKeyDerivationMessage } from '@solanym/wallet-core/src/stellar/spp/sppSignGate.js';
import { getNethermindPublicTestnetContractConfig } from '@solanym/wallet-core/src/stellar/spp/nethermind/nethermindPublicTestnet.js';
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
  const [confirmRegister, setConfirmRegister] = useState(false);
  const [noteKeyHex, setNoteKeyHex] = useState('');
  const [encryptionKeyHex, setEncryptionKeyHex] = useState('');
  const [noteKeyProofHex, setNoteKeyProofHex] = useState('');
  const contractConfig = getNethermindPublicTestnetContractConfig();
  const derivationMessage = sppKeyDerivationMessage(contractConfig.kdf_domain);

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
    if (!confirmRegister) {
      setConfirmRegister(true);
      return;
    }
    if (!/^[0-9a-fA-F]{64}$/.test(noteKeyHex) || !/^[0-9a-fA-F]{64}$/.test(encryptionKeyHex)) {
      setError('note_key y encryption_key deben ser 32 bytes en hex.');
      return;
    }
    if (noteKeyProofHex.trim().length > 0 && !/^(?:[0-9a-fA-F]{2})+$/.test(noteKeyProofHex.trim())) {
      setError('note_key_proof debe ser hex de longitud par.');
      return;
    }
    setBusy('register');
    const proof = noteKeyProofHex.trim();
    void sendIpcMessage('SPP_REGISTER_PUBLIC_KEYS', {
      acknowledgeBroadcast: true,
      noteKeyHex,
      encryptionKeyHex,
      ...(proof.length > 0 ? { noteKeyProofHex: proof } : {}),
    })
      .then((result) => {
        setRegisterNote(
          result.txHash
            ? `Registro on-chain ok — tx ${result.txHash}`
            : 'Registro devolvió confirmación ambigua (sin hash).',
        );
        refresh();
      })
      .catch((cause: unknown) => {
        const message = cause instanceof Error ? cause.message : 'Registro de claves falló';
        setError(message);
        if (message.includes('SPP_BROADCAST_AWAITING_APPROVAL')) {
          setRegisterNote(
            'Registro preparado y retenido: broadcast bloqueado hasta aprobación explícita.',
          );
        }
      })
      .finally(() => {
        setBusy(null);
        setConfirmRegister(false);
      });
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
          data-confirm={confirmRegister ? 'yes' : 'no'}
          disabled={gateClosed || busy !== null}
          onClick={registerKeys}
        >
          {busy === 'register'
            ? 'Registrando…'
            : confirmRegister
              ? 'Confirmar registro (Testnet)'
              : 'Registrar claves (gated)'}
        </button>
      </div>
      {confirmRegister ? (
        <div data-testid="spp-register-review" style={{ fontSize: '0.78rem', display: 'grid', gap: 4 }}>
          <strong>Confirmar registro de claves (Testnet)</strong>
          <span>Operación: register_public_keys</span>
          <span>Red: Stellar Testnet</span>
          <span className="address-wrap">
            Registry: {contractConfig.public_key_registry}
          </span>
          <span>Propietario: la cuenta activa</span>
          <span className="address-wrap" data-testid="spp-register-message">
            Mensaje SEP-53: {derivationMessage}
          </span>
          <span>
            maxFee techo: {maxFeeStroopsForOperation('register_public_keys')} stroops
          </span>
          <label>
            note_key (hex)
            <input
              className="input-field"
              data-testid="spp-register-note-key"
              value={noteKeyHex}
              onChange={(event) => setNoteKeyHex(event.target.value.trim())}
            />
          </label>
          <label>
            encryption_key (hex)
            <input
              className="input-field"
              data-testid="spp-register-encryption-key"
              value={encryptionKeyHex}
              onChange={(event) => setEncryptionKeyHex(event.target.value.trim())}
            />
          </label>
          <label>
            note_key_proof (hex, vacío si el SDK no lo envía)
            <input
              className="input-field"
              data-testid="spp-register-note-key-proof"
              value={noteKeyProofHex}
              onChange={(event) => setNoteKeyProofHex(event.target.value.trim())}
            />
          </label>
          <span className="text-secondary">
            El segundo clic envía el acuse y esas claves. Otra clave o otro mensaje no se firma.
          </span>
        </div>
      ) : null}

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
