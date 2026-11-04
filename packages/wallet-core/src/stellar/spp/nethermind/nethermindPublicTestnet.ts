/**
 * Pinned Nethermind public Stellar Testnet SPP deployment.
 *
 * Source (authoritative):
 * https://github.com/NethermindEth/stellar-private-payments/blob/main/deployments/testnet/deployments.json
 *
 * Do not invent addresses, admin, fees, KDF domain, or pool parameters.
 * Do not treat this as an Astrym-owned deployment.
 */

import {
  findEnabledPoolContract,
  parseSppContractConfig,
  type SppContractConfigInput,
  type SppPoolConfigInput,
} from '../sppContractConfig.js';

/** Official upstream path under NethermindEth/stellar-private-payments. */
export const NETHERMIND_PUBLIC_TESTNET_DEPLOYMENTS_SOURCE =
  'https://raw.githubusercontent.com/NethermindEth/stellar-private-payments/main/deployments/testnet/deployments.json' as const;

/** Companion circuits lock published next to deployments.json (fingerprints only). */
export const NETHERMIND_PUBLIC_TESTNET_CIRCUITS_SOURCE =
  'https://raw.githubusercontent.com/NethermindEth/stellar-private-payments/main/deployments/testnet/circuits.json' as const;

/**
 * SHA-256 of the exact deployments.json bytes pinned in
 * `./testnet-deployments.json` (verified against upstream main at integrate time).
 */
export const NETHERMIND_PUBLIC_TESTNET_DEPLOYMENTS_SHA256 =
  '77b3f61021d3985ad0d7c6ce4b39e5bbe075421174564d390df614123689e18e' as const;

/** Public shared XLM (native) pool — first enabled non-GVK native pool in the manifest. */
export const NETHERMIND_PUBLIC_XLM_POOL_CONTRACT =
  'CAMWBUWHYXEGBM3Q7M5DBGW7LLJL3I4QGANQEZFEWLRNTOJMTT2WG24U' as const;

export const NETHERMIND_PUBLIC_KDF_DOMAIN = 'Nethermind' as const;

export const NETHERMIND_PUBLIC_NETWORK_PASSPHRASE =
  'Test SDF Network ; September 2015' as const;

/**
 * Nethermind does not publish a public historical-sync bootnode URL alongside
 * deployments/testnet. Operators must self-host or supply one explicitly when
 * `bootnodeRequired` returns true. Astrym must not invent a bootnode.
 */
export const NETHERMIND_PUBLIC_BOOTNODE_URL: string | null = null;

export type SppDeploymentOwnership =
  | 'nethermind_public'
  | 'astrym_owned'
  | 'custom'
  | 'unknown';

export type SppDeploymentOwnershipInfo = {
  ownership: SppDeploymentOwnership;
  label: string;
  detail: string;
  poolContract: string | null;
  kdfDomain: string | null;
  source: string | null;
};

