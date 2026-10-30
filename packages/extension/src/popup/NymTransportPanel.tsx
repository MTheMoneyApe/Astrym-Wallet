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
};

function describeState(snapshot: NymUiSnapshot): string {
  switch (snapshot.state) {
    case 'connected':
      return snapshot.connected ? 'Ready (Mixnet)' : 'Mixnet desconectado';
    case 'connecting':
      return 'Connecting…';
    case 'error':
      return 'Error';
    case 'closed':
      return 'Disconnected';
    case 'disconnected':
    default:
      return 'Disconnected';
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
}: NymTransportPanelProps) {
  const mode = snapshot.mode ?? 'nym';
  const ready = snapshot.connected && snapshot.state === 'connected';
  const [gatewayInput, setGatewayInput] = useState('');
  const [identityInput, setIdentityInput] = useState('');
  const [httpSmokeUrl, setHttpSmokeUrl] = useState('');
  const publicDataBusy = publicDataResult?.state === 'running';
  const stellarProbeBusy = stellarHorizonResult?.state === 'running';

  return (
    <div className="card" style={{ marginBottom: 20 }} data-testid="nym-transport-panel">
      <h3 style={{ marginTop: 0, fontSize: '0.95rem' }}>Nym Mixnet</h3>
      <p
        style={{ margin: '0 0 8px', fontSize: '0.85rem' }}
        data-nym-state={snapshot.state}
        data-nym-connected={snapshot.connected ? 'true' : 'false'}
        data-nym-impl={snapshot.implementation}
        data-nym-mode={mode}
        data-nym-document-ready={snapshot.documentReady ? 'true' : 'false'}
      >
        {describeState(snapshot)}
      </p>
      <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.78rem', color: 'var(--muted, #888)' }}>
        <li>Implementación: {snapshot.implementation}</li>
        <li>Modo: {mode}</li>
        <li>Conectado: {snapshot.connected ? 'sí' : 'no'}</li>
        <li>
          Documento offscreen: {snapshot.documentReady ? 'abierto' : 'no'} (≠ Mixnet Ready)
        </li>
        <li data-nym-assets-ready={snapshot.assetsReady ? 'true' : 'false'}>
          Assets nym-mixfetch: {snapshot.assetsReady ? 'ok' : 'pendiente/error'}
        </li>
        <li data-nym-gateway={snapshot.selectedGateway ?? ''}>
          WSS (permiso MV3): {snapshot.selectedGateway ?? '(ninguno)'}
        </li>
        <li data-nym-identity={snapshot.gatewayIdentityKey ?? ''} style={{ wordBreak: 'break-all' }}>
          Identity (MixFetch): {snapshot.gatewayIdentityKey ?? '(ninguna)'}
        </li>
        <li data-nym-perm={String(snapshot.gatewayHostPermissionGranted)}>
          2. Host permission:{' '}
          {snapshot.gatewayHostPermissionGranted === true
            ? 'concedido (contains=true)'
            : snapshot.gatewayHostPermissionGranted === false
              ? 'no concedido'
              : 'n/d'}{' '}
          — usa Grant (gesto de usuario); ≠ Mixnet Ready
        </li>
        {snapshot.gatewayHostPermissionPattern ? (
          <li style={{ wordBreak: 'break-all' }}>
            Patrón MV3: {snapshot.gatewayHostPermissionPattern}
          </li>
        ) : null}
        <li data-nym-mixfetch-ready={ready ? 'true' : 'false'}>
          4. MixFetch Ready: {ready ? 'sí (createMixFetch OK)' : 'no'}
        </li>
        {snapshot.diagnosticCode === 'SMOKE_DRY_RUN' ? (
          <li data-nym-diagnostic="SMOKE_DRY_RUN">
            3a. Smoke dry-run: config/assets/permiso sondeados — createMixFetch no ejecutado
          </li>
        ) : null}
        {snapshot.diagnosticCode === 'SMOKE_NOT_AUTHORIZED' ? (
          <li data-nym-diagnostic="SMOKE_NOT_AUTHORIZED">
            3b. Live smoke bloqueado: hace falta build:nym-live-smoke + confirmLiveSmoke=true
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
      {snapshot.lastError ? (
        <p style={{ margin: '10px 0 0', fontSize: '0.72rem', color: 'var(--muted, #888)' }}>
          {snapshot.lastError}
        </p>
      ) : null}

      {onConfigureGateway ? (
        <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
          <label style={{ fontSize: '0.75rem', color: 'var(--muted, #888)' }}>
            Origen WSS exacto (host permission)
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
          <label style={{ fontSize: '0.75rem', color: 'var(--muted, #888)' }}>
            Identity key MixFetch (base58, no URL)
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
            className="btn-secondary"
            disabled={busy || !gatewayInput.trim() || !identityInput.trim()}
            data-testid="nym-gateway-save"
            onClick={() => {
              onConfigureGateway(gatewayInput.trim(), identityInput.trim());
              setGatewayInput('');
              setIdentityInput('');
            }}
          >
            Save gateway
          </button>
        </div>
      ) : null}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
        {onRequestGatewayPermission ? (
          <button
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={(e) => {
              // Keep request on the click stack — handler must not await IPC first.
              e.preventDefault();
              onRequestGatewayPermission();
            }}
            data-testid="nym-grant-permission"
            title="User gesture: chrome.permissions.request for exact origin (popup, not background)"
          >
            Grant permission
          </button>
        ) : null}
        {onConnect ? (
          <button
            type="button"
            className="btn-secondary"
            disabled={busy || ready}
            onClick={onConnect}
            data-testid="nym-connect"
          >
            Connect
          </button>
        ) : null}
        {onDisconnect ? (
          <button
            type="button"
            className="btn-secondary"
            disabled={busy || snapshot.state === 'disconnected' || snapshot.state === 'closed'}
            onClick={onDisconnect}
            data-testid="nym-disconnect"
          >
            Disconnect
          </button>
        ) : null}
        {onSetMode ? (
          <>
            <button
              type="button"
              className="btn-secondary"
              disabled={busy || mode === 'nym'}
              onClick={() => onSetMode('nym')}
              data-testid="nym-mode-nym"
            >
              Nym mode
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={busy || mode === 'direct'}
              onClick={() => onSetMode('direct')}
              data-testid="nym-mode-direct"
              title="Explicit clearnet opt-in"
            >
              Direct (clearnet)
            </button>
          </>
        ) : null}
        {onLiveSmokeDryRun ? (
          <button
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={onLiveSmokeDryRun}
            data-testid="nym-live-smoke-dry"
            title="Dry-run only: assets/config/permission probe — never createMixFetch"
          >
            Smoke dry-run
          </button>
        ) : null}
        {onLiveSmokeExecute ? (
          <button
            type="button"
            className="btn-secondary"
            disabled={busy || !liveSmokeAuthorized}
            onClick={onLiveSmokeExecute}
            data-testid="nym-live-smoke-exec"
            title={
              liveSmokeAuthorized
                ? 'Authorized live smoke: createMixFetch then disconnect'
                : 'Rebuild with build:nym-live-smoke to authorize'
            }
          >
            Live smoke (authorized)
          </button>
        ) : null}
        {onHttpSmoke ? (
          <button
            type="button"
            className="btn-secondary"
            disabled={busy || !ready || httpSmokeResult?.state === 'running'}
            onClick={() => onHttpSmoke(httpSmokeUrl.trim() || undefined)}
            data-testid="nym-http-smoke"
            title="POST echo via MixFetch only — requires MixFetch Ready; ≠ document open"
          >
            HTTP smoke (MixFetch)
          </button>
        ) : null}
        {onPublicDataFetch ? (
          <button
            type="button"
            className="btn-secondary"
            disabled={busy || publicDataBusy || !ready}
            onClick={() => onPublicDataFetch('nym')}
            data-testid="nym-public-data-fetch"
            title="GET public echo via FailClosedTransportRouter → MixFetch (no clearnet fallback)"
          >
            Fetch public data via Nym
          </button>
        ) : null}
        {onStellarHorizonProbe ? (
          <button
            type="button"
            className="btn-secondary"
            disabled={busy || stellarProbeBusy || !ready}
            onClick={() => onStellarHorizonProbe('nym')}
            data-testid="nym-stellar-horizon-probe"
            title="GET Horizon fee_stats via StellarReadClient→MixFetch (HAL body)"
          >
            Probe Horizon via Nym
          </button>
        ) : null}
      </div>

      {onStellarHorizonProbe ? (
        <div
          style={{ marginTop: 12, display: 'grid', gap: 8 }}
          data-testid="nym-stellar-horizon-panel"
        >
          <ul
            style={{
              margin: 0,
              paddingLeft: '1.1rem',
              fontSize: '0.78rem',
              color: 'var(--muted, #888)',
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
        <div
          style={{ marginTop: 12, display: 'grid', gap: 8 }}
          data-testid="nym-public-data-panel"
        >
          <ul
            style={{
              margin: 0,
              paddingLeft: '1.1rem',
              fontSize: '0.78rem',
              color: 'var(--muted, #888)',
            }}
            data-nym-public-data-state={publicDataResult?.state ?? 'idle'}
          >
            <li>
              Public data: {publicDataResult?.state ?? 'idle'} — transporte:{' '}
              {publicDataResult?.transport ?? mode} (default POST{' '}
              {NYM_PUBLIC_DATA_DEFAULT_URL})
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
        <div style={{ marginTop: 12, display: 'grid', gap: 8 }} data-testid="nym-http-smoke-panel">
          <label style={{ fontSize: '0.75rem', color: 'var(--muted, #888)' }}>
            Echo HTTPS URL (opcional; default postman-echo)
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
            style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.78rem', color: 'var(--muted, #888)' }}
            data-nym-http-smoke-state={httpSmokeResult?.state ?? 'idle'}
          >
            <li>
              HTTP smoke:{' '}
              {httpSmokeResult?.state === 'running'
                ? 'running…'
                : httpSmokeResult?.state ?? 'idle'}{' '}
              (MixFetch Ready ≠ petición completada)
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

      <p style={{ margin: '10px 0 0', fontSize: '0.72rem', color: 'var(--muted, #888)' }}>
        Connect usa el gateway verificado si no hay uno guardado. En la extensión, el permiso de
        host se pide en el mismo clic. En el webapp de Android no hay API de permisos MV3: MixFetch
        corre en esta página. Disconnect vuelve a modo direct. Mientras el modo sigue en nym, un
        fallo no cae a clearnet.
      </p>
      {mode === 'nym' && !ready ? (
        <p style={{ margin: '6px 0 0', fontSize: '0.72rem', color: 'var(--muted, #888)' }}>
          Protected Stellar Horizon/Friendbot requests stay blocked until Mixnet is Ready
          (no clearnet fallback).
        </p>
      ) : null}
    </div>
  );
}
