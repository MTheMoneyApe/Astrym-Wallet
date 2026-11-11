/**
 * SPP status for settings. Private payments require Nym; host opens internally.
 * Distinguishes Nethermind public Testnet vs future Astrym-owned deployments.
 */

import React, { useEffect, useMemo, useState } from 'react';
import type { SppIntegrationSnapshot } from '@solanym/wallet-core/src/stellar/spp/SppIntegrationStatus.js';
import { describeSppIntegrationAvailability } from '@solanym/wallet-core/src/stellar/spp/SppIntegrationStatus.js';
import { parseSppContractConfig } from '@solanym/wallet-core/src/stellar/spp/sppContractConfig.js';
import {
  classifySppDeploymentOwnership,
  getNethermindPublicTestnetContractConfig,
  NETHERMIND_PUBLIC_TESTNET_DEPLOYMENTS_SOURCE,
  NETHERMIND_PUBLIC_XLM_POOL_CONTRACT,
  type SppDeploymentOwnership,
} from '@solanym/wallet-core/src/stellar/spp/nethermind/nethermindPublicTestnet.js';
import {
  describeSppPreparePhase,
  type SppPrepareStatus,
} from '../shared/sppPrepareStatus.js';
import { SppAccountPanel } from './SppAccountPanel.js';

export type SppStatusPanelProps = {
  snapshot: SppIntegrationSnapshot;
  probing?: boolean;
  sessionGeneration?: number;
  nymMode?: 'direct' | 'nym';
  nymConnected?: boolean;
  sppSelected?: boolean;
  prepareStatus?: SppPrepareStatus | null;
  poolContract?: string;
  contractConfigJson?: string;
  bootnodeUrl?: string;
  onToggleSpp?: (next: boolean) => void;
  onPoolContractChange?: (contract: string) => void;
  onContractConfigJsonChange?: (json: string) => void;
  onBootnodeUrlChange?: (url: string) => void;
  onUseNethermindPublic?: () => void;
};

function ownershipTone(ownership: SppDeploymentOwnership): string {
  switch (ownership) {
    case 'nethermind_public':
      return 'var(--accent, #2a7)';
    case 'astrym_owned':
      return 'var(--warning, #c80)';
    case 'custom':
      return 'var(--muted, #888)';
    case 'unknown':
      return 'var(--muted, #888)';
    default: {
      const _exhaustive: never = ownership;
      return _exhaustive;
    }
  }
}