/** Exact official Testnet deployments.json object (pinned). */
export const NETHERMIND_PUBLIC_TESTNET_DEPLOYMENTS = {
  network: 'testnet',
  kdf_domain: 'Nethermind',
  deployer: 'GDX6X7DZQGIAGP6MWUK24BRQFDNQCP6E4FCJ4M6K3OCTNQM3EMWLQGPH',
  admin: 'GDF4BXPQY5N4BEO24UIHM4NVB62MW7HDWH7SVHKLVZAMLP5IIHCFQORC',
  asp_membership: 'CD25JAWK4OHQTZ2C72I3BZIN4P2RXT5M4LAWZG6RIXJO3HLVM74OFMCG',
  added_asp_memberships: [] as { contractId: string; deploymentLedger: number }[],
  asp_non_membership: 'CDP34AQV4JY3AHNUTWL3DFMKOLVLR43XSX75IAXN6PPVDIWCFQKMFY4R',
  asp_membership_wasm_hash: '44522579b5560d1aabb99abf77320963df50a3a7954a0ec12c9c7fc444d4953d',
  asp_non_membership_wasm_hash: '3c6eaf31e690605d96ca3815982a264ed14b1637d80dafdd06cc527552bf1826',
  verifiers: {
    B: 'CCMEZQ6RKT35PH5QILPFOBXCUJEDBUDYCWUBZEQMWWJCPEMPNFOLTGST',
    B_gvk_T: 'CBKHDVIL5XN7IIBJU2ZPUWIIHKVIQSUSLSN5W6ZQF33FAYYXBBDNUYUG',
    B_gvk_V: 'CBQS3Y4OTJVUBVYYTWEJEQC4ISKA3DAOOLOLAWNAU7Z2ZERP5YO7BLYO',
  },
  public_key_registry: 'CARXHKOPSGMUMFRDI72KNCRENVOTCJIGXPCPYOW42APDY2NEYF7CLKIL',
  public_key_registry_verifier: 'CBL5BJUOPVL7O66QDJYXH3ZWKZSNGKFLT5D5KGVUKUKCME6CCRTXHK5A',
  public_key_registry_verifier_wasm_hash:
    '4234d57285c2312c38e8e3b3dc6549001039bb8d1cdcd3bf7c78d710f8193003',
  pools: [
    {
      poolContractId: 'CAMWBUWHYXEGBM3Q7M5DBGW7LLJL3I4QGANQEZFEWLRNTOJMTT2WG24U',
      tokenContractId: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
      deploymentLedger: 5525981,
      enabled: true,
      policyFlags: ['blocklist'],
      asset: { kind: 'native' as const },
    },
    {
      poolContractId: 'CBTA5THUFNLDMFSH54YSHZJPAACLIBTT66ANWX2EPMP5F7ORPI24MXBQ',
      tokenContractId: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
      deploymentLedger: 5525986,
      enabled: true,
      policyFlags: ['blocklist'],
      asset: { kind: 'native' as const },
      gvkMode: 'traceable',
      gvkAuthorityPubKey: {
        x: '0x0963f68aeb1663a54b57abb8bf099cdec33bed62108b084319109bd8ba85167b',
        y: '0x1fea09b90e87da009b0a922da0475cbb8d5dd900b915799f877d9cfeb82e20ab',
      },
    },
    {
      poolContractId: 'CAJZRQ5MMAGPDR3GCYKHV5IWA5MQWRYSDC3NG6TFDFYBI3VSK6CUF53W',
      tokenContractId: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
      deploymentLedger: 5525991,
      enabled: true,
      policyFlags: ['blocklist'],
      asset: { kind: 'native' as const },
      gvkMode: 'viewOnly',
      gvkAuthorityPubKey: {
        x: '0x0963f68aeb1663a54b57abb8bf099cdec33bed62108b084319109bd8ba85167b',
        y: '0x1fea09b90e87da009b0a922da0475cbb8d5dd900b915799f877d9cfeb82e20ab',
      },
    },
    {
      poolContractId: 'CCU6H72HI6EL36YILNKHSCXXGLFVLOTYM7DKRORKSD5B5NTR22F7ZYKJ',
      tokenContractId: 'CCUUDM434BMZMYWYDITHFXHDMIVTGGD6T2I5UKNX5BSLXLW7HVR4MCGZ',
      deploymentLedger: 5525994,
      enabled: true,
      policyFlags: ['blocklist'],
      asset: {
        kind: 'classic' as const,
        code: 'EURC',
        issuer: 'GB3Q6QDZYTHWT7E5PVS3W7FUT5GVAFC5KSZFFLPU25GO7VTC3NM2ZTVO',
      },
    },
  ],
  rpcUrl: 'https://soroban-testnet.stellar.org/',
  networkPassphrase: 'Test SDF Network ; September 2015',
} as const;

/** Parse + validate the pinned Nethermind public Testnet ContractConfig. */
export function getNethermindPublicTestnetContractConfig(): SppContractConfigInput {
  return parseSppContractConfig(NETHERMIND_PUBLIC_TESTNET_DEPLOYMENTS);
}

/** Prefer the official public native XLM pool; fall back to first enabled. */
export function resolveNethermindPublicXlmPool(
  config: SppContractConfigInput = getNethermindPublicTestnetContractConfig(),
): string {
  const preferred = findEnabledPoolContract(config, NETHERMIND_PUBLIC_XLM_POOL_CONTRACT);
  if (preferred) return preferred;
  const first = findEnabledPoolContract(config);
  if (!first) {
    throw new Error('Nethermind public Testnet config has no enabled pool');
  }
  return first;
}

export function isNethermindPublicTestnetConfig(config: SppContractConfigInput): boolean {
  return (
    config.kdf_domain === NETHERMIND_PUBLIC_KDF_DOMAIN &&
    config.admin === NETHERMIND_PUBLIC_TESTNET_DEPLOYMENTS.admin &&
    config.deployer === NETHERMIND_PUBLIC_TESTNET_DEPLOYMENTS.deployer &&
    config.asp_membership === NETHERMIND_PUBLIC_TESTNET_DEPLOYMENTS.asp_membership &&
    config.public_key_registry === NETHERMIND_PUBLIC_TESTNET_DEPLOYMENTS.public_key_registry &&
    config.pools.some((pool) => pool.poolContractId === NETHERMIND_PUBLIC_XLM_POOL_CONTRACT)
  );
}

/**
 * Classify deployment ownership for Settings / status UI.
 * Astrym-owned is reserved for a future Astrym deployment (kdf_domain Astrym + Astrym admin).
 */
