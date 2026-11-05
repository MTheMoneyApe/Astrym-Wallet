/**
 * Validate operator-supplied SPP deployments.json (ContractConfigInput).
 * Never invents addresses — only accepts well-formed, complete configs.
 */

import { StrKey } from '@stellar/stellar-sdk';

export type SppAssetDescriptorInput = {
  kind: 'native' | 'classic' | 'contract';
  code?: string;
  issuer?: string;
  contractId?: string;
  symbol?: string;
};

/** BabyJubJub authority point from deployments.json (`gvkAuthorityPubKey`). */
export type SppGvkAuthorityPubKey = {
  x: string;
  y: string;
};

export type SppPoolConfigInput = {
  poolContractId: string;
  tokenContractId: string;
  deploymentLedger: number;
  enabled: boolean;
  policyFlags?: string[];
  gvkMode?: string;
  /** Required by SDK when gvkMode is viewOnly/traceable — must not be stripped. */
  gvkAuthorityPubKey?: SppGvkAuthorityPubKey | unknown;
  asset: SppAssetDescriptorInput;
};

/** Matches stellar-private-payments@0.2.1 ContractConfigInput. */
export type SppContractConfigInput = {
  network: string;
  networkPassphrase?: string;
  rpcUrl?: string;
  kdf_domain: string;
  deployer: string;
  admin: string;
  asp_membership: string;
  added_asp_memberships?: { contractId: string; deploymentLedger: number }[];
  asp_non_membership: string;
  verifiers: Record<string, string>;
  public_key_registry: string;
  pools: SppPoolConfigInput[];
};

export class SppContractConfigError extends Error {
  readonly code = 'INVALID_CONTRACT_CONFIG' as const;
  constructor(message: string) {
    super(message);
    this.name = 'SppContractConfigError';
  }
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new SppContractConfigError(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function requireContractId(value: unknown, field: string): string {
  const id = requireNonEmptyString(value, field);
  if (!StrKey.isValidContract(id)) {
    throw new SppContractConfigError(`${field} must be a valid Stellar C… contract id`);
  }
  return id;
}

function requireAccountOrContract(value: unknown, field: string): string {
  const id = requireNonEmptyString(value, field);
  if (!(StrKey.isValidEd25519PublicKey(id) || StrKey.isValidContract(id))) {
    throw new SppContractConfigError(`${field} must be a Stellar G… or C… address`);
  }
  return id;
}

function parseAsset(raw: unknown, field: string): SppAssetDescriptorInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new SppContractConfigError(`${field} must be an object`);
  }
  const asset = raw as Record<string, unknown>;
  const kind = requireNonEmptyString(asset['kind'], `${field}.kind`);
  if (kind !== 'native' && kind !== 'classic' && kind !== 'contract') {
    throw new SppContractConfigError(`${field}.kind must be native|classic|contract`);
  }
  const out: SppAssetDescriptorInput = { kind };
  if (typeof asset['code'] === 'string') out.code = asset['code'];
  if (typeof asset['issuer'] === 'string') out.issuer = asset['issuer'];
  if (typeof asset['contractId'] === 'string') {
    out.contractId = requireContractId(asset['contractId'], `${field}.contractId`);
  }
  if (typeof asset['symbol'] === 'string') out.symbol = asset['symbol'];
  return out;
}

function parsePool(raw: unknown, index: number): SppPoolConfigInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new SppContractConfigError(`pools[${index}] must be an object`);
  }
  const pool = raw as Record<string, unknown>;
  const deploymentLedger = pool['deploymentLedger'];
  if (typeof deploymentLedger !== 'number' || !Number.isFinite(deploymentLedger) || deploymentLedger < 0) {
    throw new SppContractConfigError(`pools[${index}].deploymentLedger must be a non-negative number`);
  }
  if (typeof pool['enabled'] !== 'boolean') {
    throw new SppContractConfigError(`pools[${index}].enabled must be a boolean`);
  }
  const out: SppPoolConfigInput = {
    poolContractId: requireContractId(pool['poolContractId'], `pools[${index}].poolContractId`),
    tokenContractId: requireContractId(pool['tokenContractId'], `pools[${index}].tokenContractId`),
    deploymentLedger,
    enabled: pool['enabled'],
    asset: parseAsset(pool['asset'], `pools[${index}].asset`),
  };
  const policyFlags = pool['policyFlags'];
  if (Array.isArray(policyFlags) && policyFlags.every((x) => typeof x === 'string')) {
    out.policyFlags = policyFlags as string[];
  }
  if (typeof pool['gvkMode'] === 'string') out.gvkMode = pool['gvkMode'];
  if ('gvkAuthorityPubKey' in pool && pool['gvkAuthorityPubKey'] !== undefined) {
    out.gvkAuthorityPubKey = parseGvkAuthorityPubKey(
      pool['gvkAuthorityPubKey'],
      `pools[${index}].gvkAuthorityPubKey`,
    );
  }
  return out;
}

