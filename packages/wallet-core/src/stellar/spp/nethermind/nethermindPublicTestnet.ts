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

/**
 * Official source commit rechecked 2026-11-07. `deployments.json` is byte-identical
 * to the last deployment commit `c71ba3fcb2298f320d1320e9fa12f600564cf6e6` (2026-11-04).
 * Later main commits do not change this file, the KDF text, or the registry ABI.
 */
export const NETHERMIND_PUBLIC_TESTNET_SOURCE_COMMIT =
  'e6ce95c2a71ed6313f78bb19cfdd0de1d9663120' as const;

export const NETHERMIND_PUBLIC_TESTNET_DEPLOYMENTS_SOURCE =
  `https://raw.githubusercontent.com/NethermindEth/stellar-private-payments/${NETHERMIND_PUBLIC_TESTNET_SOURCE_COMMIT}/deployments/testnet/deployments.json` as const;

/** Companion circuits lock published next to deployments.json (fingerprints only). */
export const NETHERMIND_PUBLIC_TESTNET_CIRCUITS_SOURCE =
  `https://raw.githubusercontent.com/NethermindEth/stellar-private-payments/${NETHERMIND_PUBLIC_TESTNET_SOURCE_COMMIT}/deployments/testnet/circuits.json` as const;

/** SHA-256 of the pinned circuits lock. Matches GitHub release circuits-v0.7 `circuits.json`. */
export const NETHERMIND_PUBLIC_TESTNET_CIRCUITS_SHA256 =
  '35c36f4d0f7055514156b67df9995cb9550e5f380e9a84d85dddb457d17b241e' as const;

/**
 * Official circuits-v0.7 archive. Its `circuits.json` is byte-identical to the lock above.
 * The npm package `stellar-private-payments@0.2.1` (2026-10-16) is not this runtime.
 */
export const NETHERMIND_CIRCUITS_V07_SHA256 =
  'c4ad54de6cc146bd8323e502341d545e09d0cd95d21b4f60ad2388188f64a2f9' as const;

/**
 * SHA-256 of the exact deployments.json bytes pinned in
 * `./testnet-deployments.json` (verified against upstream main at integrate time).
 */
export const NETHERMIND_PUBLIC_TESTNET_DEPLOYMENTS_SHA256 =
  'c1a9a7c9b7fbaf27ff09ee38c23ece84e75a2744191b28ac4178cbc417d44394' as const;

/**
 * Previous public deployment, still present on Testnet as of ledger 5611126,
 * and not the current official manifest. Do not treat its keys as current.
 */
export const STALE_NETHERMIND_PUBLIC_XLM_POOL_CONTRACT =
  'CAMWBUWHYXEGBM3Q7M5DBGW7LLJL3I4QGANQEZFEWLRNTOJMTT2WG24U' as const;

export const STALE_NETHERMIND_PUBLIC_KEY_REGISTRY =
  'CARXHKOPSGMUMFRDI72KNCRENVOTCJIGXPCPYOW42APDY2NEYF7CLKIL' as const;

/** Public shared XLM (native) pool — first enabled non-GVK native pool in the manifest. */
export const NETHERMIND_PUBLIC_XLM_POOL_CONTRACT =
  'CCSI25UI6P42ZZWFPHAJ44BIYFLZV2QLMJ3BBT3XHDKNM5RRHXOLB5TW' as const;

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
  asp_membership: 'CCFFZGCA7I3ZEAHNBWHQNDLU7YNEVV6ZDIJ3XCELMQAVIDYRIMOE4PQS',
  added_asp_memberships: [] as { contractId: string; deploymentLedger: number }[],
  asp_non_membership: 'CBDXUA7VT7QGZCDEJSS4WQY2VYACEEFLL4XSEKPL7GOBDKUSGCV6NA2D',
  asp_membership_wasm_hash: '44522579b5560d1aabb99abf77320963df50a3a7954a0ec12c9c7fc444d4953d',
  asp_non_membership_wasm_hash: '3c6eaf31e690605d96ca3815982a264ed14b1637d80dafdd06cc527552bf1826',
  verifiers: {
    B: 'CDNNLHL5SZPQFEBWAWUQYSJLWBYKG5U6TTNAE4PP5RO3NTLWQK57CJZA',
    B_gvk_T: 'CB35TLTKGEYH653CQCL3CKVZVKJU4TTNZJPA7DENUHVJQ7DIAFHVLKVS',
    B_gvk_V: 'CAJGVSVOIW3Q3ZKWZDPWHQDUASUOBV3ATLV5HI2M24YA5XQT7DDPCREO',
  },
  public_key_registry: 'CA5MA3LDXS4TQKBQ7SY57IHO3VMYV7G3ZJH45CWCX4QVP25IDFMZWZ3E',
  public_key_registry_verifier: 'CAK4AHQZIWC5ZTHJSSP562LF6IYZNFBAVFAL36KBAW635YD5UDA7DLUV',
  public_key_registry_verifier_wasm_hash:
    '4234d57285c2312c38e8e3b3dc6549001039bb8d1cdcd3bf7c78d710f8193003',
  pools: [
    {
      poolContractId: 'CCSI25UI6P42ZZWFPHAJ44BIYFLZV2QLMJ3BBT3XHDKNM5RRHXOLB5TW',
      tokenContractId: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
      deploymentLedger: 5557034,
      enabled: true,
      policyFlags: ['blocklist'],
      asset: { kind: 'native' as const },
    },
    {
      poolContractId: 'CAQOV7J36IJUL67YW65ZFWUP3J6M2QFQCFRULRDOVBUDAHP2YKJU5TSR',
      tokenContractId: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
      deploymentLedger: 5557039,
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
      poolContractId: 'CCIR7H5EU6L7MIUSK2GX2FLRPUDCGIDWSKHXFVEIURHLEMFKKP5HRWDA',
      tokenContractId: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
      deploymentLedger: 5557045,
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
      poolContractId: 'CC62LI4F2DV4PIY45T7KQYYXEV2NU5DD63XHA4KXWPBKZ2AJOWAI4REW',
      tokenContractId: 'CCUUDM434BMZMYWYDITHFXHDMIVTGGD6T2I5UKNX5BSLXLW7HVR4MCGZ',
      deploymentLedger: 5557050,
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
