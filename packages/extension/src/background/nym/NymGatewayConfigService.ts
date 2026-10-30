/**
 * Persisted operator gateway config (chrome.storage.local).
 * Never stores secrets. Empty by default — no silent gateway selection.
 *
 * Stores two related but distinct values for mix-fetch@1.4.2:
 * - identityKey → MixFetchOpts.preferredGateway
 * - gatewayOrigins (wss/https) → MV3 host permission allowlist
 */

import {
  validateGatewayIdentityKey,
  validateGatewayOrigin,
  type GatewayIdentityValidationResult,
  type GatewayValidationResult,
} from '../../nym-offscreen/gatewayConfig.js';
import {
  DEFAULT_NYM_NETWORK_ALLOWLIST,
  type NymNetworkAllowlistConfig,
} from '../../nym-offscreen/networkAllowlist.js';
import { NYM_VERIFIED_GATEWAY } from '../../nym-offscreen/verifiedGateway.js';

export const NYM_GATEWAY_CONFIG_STORAGE_KEY = 'solanym_nym_gateway_config_v1';

export type NymGatewayConfigState = {
  /** Exact validated gateway WSS/HTTPS origins for Chrome host permissions. */
  gatewayOrigins: string[];
  /** Last WSS origin selected for permission grant / connect gating. */
  selectedGateway: string | null;
  /**
   * MixFetchOpts.preferredGateway identity key (base58).
   * Not a URL — looked up by the WASM client via Nym API topology.
   */
  identityKey: string | null;
  updatedAt: string | null;
};

export const EMPTY_NYM_GATEWAY_CONFIG: NymGatewayConfigState = {
  gatewayOrigins: [],
  selectedGateway: null,
  identityKey: null,
  updatedAt: null,
};

type StorageArea = {
  get: (keys?: string | string[] | null) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
};

function parseStored(raw: unknown): NymGatewayConfigState {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_NYM_GATEWAY_CONFIG };
  const o = raw as Record<string, unknown>;
  const originsRaw = o['gatewayOrigins'];
  const origins = Array.isArray(originsRaw)
    ? originsRaw.filter((x): x is string => typeof x === 'string')
    : [];
  const selectedRaw = o['selectedGateway'];
  const selected =
    typeof selectedRaw === 'string' && selectedRaw.length > 0 ? selectedRaw : null;
  const identityRaw = o['identityKey'];
  const identityParsed =
    typeof identityRaw === 'string' && identityRaw.length > 0
      ? validateGatewayIdentityKey(identityRaw)
      : null;
  const updatedRaw = o['updatedAt'];
  return {
    gatewayOrigins: origins,
    selectedGateway: selected && origins.includes(selected) ? selected : null,
    identityKey: identityParsed?.ok ? identityParsed.identityKey : null,
    updatedAt: typeof updatedRaw === 'string' ? updatedRaw : null,
  };
}

export class NymGatewayConfigService {
  constructor(private readonly _storage: StorageArea) {}

  async load(): Promise<NymGatewayConfigState> {
    const data = await this._storage.get(NYM_GATEWAY_CONFIG_STORAGE_KEY);
    return parseStored(data[NYM_GATEWAY_CONFIG_STORAGE_KEY]);
  }

  /**
   * Pin the documented DevRel gateway when the operator has not saved one.
   * A complete saved config is left untouched. Connect calls this so the
   * allowlist is not empty on a fresh install. Removing a custom gateway
   * and connecting again re-seeds the verified default.
   */
  async ensureVerifiedDefault(): Promise<NymGatewayConfigState> {
    const current = await this.load();
    if (current.gatewayOrigins.length > 0 && current.selectedGateway && current.identityKey) {
      return current;
    }
    if (current.gatewayOrigins.length === 0 && !current.identityKey) {
      const seeded = await this.addGateway(
        NYM_VERIFIED_GATEWAY.wssOrigin,
        NYM_VERIFIED_GATEWAY.identityKey,
      );
      return seeded.config;
    }
    if (
      !current.identityKey &&
      (current.selectedGateway === NYM_VERIFIED_GATEWAY.wssOrigin ||
        current.gatewayOrigins.includes(NYM_VERIFIED_GATEWAY.wssOrigin))
    ) {
      return this.setIdentityKey(NYM_VERIFIED_GATEWAY.identityKey);
    }
    if (current.identityKey && current.gatewayOrigins.length === 0) {
      const added = await this.addGateway(NYM_VERIFIED_GATEWAY.wssOrigin, current.identityKey);
      return added.config;
    }
    return current;
  }