function parseGvkAuthorityPubKey(raw: unknown, field: string): SppGvkAuthorityPubKey | unknown {
  // Preserve SDK-accepted shapes. Prefer {x,y} hex strings when present.
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    // stellar-private-payments@0.2.1 types this as unknown — keep non-object values
    // only if the SDK might accept them; otherwise reject malformed objects.
    throw new SppContractConfigError(`${field} must be an object when present`);
  }
  const point = raw as Record<string, unknown>;
  if (typeof point['x'] === 'string' && typeof point['y'] === 'string') {
    const x = point['x'].trim();
    const y = point['y'].trim();
    if (!x || !y) {
      throw new SppContractConfigError(`${field}.x and ${field}.y must be non-empty strings`);
    }
    return { x, y };
  }
  // Pass through other object shapes verbatim for SDK serde (do not invent fields).
  return raw;
}

/**
 * Parse and validate a deployments.json object. Rejects lab placeholders and
 * incomplete shapes. Does not fetch network state or invent addresses.
 */
export function parseSppContractConfig(raw: unknown): SppContractConfigInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new SppContractConfigError('contractConfig must be a non-null object');
  }
  const cfg = raw as Record<string, unknown>;
  if (cfg['labPlaceholder'] === true) {
    throw new SppContractConfigError(
      'Rejecting labPlaceholder contractConfig — supply a real deployments.json',
    );
  }

  const verifiersRaw = cfg['verifiers'];
  if (!verifiersRaw || typeof verifiersRaw !== 'object' || Array.isArray(verifiersRaw)) {
    throw new SppContractConfigError('verifiers must be an object map');
  }
  const verifiers: Record<string, string> = {};
  for (const [key, value] of Object.entries(verifiersRaw as Record<string, unknown>)) {
    verifiers[key] = requireContractId(value, `verifiers.${key}`);
  }
  if (Object.keys(verifiers).length === 0) {
    throw new SppContractConfigError('verifiers must include at least one circuit verifier contract');
  }

  const poolsRaw = cfg['pools'];
  if (!Array.isArray(poolsRaw) || poolsRaw.length === 0) {
    throw new SppContractConfigError('pools must be a non-empty array');
  }
  const pools = poolsRaw.map((pool, index) => parsePool(pool, index));

  const out: SppContractConfigInput = {
    network: requireNonEmptyString(cfg['network'], 'network'),
    kdf_domain: requireNonEmptyString(cfg['kdf_domain'], 'kdf_domain'),
    deployer: requireAccountOrContract(cfg['deployer'], 'deployer'),
    admin: requireAccountOrContract(cfg['admin'], 'admin'),
    asp_membership: requireContractId(cfg['asp_membership'], 'asp_membership'),
    asp_non_membership: requireContractId(cfg['asp_non_membership'], 'asp_non_membership'),
    public_key_registry: requireContractId(cfg['public_key_registry'], 'public_key_registry'),
    verifiers,
    pools,
  };

  const networkPassphrase = cfg['networkPassphrase'];
  if (typeof networkPassphrase === 'string' && networkPassphrase.trim()) {
    out.networkPassphrase = networkPassphrase.trim();
  }
  const rpcUrl = cfg['rpcUrl'];
  if (typeof rpcUrl === 'string' && rpcUrl.trim()) {
    out.rpcUrl = rpcUrl.trim();
  }
  const added = cfg['added_asp_memberships'];
  if (Array.isArray(added)) {
    out.added_asp_memberships = added.map((entry, index) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new SppContractConfigError(`added_asp_memberships[${index}] must be an object`);
      }
      const row = entry as Record<string, unknown>;
      const deploymentLedger = row['deploymentLedger'];
      if (typeof deploymentLedger !== 'number' || !Number.isFinite(deploymentLedger)) {
        throw new SppContractConfigError(
          `added_asp_memberships[${index}].deploymentLedger must be a number`,
        );
      }
      return {
        contractId: requireContractId(row['contractId'], `added_asp_memberships[${index}].contractId`),
        deploymentLedger,
      };
    });
  }

  return out;
}

/**
 * Token contract configured for an enabled pool. Refuses unknown pools
 * instead of substituting another asset contract.
 */
export function tokenContractIdForEnabledPool(
  config: SppContractConfigInput,
  poolContractId: string,
): string {
  const match = config.pools.find(
    (pool) => pool.enabled && pool.poolContractId === poolContractId,
  );
  if (!match) {
    throw new SppContractConfigError(
      `No enabled pool ${poolContractId} in the contract config`,
    );
  }
  return match.tokenContractId;
}

export function findEnabledPoolContract(
  config: SppContractConfigInput,
  preferredPoolContract?: string | null,
): string | null {
  if (preferredPoolContract && StrKey.isValidContract(preferredPoolContract)) {
    const match = config.pools.find(
      (pool) => pool.enabled && pool.poolContractId === preferredPoolContract,
    );
    if (match) return match.poolContractId;
  }
  const first = config.pools.find((pool) => pool.enabled);
  return first?.poolContractId ?? null;
}
