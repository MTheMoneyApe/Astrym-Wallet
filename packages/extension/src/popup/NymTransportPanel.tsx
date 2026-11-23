/**
 * Nym mixnet status — reflects host-reported snapshot only.
 * Never claims Ready from document open or permission grant alone.
 */

import React, { useState } from 'react';
import type { NymTransportSnapshot } from '@solanym/wallet-core/src/nym/NymTransport.js';
import type { NymTransportMode } from '@solanym/wallet-core/src/nym/NymTransportPolicy.js';
import { NYM_VERIFIED_GATEWAY } from '../nym-offscreen/verifiedGateway.js';
import { NYM_HTTP_SMOKE_DEFAULT_URL } from '../nym-offscreen/httpSmokeConfig.js';
import { NYM_PUBLIC_DATA_DEFAULT_URL } from '../nym-offscreen/publicDataConfig.js';
import { PrivacyModeIndicator, describeWalletPrivacy } from './privacyIndicator.js';

export type NymHttpSmokeUiResult = {
  state: 'idle' | 'running' | 'success' | 'error' | 'timeout';
  url: string;
  probeId: string;
  durationMs: number;
  httpStatus: number | null;
  httpOk: boolean | null;
  probeMatched: boolean;
  echoedProbeId: string | null;
  message: string;
  mixFetchInvoked: boolean;
};

export type NymPublicDataUiResult = {
  state: 'idle' | 'running' | 'success' | 'error' | 'timeout';
  transport: NymTransportMode;
  url: string;
  probeId: string;
  durationMs: number;
  httpStatus: number | null;
  httpOk: boolean | null;
  probeMatched: boolean;
  echoedProbeId: string | null;
  responsePreview: string | null;
  message: string;
  transportFetchInvoked: boolean;
};

export type NymStellarHorizonUiResult = {
  state: 'idle' | 'running' | 'success' | 'error' | 'timeout';
  transport: NymTransportMode;
  url: string;
  logicalUrl: string;
  effectiveUrl: string;
  urlRewritten: boolean;
  rewriteReason: string | null;
  durationMs: number;
  httpStatus: number | null;
  httpOk: boolean | null;
  contentType: string | null;
  horizonVersion: string | null;
  networkPassphrase: string | null;
  lastLedger: string | null;
  lastLedgerBaseFee: string | null;
  horizonErrorDetail: string | null;
  responsePreview: string | null;
  message: string;
  transportFetchInvoked: boolean;
};

export type NymUiSnapshot = NymTransportSnapshot & {
  mode?: NymTransportMode;
  preferenceHydrated?: boolean;
  egressBlocked?: boolean;
  privacyPreference?: 'direct' | 'nym' | null;
  preferenceDurable?: boolean;
  documentReady?: boolean;
  diagnosticCode?: string;
  diagnosticStage?: string | null;
  assetsReady?: boolean;
  gatewayAllowlistConfigured?: boolean;
  selectedGateway?: string | null;
  gatewayIdentityKey?: string | null;
  gatewayHostPermissionGranted?: boolean | null;
  gatewayHostPermissionPattern?: string | null;
};

export type NymTransportPanelProps = {
  snapshot: NymUiSnapshot;
  busy?: boolean;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onSetMode?: (mode: NymTransportMode) => void;
  onConfigureGateway?: (origin: string, identityKey?: string) => void;
  onRequestGatewayPermission?: () => void;
  onLiveSmokeDryRun?: () => void;
  /** Authorized live smoke only (confirmLiveSmoke=true). Hidden unless provided. */
  onLiveSmokeExecute?: () => void;
  liveSmokeAuthorized?: boolean;
  /** MixFetch HTTP round-trip (requires MixFetch Ready). */
  onHttpSmoke?: (url?: string) => void;
  httpSmokeResult?: NymHttpSmokeUiResult | null;
  /** Public GET via FailClosedTransportRouter (nym or explicit direct). */
  onPublicDataFetch?: (transport: NymTransportMode) => void;
  publicDataResult?: NymPublicDataUiResult | null;
  onStellarHorizonProbe?: (transport: NymTransportMode) => void;
  stellarHorizonResult?: NymStellarHorizonUiResult | null;
  /** Optional extra advanced sections (e.g. SPP) nested inside the collapsible disclosure. */
  advancedChildren?: React.ReactNode;
};