  async save(state: NymGatewayConfigState): Promise<NymGatewayConfigState> {
    const next: NymGatewayConfigState = {
      gatewayOrigins: [...state.gatewayOrigins],
      selectedGateway:
        state.selectedGateway && state.gatewayOrigins.includes(state.selectedGateway)
          ? state.selectedGateway
          : null,
      identityKey: state.identityKey,
      updatedAt: new Date().toISOString(),
    };
    await this._storage.set({ [NYM_GATEWAY_CONFIG_STORAGE_KEY]: next });
    return next;
  }

  /**
   * Validate and add a WSS/HTTPS gateway origin. Does not request host permissions.
   * Does not connect to Mixnet. Optionally set/replace the MixFetch identity key.
   */
  async addGateway(
    rawOrigin: string,
    identityKey?: string | null,
  ): Promise<{
    config: NymGatewayConfigState;
    validation: Extract<GatewayValidationResult, { ok: true }>;
    identity: Extract<GatewayIdentityValidationResult, { ok: true }> | null;
  }> {
    const validation = validateGatewayOrigin(rawOrigin);
    if (!validation.ok) {
      throw Object.assign(new Error(validation.message), { code: validation.code });
    }

    let identity: Extract<GatewayIdentityValidationResult, { ok: true }> | null = null;
    if (identityKey != null && identityKey.trim() !== '') {
      const idResult = validateGatewayIdentityKey(identityKey);
      if (!idResult.ok) {
        throw Object.assign(new Error(idResult.message), { code: idResult.code });
      }
      identity = idResult;
    }

    const current = await this.load();
    if (!current.gatewayOrigins.includes(validation.origin)) {
      current.gatewayOrigins = [...current.gatewayOrigins, validation.origin];
    }
    if (!current.selectedGateway) {
      current.selectedGateway = validation.origin;
    }
    if (identity) {
      current.identityKey = identity.identityKey;
    }
    const config = await this.save(current);
    return { config, validation, identity };
  }

  async setIdentityKey(rawKey: string): Promise<NymGatewayConfigState> {
    const idResult = validateGatewayIdentityKey(rawKey);
    if (!idResult.ok) {
      throw Object.assign(new Error(idResult.message), { code: idResult.code });
    }
    const current = await this.load();
    current.identityKey = idResult.identityKey;
    return this.save(current);
  }

  async removeGateway(origin: string): Promise<NymGatewayConfigState> {
    const validation = validateGatewayOrigin(origin);
    const key = validation.ok ? validation.origin : origin.trim();
    const current = await this.load();
    current.gatewayOrigins = current.gatewayOrigins.filter((o) => o !== key);
    if (current.selectedGateway === key) {
      current.selectedGateway = current.gatewayOrigins[0] ?? null;
    }
    return this.save(current);
  }

  async selectGateway(origin: string): Promise<NymGatewayConfigState> {
    const validation = validateGatewayOrigin(origin);
    if (!validation.ok) {
      throw Object.assign(new Error(validation.message), { code: validation.code });
    }
    const current = await this.load();
    if (!current.gatewayOrigins.includes(validation.origin)) {
      throw Object.assign(
        new Error('Gateway is not on the configured allowlist'),
        { code: 'GATEWAY_NOT_ALLOWLISTED' },
      );
    }
    current.selectedGateway = validation.origin;
    return this.save(current);
  }

  async toAllowlistConfig(): Promise<NymNetworkAllowlistConfig> {
    const state = await this.load();
    return {
      bootstrapApiOrigins: DEFAULT_NYM_NETWORK_ALLOWLIST.bootstrapApiOrigins,
      gatewayOrigins: state.gatewayOrigins,
    };
  }
}