export function classifySppDeploymentOwnership(input: {
  config?: SppContractConfigInput | null;
  poolContract?: string | null;
}): SppDeploymentOwnershipInfo {
  const config = input.config ?? null;
  const poolContract =
    (input.poolContract && input.poolContract.length === 56 ? input.poolContract : null) ??
    (config ? findEnabledPoolContract(config, NETHERMIND_PUBLIC_XLM_POOL_CONTRACT) : null);

  if (!config) {
    return {
      ownership: 'unknown',
      label: 'Sin ContractConfig',
      detail: 'Falta deployments.json verificado.',
      poolContract,
      kdfDomain: null,
      source: null,
    };
  }

  if (isNethermindPublicTestnetConfig(config)) {
    const isPublicXlm = poolContract === NETHERMIND_PUBLIC_XLM_POOL_CONTRACT;
    return {
      ownership: 'nethermind_public',
      label: isPublicXlm
        ? 'Nethermind public Testnet (XLM)'
        : 'Nethermind public Testnet (otro pool del mismo manifest)',
      detail:
        'Deployment público de Nethermind. Astrym no controla admin, ASP, fees ni KDF. Deposit/transfer/withdraw comparten este pool.',
      poolContract,
      kdfDomain: config.kdf_domain,
      source: NETHERMIND_PUBLIC_TESTNET_DEPLOYMENTS_SOURCE,
    };
  }

  if (config.kdf_domain === 'Astrym' || config.kdf_domain.toLowerCase() === 'astrym') {
    return {
      ownership: 'astrym_owned',
      label: 'Astrym-owned (futuro / propio)',
      detail:
        'Config con KDF Astrym — deployment propio, distinto del pool público Nethermind.',
      poolContract,
      kdfDomain: config.kdf_domain,
      source: null,
    };
  }

  return {
    ownership: 'custom',
    label: 'ContractConfig personalizado',
    detail: 'Manifest verificado que no coincide con el pin Nethermind public Testnet.',
    poolContract,
    kdfDomain: config.kdf_domain,
    source: null,
  };
}

export function describePoolAsset(pool: SppPoolConfigInput): string {
  if (pool.asset.kind === 'native') return 'XLM (native)';
  if (pool.asset.kind === 'classic') {
    return `${pool.asset.code ?? 'ASSET'} (classic)`;
  }
  return `contract ${pool.asset.contractId ?? ''}`.trim();
}

/**
 * Compare packaged circuitLock fingerprints against an upstream circuits.json.
 * Returns matched/mismatched circuit ids (excludes version/meta).
 */
export function compareCircuitFingerprints(
  packaged: Record<string, unknown>,
  upstream: Record<string, unknown>,
): {
  matched: string[];
  mismatched: string[];
  packagedOnly: string[];
  upstreamOnly: string[];
  packagedVersion: string | null;
  upstreamVersion: string | null;
} {
  const packagedIds = Object.keys(packaged).filter((k) => k !== 'version' && k !== 'meta');
  const upstreamIds = Object.keys(upstream).filter((k) => k !== 'version' && k !== 'meta');
  const matched: string[] = [];
  const mismatched: string[] = [];
  for (const id of packagedIds) {
    if (!(id in upstream)) continue;
    if (JSON.stringify(packaged[id]) === JSON.stringify(upstream[id])) matched.push(id);
    else mismatched.push(id);
  }
  return {
    matched,
    mismatched,
    packagedOnly: packagedIds.filter((id) => !(id in upstream)),
    upstreamOnly: upstreamIds.filter((id) => !(id in packaged)),
    packagedVersion: typeof packaged['version'] === 'string' ? packaged['version'] : null,
    upstreamVersion: typeof upstream['version'] === 'string' ? upstream['version'] : null,
  };
}

/**
 * Resolve bootnode URL policy for Nethermind public Testnet.
 * Never invents a URL. Returns null when none configured.
 */
export function resolveSppBootnodeUrl(input: {
  configuredBootnodeUrl?: string | null;
  bootnodeRequired: boolean;
}): { bootnodeUrl: string | null; ok: boolean; message: string } {
  const configured =
    typeof input.configuredBootnodeUrl === 'string' && input.configuredBootnodeUrl.trim()
      ? input.configuredBootnodeUrl.trim()
      : null;

  if (!input.bootnodeRequired) {
    return {
      bootnodeUrl: configured,
      ok: true,
      message: configured
        ? 'Bootnode opcional configurado (RPC no lo exige ahora).'
        : 'Bootnode no requerido por el RPC actual.',
    };
  }

  if (!configured) {
    return {
      bootnodeUrl: null,
      ok: false,
      message:
        'bootnodeRequired=true y no hay bootnodeUrl. Nethermind no publica uno; auto-hospeda o pégalo en Ajustes. Sin inventar URL.',
    };
  }

  return {
    bootnodeUrl: configured,
    ok: true,
    message: 'Bootnode requerido y configurado por el operador.',
  };
}
