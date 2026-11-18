/**
 * Popup UI for SPP account surface: private balance, notes, registry, recipient lookup.
 * Uses real IPC (SPP_ACCOUNT_*). Never invents readiness or success.
 */

import React, { useEffect, useState } from 'react';
import { StrKey } from '@solanym/wallet-core';
import { maxFeeStroopsForOperation } from '@solanym/wallet-core/src/stellar/spp/sppFeePolicy.js';
import { sppKeyDerivationMessage, sppRegistrationDigest } from '@solanym/wallet-core/src/stellar/spp/sppSignGate.js';
import { getNethermindPublicTestnetContractConfig } from '@solanym/wallet-core/src/stellar/spp/nethermind/nethermindPublicTestnet.js';
import { sendIpcMessage } from './ipc.js';

export type SppAccountPanelProps = {
  preparePhase: string;
  prepareGeneration?: number;
  nymConnected: boolean;
  kdfDomain?: string;
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

function digestHex(message: string): string {
  const digest = sppRegistrationDigest(message);
  let hex = '';
  for (let i = 0; i < digest.length; i += 1) {
    hex += digest[i]!.toString(16).padStart(2, '0');
  }
  return hex;
}

/** Same bytes as sppAccountHandlers.sppDerivationV3RegisterFields. Not key material. */
export function sppDerivationV3RegisterFields(kdfDomain: string): {
  noteKeyHex: string;
  encryptionKeyHex: string;
  noteKeyProofHex: string;
  encryptionKeySignatureHex: string;
  ownerSignatureHex: string;
} {
  const commitment = digestHex(sppKeyDerivationMessage(kdfDomain));
  const signatureSlot = commitment + commitment;
  return {
    noteKeyHex: commitment,
    encryptionKeyHex: commitment,
    noteKeyProofHex: commitment,
    encryptionKeySignatureHex: signatureSlot,
    ownerSignatureHex: signatureSlot,
  };
}

const HELD_REGISTRATION_NOTE = 'Registro retenido: aún no hay firma Registration v1';

function isBroadcastAwaitingApproval(cause: unknown): boolean {
  if (typeof cause !== 'object' || cause === null || !('code' in cause)) return false;
  return (cause as { code: unknown }).code === 'BROADCAST_AWAITING_APPROVAL';
}

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
  prepareGeneration = 0,
  nymConnected,
  kdfDomain = getNethermindPublicTestnetContractConfig().kdf_domain,
  defaultLookupAddress = '',
}: SppAccountPanelProps) {
  const writeReady = preparePhase === 'ready';
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [lookupAddress, setLookupAddress] = useState(defaultLookupAddress);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [registerNote, setRegisterNote] = useState<string | null>(null);
  const [registerState, setRegisterState] = useState<'idle' | 'sign-blocked' | 'failed'>('idle');
  const [confirmRegister, setConfirmRegister] = useState(false);
  const [confirmDerivation, setConfirmDerivation] = useState(false);
  const [derivationNote, setDerivationNote] = useState<string | null>(null);
  const contractConfig = getNethermindPublicTestnetContractConfig();
  const derivationMessage = sppKeyDerivationMessage(kdfDomain);
  const derivationAwaiting = nymConnected && preparePhase === 'initializing_write_pool' && Number.isSafeInteger(prepareGeneration) && prepareGeneration > 0;

  const gateClosed = !nymConnected || !writeReady;

  // A failed/restarted prepare flow must never inherit a previous consent UI state.
  // The one-shot token itself lives in the background signer and is never reused.
  useEffect(() => {
    setConfirmDerivation(false);
    setDerivationNote(null);
    setConfirmRegister(false);
  }, [preparePhase, prepareGeneration, kdfDomain, nymConnected]);

  const registerFlowState = busy === 'register' ? 'busy' : registerState;

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

  const approveDerivation = () => {
    setError(null);
    setDerivationNote(null);
    if (!confirmDerivation) {
      setConfirmDerivation(true);
      return;
    }
    setBusy('derive');
    void sendIpcMessage('SPP_AUTHORIZE_KEY_DERIVATION', {
      acknowledgeHighRisk: true,
      kdfDomain,
      prepareGeneration,
    })
      .then(() => {
        setDerivationNote(
          'Consentimiento de un solo uso entregado al host. La firma solo deriva las claves privadas SPP; no activa broadcasts.',
        );
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'No se pudo autorizar la derivación SPP');
      })
      .finally(() => {
        setBusy(null);
        setConfirmDerivation(false);
      });
  };

  const registerKeys = () => {
    setError(null);
    setRegisterNote(null);
    setRegisterState('idle');
    if (!confirmRegister) {
      setConfirmRegister(true);
      return;
    }
    setBusy('register');
    const derived = sppDerivationV3RegisterFields(contractConfig.kdf_domain);
    void sendIpcMessage('SPP_REGISTER_PUBLIC_KEYS', {
      acknowledgeBroadcast: true,
      ...derived,
    })
      .catch((cause: unknown) => {
        if (isBroadcastAwaitingApproval(cause)) {
          setError(null);
          setRegisterState('sign-blocked');
          setRegisterNote(HELD_REGISTRATION_NOTE);
          return;
        }
        setRegisterNote(null);
        setRegisterState('failed');
        setError(cause instanceof Error ? cause.message : 'Registro de claves falló');
      })
      .finally(() => {
        setBusy(null);
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
      {derivationAwaiting ? (
        <div
          className="card"
          data-testid="spp-kdf-approval"
          style={{ display: 'grid', gap: 8, padding: 12 }}
        >
          <strong>Preparación: falta consentimiento para derivar las claves privadas</strong>
          <p className="text-secondary" style={{ margin: 0, fontSize: '0.75rem' }}>
            El host está esperando esta autorización. Se firmará únicamente el mensaje SEP-53
            v3 de abajo, para derivar y guardar las claves note/encryption de SPP. No se transmite
            una transacción ni se habilitan pagos.
          </p>
          {confirmDerivation ? (
            <div
              data-testid="spp-kdf-review"
              style={{ display: 'grid', gap: 6, fontSize: '0.76rem' }}
            >
              <strong>Revisa el mensaje exacto que se firmará:</strong>
              <pre
                className="address-wrap"
                data-testid="spp-kdf-message"
                style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', margin: 0 }}
              >
                {derivationMessage}
              </pre>
              <strong style={{ color: 'var(--danger, #c44)' }}>
                Aviso del SDK: firmarlo da control total de los fondos privados derivados.
                Nunca firmes este mensaje fuera de Astrym / la app oficial SPP.
              </strong>
              <span className="text-secondary">
                Permiso único, limitado a la cuenta activa, este dominio KDF y este texto exacto.
                Expira en 2 minutos. No autoriza deposit, transfer, withdraw ni register.
              </span>
            </div>
          ) : null}
          <button
            type="button"
            className="btn-secondary"
            data-testid="spp-kdf-approve"
            disabled={busy !== null || derivationNote !== null}
            onClick={approveDerivation}
          >
            {busy === 'derive'
              ? 'Autorizando…'
              : confirmDerivation
                ? 'Confirmar firma KDF única'
                : 'Revisar y autorizar derivación'}
          </button>
          {derivationNote ? (
            <p role="status" className="text-secondary" style={{ margin: 0, fontSize: '0.75rem' }}>
              {derivationNote}
            </p>
          ) : null}
        </div>
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
          Preparar registro (retenido)
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
            Mensaje Derivation v3: {sppKeyDerivationMessage(contractConfig.kdf_domain)}
          </span>
          <span>
            maxFee techo: {maxFeeStroopsForOperation('register_public_keys')} stroops
          </span>
          <span className="text-secondary" data-testid="spp-register-derived">
            La solicitud usa el mensaje Derivation v3. Esta pantalla no pide pegar note_key, encryption_key ni firmas.
          </span>
          <span className="text-secondary">
            El mensaje v3 crea una clave nueva. Una firma v2 no se reutiliza ni se migra.
          </span>
          <button
            type="button"
            className="btn-secondary"
            data-testid="spp-register-cancel"
            disabled={busy !== null}
            onClick={() => {
              setConfirmRegister(false);
              setRegisterNote(null);
              setRegisterState('idle');
              setError(null);
            }}
          >
            Cancelar
          </button>
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

      <p
        className="text-secondary"
        style={{ margin: 0, fontSize: '0.75rem' }}
        role="status"
        aria-live="polite"
        data-testid="spp-register-note"
        data-spp-register-state={registerFlowState}
      >
        {registerNote}
      </p>
      {error ? (
        <p className="error-text" role="alert" data-testid="spp-account-error">
          {error}
        </p>
      ) : null}
    </section>
  );
}