function describeState(snapshot: NymUiSnapshot): string {
  switch (snapshot.state) {
    case 'connected':
      return snapshot.connected ? 'Ready (Mixnet)' : 'Mixnet desconectado';
    case 'connecting':
      return 'Conectando a la red privada Nym…';
    case 'error':
      return 'Error de conexión';
    case 'closed':
      return 'Desconectado';
    case 'disconnected':
    default:
      return 'Desconectado';
  }
}

export function NymTransportPanel({
  snapshot,
  busy = false,
  onConnect,
  onDisconnect,
  onSetMode,
  onConfigureGateway,
  onRequestGatewayPermission,
  onLiveSmokeDryRun,
  onLiveSmokeExecute,
  liveSmokeAuthorized = false,
  onHttpSmoke,
  httpSmokeResult = null,
  onPublicDataFetch,
  publicDataResult = null,
  onStellarHorizonProbe,
  stellarHorizonResult = null,
  advancedChildren,
}: NymTransportPanelProps) {
  const mode = snapshot.mode ?? 'nym';
  const ready = snapshot.connected && snapshot.state === 'connected';
  const [gatewayInput, setGatewayInput] = useState('');
  const [identityInput, setIdentityInput] = useState('');
  const [httpSmokeUrl, setHttpSmokeUrl] = useState('');
  const publicDataBusy = publicDataResult?.state === 'running';
  const stellarProbeBusy = stellarHorizonResult?.state === 'running';

  return (
    <div style={{ display: 'grid', gap: 12, marginBottom: 16 }}>
      <div className="card" data-testid="nym-transport-panel" style={{ display: 'grid', gap: 12 }}>
        <div className="row-between">
          <h3 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 600 }}>Privacidad y red (Nym)</h3>
          <span
            style={{
              fontSize: '0.78rem',
              fontWeight: 600,
              color: ready ? 'var(--accent-color)' : 'var(--text-sec)',
            }}
            data-nym-state={snapshot.state}
            data-nym-connected={snapshot.connected ? 'true' : 'false'}
            data-nym-impl={snapshot.implementation}
            data-nym-mode={mode}
            data-nym-document-ready={snapshot.documentReady ? 'true' : 'false'}
          >
            {describeState(snapshot)}
          </span>
        </div>

        <PrivacyModeIndicator snapshot={snapshot} />

        <p style={{ margin: 0, fontSize: '0.82rem', lineHeight: 1.45, color: 'var(--text-sec)' }}>
          En <strong>Modo Normal</strong> la wallet se conecta directamente a Stellar. En{' '}
          <strong>Modo Privado (Nym)</strong> tu tráfico pasa por la mixnet de Nym para ocultar tu IP.
        </p>

        <p
          style={{
            margin: 0,
            padding: '10px 12px',
            borderRadius: 10,
            background: 'var(--bg-color)',
            border: '1px solid var(--border-color)',
            fontSize: '0.78rem',
            lineHeight: 1.45,
            color: 'var(--text-sec)',
          }}
        >
          <strong style={{ color: 'var(--text-main)' }}>Bloqueo automático de protección:</strong>{' '}
          si activas el Modo Privado y Nym se desconecta, la wallet detiene el tráfico automáticamente
          para evitar fugas a internet normal. Para volver al modo normal, selecciona{' '}
          <strong>Modo Normal</strong> explícitamente.
        </p>

        {snapshot.lastError ? (
          <p
            role="alert"
            className="error-text"
            style={{
              margin: 0,
              padding: '8px 10px',
              borderRadius: 8,
              background: 'rgba(255, 107, 107, 0.1)',
              border: '1px solid rgba(255, 107, 107, 0.35)',
              fontSize: '0.78rem',
              lineHeight: 1.4,
            }}
          >
            {snapshot.lastError}
          </p>
        ) : null}

        {onSetMode ? (
          <div className="privacy-switcher" role="group" aria-label="Modo de privacidad">
            <button
              type="button"
              className="privacy-switcher__btn"
              aria-pressed={mode === 'direct' && snapshot.egressBlocked !== true}
              disabled={busy || (mode === 'direct' && snapshot.egressBlocked !== true && !ready)}
              onClick={() => onSetMode('direct')}
              data-testid="nym-mode-direct"
              title="Cambio explícito a conexión directa. Desconectar Nym no activa este modo."
            >
              <span
                className={`privacy-dot ${mode === 'direct' && snapshot.egressBlocked !== true ? 'privacy-dot--direct' : ''}`}
                aria-hidden="true"
              />
              Modo Normal
            </button>
            <button
              type="button"
              className="privacy-switcher__btn"
              aria-pressed={mode === 'nym'}
              disabled={busy || (mode === 'nym' && ready)}
              onClick={() => onSetMode('nym')}
              data-testid="nym-mode-nym"
            >
              <span
                className={`privacy-dot ${mode === 'nym' ? (ready ? 'privacy-dot--nym' : 'privacy-dot--blocked') : ''}`}
                aria-hidden="true"
              />
              {snapshot.state === 'connecting' ? 'Conectando Nym…' : 'Modo Privado Nym'}
            </button>
          </div>
        ) : null}
      </div>

      <details className="advanced-accordion" data-testid="nym-advanced-diagnostics">
        <summary className="advanced-accordion__summary">
          Opciones avanzadas y diagnóstico
        </summary>
        <div className="advanced-accordion__body">
          {advancedChildren}

          <div
            style={{
              display: 'grid',
              gap: 10,
              padding: 12,
              borderRadius: 10,
              background: 'var(--bg-color)',
              border: '1px solid var(--border-color)',
            }}
          >
            <h4 style={{ margin: 0, fontSize: '0.86rem', color: 'var(--text-main)' }}>
              Detalles técnicos de Nym y pruebas de red
            </h4>

            {onConnect || onDisconnect ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 8 }}>
                {onConnect ? (
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={busy || ready}
                    onClick={onConnect}
                    data-testid="nym-connect"
                    style={{ padding: '8px 10px', fontSize: '0.8rem', minBlockSize: 36 }}
                  >
                    {snapshot.state === 'connecting' ? 'Conectando…' : 'Conectar a Nym'}
                  </button>
                ) : null}
                {onDisconnect ? (
                  <button
                    type="button"
                    className="btn-outline"
                    disabled={busy || snapshot.state === 'disconnected' || snapshot.state === 'closed'}
                    onClick={onDisconnect}
                    data-testid="nym-disconnect"
                    style={{ padding: '8px 10px', fontSize: '0.8rem', minBlockSize: 36 }}
                  >
                    Desconectar
                  </button>
                ) : null}
              </div>
            ) : null}

            <ul
              style={{
                margin: 0,
                paddingLeft: '1.1rem',
                fontSize: '0.76rem',
                lineHeight: 1.5,
                color: 'var(--text-sec)',
              }}
            >
              <li>Motor: {snapshot.implementation}</li>
              <li data-testid="nym-mode-label">{describeWalletPrivacy(snapshot).label}</li>
              <li>Conectado a mixnet: {snapshot.connected ? 'sí' : 'no'}</li>
              <li>
                Documento interno: {snapshot.documentReady ? 'abierto' : 'cerrado'} (no equivale a Mixnet Ready)
              </li>
              <li data-nym-assets-ready={snapshot.assetsReady ? 'true' : 'false'}>
                Archivos Nym: {snapshot.assetsReady ? 'listos' : 'pendiente o error'}
              </li>
              <li data-nym-gateway={snapshot.selectedGateway ?? ''}>
                Gateway WSS: {snapshot.selectedGateway ?? '(ninguno)'}
              </li>
              <li data-nym-identity={snapshot.gatewayIdentityKey ?? ''} style={{ wordBreak: 'break-all' }}>
                Identidad del gateway: {snapshot.gatewayIdentityKey ?? '(ninguna)'}
              </li>
              <li data-nym-perm={String(snapshot.gatewayHostPermissionGranted)}>
                Permiso del navegador:{' '}
                {snapshot.gatewayHostPermissionGranted === true
                  ? 'concedido'
                  : snapshot.gatewayHostPermissionGranted === false
                    ? 'pendiente'
                    : 'no aplica'}
              </li>
              {snapshot.gatewayHostPermissionPattern ? (
                <li style={{ wordBreak: 'break-all' }}>
                  Patrón de permiso: {snapshot.gatewayHostPermissionPattern}
                </li>
              ) : null}
              <li data-nym-mixfetch-ready={ready ? 'true' : 'false'}>
                MixFetch listo: {ready ? 'sí' : 'no'}
              </li>
              {snapshot.diagnosticCode === 'SMOKE_DRY_RUN' ? (
                <li data-nym-diagnostic="SMOKE_DRY_RUN">
                  Prueba en seco completada (sin abrir conexión).
                </li>
              ) : null}
              {snapshot.diagnosticCode === 'SMOKE_NOT_AUTHORIZED' ? (
                <li data-nym-diagnostic="SMOKE_NOT_AUTHORIZED">
                  Live smoke bloqueado: requiere compilación build:nym-live-smoke.
                </li>
              ) : null}
              {snapshot.diagnosticCode &&
              snapshot.diagnosticCode !== 'OK' &&
              snapshot.diagnosticCode !== 'SMOKE_DRY_RUN' &&
              snapshot.diagnosticCode !== 'SMOKE_NOT_AUTHORIZED' ? (
                <li data-nym-diagnostic={snapshot.diagnosticCode}>
                  Diagnóstico: {snapshot.diagnosticCode}
                  {snapshot.diagnosticStage ? ` (${snapshot.diagnosticStage})` : ''}
                </li>
              ) : null}
            </ul>

            {onConfigureGateway ? (
              <div style={{ display: 'grid', gap: 8 }}>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-sec)' }}>
                  Dirección WSS del gateway
                  <input
                    className="input-field"
                    style={{ width: '100%', marginTop: 4 }}
                    value={gatewayInput}
                    disabled={busy}
                    placeholder={NYM_VERIFIED_GATEWAY.wssOrigin}
                    data-testid="nym-gateway-input"
                    onChange={(e) => setGatewayInput(e.target.value)}
                  />
                </label>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-sec)' }}>
                  Clave de identidad del gateway (base58)
                  <input
                    className="input-field"
                    style={{ width: '100%', marginTop: 4 }}
                    value={identityInput}
                    disabled={busy}
                    placeholder={NYM_VERIFIED_GATEWAY.identityKey}
                    data-testid="nym-identity-input"
                    onChange={(e) => setIdentityInput(e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="btn-outline"
                  disabled={busy || !gatewayInput.trim() || !identityInput.trim()}
                  data-testid="nym-gateway-save"
                  onClick={() => {
                    onConfigureGateway(gatewayInput.trim(), identityInput.trim());
                    setGatewayInput('');
                    setIdentityInput('');
                  }}
                >
                  Guardar gateway
                </button>
              </div>
            ) : null}

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {onRequestGatewayPermission ? (
                <button
                  type="button"
                  className="btn-outline"
                  disabled={busy}
                  onClick={(e) => {
                    // Keep request on the click stack — handler must not await IPC first.
                    e.preventDefault();
                    onRequestGatewayPermission();
                  }}
                  data-testid="nym-grant-permission"
                >
                  Conceder permiso de host
                </button>
              ) : null}
              {onLiveSmokeDryRun ? (
                <button
                  type="button"
                  className="btn-outline"
                  disabled={busy}
                  onClick={onLiveSmokeDryRun}
                  data-testid="nym-live-smoke-dry"
                >
                  Verificar configuración
                </button>
              ) : null}
              {onLiveSmokeExecute ? (
                <button
                  type="button"
                  className="btn-outline"
                  disabled={busy || !liveSmokeAuthorized}
                  onClick={onLiveSmokeExecute}
                  data-testid="nym-live-smoke-exec"
                >
                  Live smoke (autorizado)
                </button>
              ) : null}
              {onHttpSmoke ? (
                <button
                  type="button"
                  className="btn-outline"
                  disabled={busy || !ready || httpSmokeResult?.state === 'running'}
                  onClick={() => onHttpSmoke(httpSmokeUrl.trim() || undefined)}
                  data-testid="nym-http-smoke"
                >
                  Prueba HTTP (MixFetch)
                </button>
              ) : null}
              {onPublicDataFetch ? (
                <button
                  type="button"
                  className="btn-outline"
                  disabled={busy || publicDataBusy || !ready}
                  onClick={() => onPublicDataFetch('nym')}
                  data-testid="nym-public-data-fetch"
                >
                  Probar datos públicos por Nym
                </button>
              ) : null}
              {onStellarHorizonProbe ? (
                <button
                  type="button"
                  className="btn-outline"
                  disabled={busy || stellarProbeBusy || !ready}
                  onClick={() => onStellarHorizonProbe('nym')}
                  data-testid="nym-stellar-horizon-probe"
                >
                  Probe Horizon via Nym
                </button>
              ) : null}
            </div>

            {onStellarHorizonProbe ? (
              <div style={{ display: 'grid', gap: 6 }} data-testid="nym-stellar-horizon-panel">
                <ul
                  style={{
                    margin: 0,
                    paddingLeft: '1.1rem',
                    fontSize: '0.75rem',
                    color: 'var(--text-sec)',
                  }}
                  data-nym-stellar-horizon-state={stellarHorizonResult?.state ?? 'idle'}
                >
                  <li>
                    Horizon probe: {stellarHorizonResult?.state ?? 'idle'} — transporte:{' '}
                    {stellarHorizonResult?.transport ?? mode}
                  </li>
                  {stellarHorizonResult ? (
                    <>
                      <li style={{ wordBreak: 'break-all' }} data-testid="nym-stellar-horizon-logical">
                        Lógica: {stellarHorizonResult.logicalUrl || stellarHorizonResult.url}
                      </li>
                      <li style={{ wordBreak: 'break-all' }} data-testid="nym-stellar-horizon-effective">
                        Efectiva (MixFetch):{' '}
                        {stellarHorizonResult.effectiveUrl || stellarHorizonResult.url}
                        {stellarHorizonResult.urlRewritten ? ' (remap)' : ''}
                      </li>
                      {stellarHorizonResult.urlRewritten && stellarHorizonResult.rewriteReason ? (
                        <li
                          style={{ wordBreak: 'break-word' }}
                          data-testid="nym-stellar-horizon-rewrite-reason"
                        >
                          Motivo remap: {stellarHorizonResult.rewriteReason}
                        </li>
                      ) : null}
                      <li data-testid="nym-stellar-horizon-http">
                        HTTP:{' '}
                        {stellarHorizonResult.httpStatus != null
                          ? `${stellarHorizonResult.httpStatus}${stellarHorizonResult.httpOk ? ' ok' : ''}`
                          : 'n/d'}
                        {stellarHorizonResult.contentType
                          ? ` · ${stellarHorizonResult.contentType}`
                          : ''}{' '}
                        · {stellarHorizonResult.durationMs} ms
                      </li>
                      {stellarHorizonResult.lastLedger ? (
                        <li data-testid="nym-stellar-horizon-ledger">
                          Ledger: {stellarHorizonResult.lastLedger}
                          {stellarHorizonResult.lastLedgerBaseFee
                            ? ` · base fee ${stellarHorizonResult.lastLedgerBaseFee}`
                            : ''}
                        </li>
                      ) : null}
                      {stellarHorizonResult.networkPassphrase ? (
                        <li data-testid="nym-stellar-horizon-network">
                          Network: {stellarHorizonResult.networkPassphrase}
                        </li>
                      ) : null}
                      {stellarHorizonResult.horizonVersion ? (
                        <li data-testid="nym-stellar-horizon-version">
                          Horizon: {stellarHorizonResult.horizonVersion}
                        </li>
                      ) : null}
                      {stellarHorizonResult.horizonErrorDetail ? (
                        <li data-testid="nym-stellar-horizon-error-detail">
                          Horizon error: {stellarHorizonResult.horizonErrorDetail}
                        </li>
                      ) : null}
                      {stellarHorizonResult.responsePreview ? (
                        <li
                          style={{ wordBreak: 'break-all' }}
                          data-testid="nym-stellar-horizon-preview"
                        >
                          Preview: {stellarHorizonResult.responsePreview}
                        </li>
                      ) : null}
                      <li data-testid="nym-stellar-horizon-message">
                        {stellarHorizonResult.message}
                      </li>
                    </>
                  ) : null}
                </ul>
              </div>
            ) : null}

            {onPublicDataFetch ? (
              <div style={{ display: 'grid', gap: 6 }} data-testid="nym-public-data-panel">
                <ul
                  style={{
                    margin: 0,
                    paddingLeft: '1.1rem',
                    fontSize: '0.75rem',
                    color: 'var(--text-sec)',
                  }}
                  data-nym-public-data-state={publicDataResult?.state ?? 'idle'}
                >
                  <li>
                    Datos públicos: {publicDataResult?.state ?? 'idle'} — transporte:{' '}
                    {publicDataResult?.transport ?? mode} (POST {NYM_PUBLIC_DATA_DEFAULT_URL})
                  </li>
                  {publicDataResult ? (
                    <>
                      <li style={{ wordBreak: 'break-all' }} data-testid="nym-public-data-dest">
                        Destino: {publicDataResult.url}
                      </li>
                      <li data-testid="nym-public-data-duration">
                        Duración: {publicDataResult.durationMs} ms
                      </li>
                      <li data-testid="nym-public-data-http">
                        HTTP:{' '}
                        {publicDataResult.httpStatus != null
                          ? `${publicDataResult.httpStatus}${publicDataResult.httpOk ? ' ok' : ''}`
                          : 'n/d'}
                      </li>
                      <li data-testid="nym-public-data-probe">
                        Probe: {publicDataResult.probeId}
                        {publicDataResult.probeMatched ? ' — eco OK' : ''}
                      </li>
                      {publicDataResult.responsePreview ? (
                        <li
                          style={{ wordBreak: 'break-all' }}
                          data-testid="nym-public-data-preview"
                        >
                          Preview: {publicDataResult.responsePreview}
                        </li>
                      ) : null}
                      <li data-testid="nym-public-data-message">{publicDataResult.message}</li>
                    </>
                  ) : null}
                </ul>
              </div>
            ) : null}

            {onHttpSmoke ? (
              <div style={{ display: 'grid', gap: 8 }} data-testid="nym-http-smoke-panel">
                <label style={{ fontSize: '0.75rem', color: 'var(--text-sec)' }}>
                  URL de prueba HTTPS (opcional)
                  <input
                    className="input-field"
                    style={{ width: '100%', marginTop: 4 }}
                    value={httpSmokeUrl}
                    disabled={busy || httpSmokeResult?.state === 'running'}
                    placeholder={NYM_HTTP_SMOKE_DEFAULT_URL}
                    data-testid="nym-http-smoke-url"
                    onChange={(e) => setHttpSmokeUrl(e.target.value)}
                  />
                </label>
                <ul
                  style={{
                    margin: 0,
                    paddingLeft: '1.1rem',
                    fontSize: '0.75rem',
                    color: 'var(--text-sec)',
                  }}
                  data-nym-http-smoke-state={httpSmokeResult?.state ?? 'idle'}
                >
                  <li>
                    HTTP smoke:{' '}
                    {httpSmokeResult?.state === 'running'
                      ? 'ejecutando…'
                      : httpSmokeResult?.state ?? 'idle'}
                  </li>
                  {httpSmokeResult ? (
                    <>
                      <li style={{ wordBreak: 'break-all' }} data-testid="nym-http-smoke-dest">
                        Destino: {httpSmokeResult.url}
                      </li>
                      <li data-testid="nym-http-smoke-duration">
                        Duración: {httpSmokeResult.durationMs} ms
                      </li>
                      <li data-testid="nym-http-smoke-http">
                        HTTP:{' '}
                        {httpSmokeResult.httpStatus != null
                          ? `${httpSmokeResult.httpStatus}${httpSmokeResult.httpOk ? ' ok' : ''}`
                          : 'n/d'}
                      </li>
                      <li data-testid="nym-http-smoke-probe">
                        Probe id: {httpSmokeResult.probeId}
                        {httpSmokeResult.probeMatched
                          ? ' — eco verificado'
                          : httpSmokeResult.echoedProbeId
                            ? ` — eco distinto (${httpSmokeResult.echoedProbeId})`
                            : ' — sin eco'}
                      </li>
                      <li data-testid="nym-http-smoke-message">{httpSmokeResult.message}</li>
                    </>
                  ) : null}
                </ul>
              </div>
            ) : null}
          </div>
        </div>
      </details>
    </div>
  );
}