export function SppStatusPanel({
  snapshot,
  probing = false,
  sessionGeneration = 0,
  nymMode = 'direct',
  nymConnected = false,
  sppSelected = false,
  prepareStatus = null,
  poolContract = '',
  contractConfigJson = '',
  bootnodeUrl = '',
  onToggleSpp,
  onPoolContractChange,
  onContractConfigJsonChange,
  onBootnodeUrlChange,
  onUseNethermindPublic,
}: SppStatusPanelProps) {
  const writeReady = prepareStatus?.phase === 'ready';
  const title = probing
    ? 'Comprobando assets SPP…'
    : writeReady
      ? 'SPP READY (write_pool_ready verificado)'
      : describeSppIntegrationAvailability(snapshot.availability);
  const showPaymentsOff = !snapshot.capabilities.private_payments;
  const showRoOff = !snapshot.capabilities.read_only_session;
  const nymReady = nymMode === 'nym' && nymConnected;
  const [localPool, setLocalPool] = useState(poolContract);
  const [localConfig, setLocalConfig] = useState(contractConfigJson);
  const [localBootnode, setLocalBootnode] = useState(bootnodeUrl);
  const [configError, setConfigError] = useState<string | null>(null);

  useEffect(() => {
    setLocalPool(poolContract);
  }, [poolContract]);
  useEffect(() => {
    setLocalConfig(contractConfigJson);
  }, [contractConfigJson]);
  useEffect(() => {
    setLocalBootnode(bootnodeUrl);
  }, [bootnodeUrl]);

  const kdfDomain = useMemo(() => {
    try {
      const trimmed = localConfig.trim();
      if (!trimmed) return getNethermindPublicTestnetContractConfig().kdf_domain;
      return parseSppContractConfig(JSON.parse(trimmed) as unknown).kdf_domain;
    } catch {
      return getNethermindPublicTestnetContractConfig().kdf_domain;
    }
  }, [localConfig]);

  const ownership = useMemo(() => {
    if (prepareStatus?.deploymentOwnership && prepareStatus.deploymentLabel) {
      return {
        ownership: prepareStatus.deploymentOwnership,
        label: prepareStatus.deploymentLabel,
        detail: prepareStatus.message,
        poolContract: prepareStatus.poolContract,
        kdfDomain: null as string | null,
        source:
          prepareStatus.deploymentOwnership === 'nethermind_public'
            ? NETHERMIND_PUBLIC_TESTNET_DEPLOYMENTS_SOURCE
            : null,
      };
    }
    try {
      const trimmed = localConfig.trim();
      const config = trimmed ? parseSppContractConfig(JSON.parse(trimmed) as unknown) : null;
      return classifySppDeploymentOwnership({
        config,
        poolContract: localPool.trim() || null,
      });
    } catch {
      return classifySppDeploymentOwnership({
        config: null,
        poolContract: localPool.trim() || null,
      });
    }
  }, [localConfig, localPool, prepareStatus]);

  return (
    <div
      className="card"
      style={{ marginBottom: 20 }}
      data-testid="spp-status-panel"
      data-spp-generation={sessionGeneration}
      data-spp-ownership={ownership.ownership}
    >
      <h3 style={{ marginTop: 0, fontSize: '0.95rem' }}>Stellar Private Payments</h3>
      <p
        style={{ margin: '0 0 8px', fontSize: '0.85rem' }}
        data-spp-availability={probing ? 'probing' : writeReady ? 'ready' : snapshot.availability}
        data-spp-session={snapshot.sessionState ?? 'none'}
        data-spp-write-ready={writeReady ? 'yes' : 'no'}
        data-testid="spp-availability-title"
      >
        {title}
      </p>
      <p
        style={{
          margin: '0 0 8px',
          fontSize: '0.8rem',
          color: ownershipTone(ownership.ownership),
        }}
        data-testid="spp-deployment-ownership"
        data-spp-ownership={ownership.ownership}
      >
        Deployment: {ownership.label}
      </p>
      <p style={{ margin: '0 0 8px', fontSize: '0.72rem', color: 'var(--muted, #888)' }}>
        {ownership.ownership === 'nethermind_public'
          ? 'Pool público Nethermind (no Astrym-owned). Admin/ASP/fees/KDF son de Nethermind. Deposit, transfer y withdraw usan el mismo pool compartido.'
          : ownership.ownership === 'astrym_owned'
            ? 'Deployment Astrym-owned (futuro / propio). Distinto del pin público Nethermind.'
            : ownership.detail}
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
        <li data-testid="spp-write-ready" data-spp-write-ready={prepareStatus?.phase === 'ready' ? 'yes' : 'no'}>
          write_pool_ready: {prepareStatus?.phase === 'ready' ? 'sí (verificado)' : 'no'}
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
        <>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn-secondary"
              data-testid="spp-use-nethermind-public"
              style={{ fontSize: '0.75rem' }}
              onClick={() => {
                const cfg = getNethermindPublicTestnetContractConfig();
                const json = JSON.stringify(cfg, null, 2);
                setLocalConfig(json);
                setLocalPool(NETHERMIND_PUBLIC_XLM_POOL_CONTRACT);
                setConfigError(null);
                onContractConfigJsonChange?.(json);
                onPoolContractChange?.(NETHERMIND_PUBLIC_XLM_POOL_CONTRACT);
                onUseNethermindPublic?.();
              }}
            >
              Usar pool público Nethermind (XLM)
            </button>
          </div>
          <label style={{ display: 'grid', gap: 4, marginTop: 10, fontSize: '0.8rem' }}>
            Contrato del pool (C…)
            <input
              className="input-field address-wrap"
              data-testid="spp-pool-contract"
              style={{ width: '100%' }}
              value={localPool}
              placeholder={NETHERMIND_PUBLIC_XLM_POOL_CONTRACT}
              onChange={(event) => {
                setLocalPool(event.target.value);
                onPoolContractChange?.(event.target.value.trim());
              }}
            />
            <span className="text-secondary" style={{ fontSize: '0.7rem' }}>
              Por defecto: {NETHERMIND_PUBLIC_XLM_POOL_CONTRACT} (Nethermind public XLM). Mismo pool
              para deposit / transfer / withdraw.
            </span>
          </label>
          <label style={{ display: 'grid', gap: 4, marginTop: 10, fontSize: '0.8rem' }}>
            ContractConfig (deployments.json)
            <textarea
              className="input-field"
              data-testid="spp-contract-config"
              style={{ width: '100%', minHeight: 120, fontFamily: 'var(--font-mono)', fontSize: 12 }}
              value={localConfig}
              placeholder="Pin Nethermind public Testnet o deployments.json verificado"
              onChange={(event) => {
                const next = event.target.value;
                setLocalConfig(next);
                setConfigError(null);
                onContractConfigJsonChange?.(next);
              }}
            />
            <span className="text-secondary" style={{ fontSize: '0.7rem' }}>
              Fuente oficial Nethermind:{' '}
              <span style={{ wordBreak: 'break-all' }}>
                {NETHERMIND_PUBLIC_TESTNET_DEPLOYMENTS_SOURCE}
              </span>
              . No se inventan direcciones. Astrym-owned = deployment futuro distinto.
            </span>
          </label>
          <label style={{ display: 'grid', gap: 4, marginTop: 10, fontSize: '0.8rem' }}>
            Bootnode URL (opcional)
            <input
              className="input-field"
              data-testid="spp-bootnode-url"
              style={{ width: '100%' }}
              value={localBootnode}
              placeholder="https://… (solo si bootnodeRequired; Nethermind no publica uno)"
              onChange={(event) => {
                const next = event.target.value;
                setLocalBootnode(next);
                onBootnodeUrlChange?.(next.trim());
              }}
            />
            <span className="text-secondary" style={{ fontSize: '0.7rem' }}>
              Si el SDK exige bootnode y falta esta URL, la sesión falla cerrada. No hay fallback
              inventado.
            </span>
          </label>
          {configError ? (
            <p className="error-text" role="alert" style={{ fontSize: '0.75rem' }}>{configError}</p>
          ) : null}
          <SppAccountPanel
            preparePhase={prepareStatus?.phase ?? 'idle'}
            nymConnected={nymReady}
            kdfDomain={kdfDomain}
          />
        </>
      ) : null}
    </div>
  );
}
