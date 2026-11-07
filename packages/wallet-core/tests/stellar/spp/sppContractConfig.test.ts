import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Keypair, StrKey } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import {
  findEnabledPoolContract,
  parseSppContractConfig,
  tokenContractIdForEnabledPool,
} from '../../../src/stellar/spp/sppContractConfig.js';
import {
  classifySppDeploymentOwnership,
  compareCircuitFingerprints,
  getNethermindPublicTestnetContractConfig,
  NETHERMIND_PUBLIC_KDF_DOMAIN,
  NETHERMIND_PUBLIC_TESTNET_CIRCUITS_SHA256,
  NETHERMIND_PUBLIC_TESTNET_DEPLOYMENTS,
  NETHERMIND_PUBLIC_TESTNET_DEPLOYMENTS_SHA256,
  NETHERMIND_PUBLIC_XLM_POOL_CONTRACT,
  STALE_NETHERMIND_PUBLIC_KEY_REGISTRY,
  STALE_NETHERMIND_PUBLIC_XLM_POOL_CONTRACT,
  resolveNethermindPublicXlmPool,
  resolveSppBootnodeUrl,
} from '../../../src/stellar/spp/nethermind/nethermindPublicTestnet.js';

function C(): string {
  return StrKey.encodeContract(Keypair.random().rawPublicKey());
}

function G(): string {
  return Keypair.random().publicKey();
}

describe('parseSppContractConfig', () => {
  it('rejects lab placeholders and incomplete shapes', () => {
    expect(() => parseSppContractConfig({ labPlaceholder: true })).toThrow(/labPlaceholder/);
    expect(() => parseSppContractConfig({})).toThrow();
  });

  it('accepts a complete ContractConfigInput and finds enabled pools', () => {
    const pool = C();
    const token = C();
    const cfg = parseSppContractConfig({
      network: 'testnet',
      networkPassphrase: 'Test SDF Network ; September 2015',
      rpcUrl: 'https://soroban-testnet.stellar.org',
      kdf_domain: 'example-kdf',
      deployer: G(),
      admin: G(),
      asp_membership: C(),
      asp_non_membership: C(),
      public_key_registry: C(),
      verifiers: { policy_tx_2_2: C() },
      pools: [
        {
          poolContractId: pool,
          tokenContractId: token,
          deploymentLedger: 1,
          enabled: true,
          asset: { kind: 'native' },
        },
      ],
    });
    expect(cfg.pools[0]?.poolContractId).toBe(pool);
    expect(findEnabledPoolContract(cfg)).toBe(pool);
    expect(findEnabledPoolContract(cfg, pool)).toBe(pool);
  });

  it('preserves gvkAuthorityPubKey for GVK pools (SDK-required field)', () => {
    const pool = C();
    const token = C();
    const gvk = {
      x: '0x0963f68aeb1663a54b57abb8bf099cdec33bed62108b084319109bd8ba85167b',
      y: '0x1fea09b90e87da009b0a922da0475cbb8d5dd900b915799f877d9cfeb82e20ab',
    };
    const cfg = parseSppContractConfig({
      network: 'testnet',
      kdf_domain: 'Nethermind',
      deployer: G(),
      admin: G(),
      asp_membership: C(),
      asp_non_membership: C(),
      public_key_registry: C(),
      verifiers: { B_gvk_T: C() },
      pools: [
        {
          poolContractId: pool,
          tokenContractId: token,
          deploymentLedger: 1,
          enabled: true,
          gvkMode: 'traceable',
          gvkAuthorityPubKey: gvk,
          asset: { kind: 'native' },
        },
      ],
    });
    expect(cfg.pools[0]?.gvkMode).toBe('traceable');
    expect(cfg.pools[0]?.gvkAuthorityPubKey).toEqual(gvk);
  });

  it('rejects malformed gvkAuthorityPubKey objects', () => {
    expect(() =>
      parseSppContractConfig({
        network: 'testnet',
        kdf_domain: 'Nethermind',
        deployer: G(),
        admin: G(),
        asp_membership: C(),
        asp_non_membership: C(),
        public_key_registry: C(),
        verifiers: { B: C() },
        pools: [
          {
            poolContractId: C(),
            tokenContractId: C(),
            deploymentLedger: 1,
            enabled: true,
            gvkAuthorityPubKey: 'not-an-object',
            asset: { kind: 'native' },
          },
        ],
      }),
    ).toThrow(/gvkAuthorityPubKey/);
  });
});

describe('Nethermind public Testnet pin', () => {
  it('parses the pinned official manifest and resolves the public XLM pool', () => {
    const cfg = getNethermindPublicTestnetContractConfig();
    expect(cfg.kdf_domain).toBe(NETHERMIND_PUBLIC_KDF_DOMAIN);
    expect(cfg.networkPassphrase).toBe('Test SDF Network ; September 2015');
    expect(resolveNethermindPublicXlmPool(cfg)).toBe(NETHERMIND_PUBLIC_XLM_POOL_CONTRACT);
    expect(findEnabledPoolContract(cfg, NETHERMIND_PUBLIC_XLM_POOL_CONTRACT)).toBe(
      NETHERMIND_PUBLIC_XLM_POOL_CONTRACT,
    );
    const gvkPool = cfg.pools.find((p) => p.gvkMode === 'traceable');
    expect(gvkPool?.gvkAuthorityPubKey).toEqual({
      x: '0x0963f68aeb1663a54b57abb8bf099cdec33bed62108b084319109bd8ba85167b',
      y: '0x1fea09b90e87da009b0a922da0475cbb8d5dd900b915799f877d9cfeb82e20ab',
    });
  });

  it('matches the on-disk testnet-deployments.json bytes (no invented values)', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const pinnedPath = join(
      here,
      '../../../src/stellar/spp/nethermind/testnet-deployments.json',
    );
    const raw = readFileSync(pinnedPath);
    expect(createHash('sha256').update(raw).digest('hex')).toBe(
      NETHERMIND_PUBLIC_TESTNET_DEPLOYMENTS_SHA256,
    );
    const fromDisk = JSON.parse(raw.toString('utf8')) as unknown;
    const fromPin = parseSppContractConfig(fromDisk);
    const fromConst = parseSppContractConfig(NETHERMIND_PUBLIC_TESTNET_DEPLOYMENTS);
    expect(fromConst.pools.map((p) => p.poolContractId)).toEqual(
      fromPin.pools.map((p) => p.poolContractId),
    );
    expect(fromConst.admin).toBe(fromPin.admin);
    expect(fromConst.kdf_domain).toBe(fromPin.kdf_domain);
  });

  it('rejects the previous Testnet deployment and matches the circuits lock hash', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const circuitsPath = join(here, '../../../src/stellar/spp/nethermind/testnet-circuits.json');
    const raw = readFileSync(circuitsPath);
    expect(createHash('sha256').update(raw).digest('hex')).toBe(
      NETHERMIND_PUBLIC_TESTNET_CIRCUITS_SHA256,
    );
    const config = getNethermindPublicTestnetContractConfig();
    expect(config.public_key_registry).not.toBe(STALE_NETHERMIND_PUBLIC_KEY_REGISTRY);
    expect(() => tokenContractIdForEnabledPool(config, STALE_NETHERMIND_PUBLIC_XLM_POOL_CONTRACT))
      .toThrow(/No enabled pool/);
  });

  it('classifies Nethermind public vs Astrym-owned vs custom', () => {
    const nethermind = getNethermindPublicTestnetContractConfig();
    expect(classifySppDeploymentOwnership({ config: nethermind }).ownership).toBe(
      'nethermind_public',
    );

    const astrym = parseSppContractConfig({
      ...nethermind,
      kdf_domain: 'Astrym',
      admin: G(),
      deployer: G(),
    });
    expect(classifySppDeploymentOwnership({ config: astrym }).ownership).toBe('astrym_owned');

    const custom = parseSppContractConfig({
      ...nethermind,
      kdf_domain: 'OtherOperator',
      admin: G(),
    });
    expect(classifySppDeploymentOwnership({ config: custom }).ownership).toBe('custom');
  });
});

describe('circuit fingerprint compatibility', () => {
  it('matches packaged extension circuits against pinned Nethermind testnet circuits.json', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const packagedPath = join(
      here,
      '../../../../extension/public/spp/dist/circuits/circuits.json',
    );
    const upstreamPath = join(
      here,
      '../../../src/stellar/spp/nethermind/testnet-circuits.json',
    );
    const packaged = JSON.parse(readFileSync(packagedPath, 'utf8')) as Record<string, unknown>;
    const upstream = JSON.parse(readFileSync(upstreamPath, 'utf8')) as Record<string, unknown>;
    const result = compareCircuitFingerprints(packaged, upstream);
    expect(result.mismatched).toEqual([]);
    expect(result.matched.length).toBe(16);
    expect(result.upstreamOnly).toEqual(['keyOwnership']);
    // Meta version may differ (0.6 packaged / 0.7 upstream) while hashes match.
    expect(result.packagedVersion).toBe('0.6');
    expect(result.upstreamVersion).toBe('0.7');
  });

  it('reports matched fingerprints and upstream-only circuits', () => {
    const packaged = {
      version: '0.6',
      meta: { commit: 'a' },
      policy_tx_2_2_B: { r1cs: 'aa', 'graph.bin': 'bb', 'proving_key.bin': 'cc' },
    };
    const upstream = {
      version: '0.7',
      meta: { commit: 'b' },
      policy_tx_2_2_B: { r1cs: 'aa', 'graph.bin': 'bb', 'proving_key.bin': 'cc' },
      keyOwnership: { r1cs: 'zz', 'graph.bin': 'yy', 'proving_key.bin': 'xx' },
    };
    const result = compareCircuitFingerprints(packaged, upstream);
    expect(result.matched).toEqual(['policy_tx_2_2_B']);
    expect(result.mismatched).toEqual([]);
    expect(result.upstreamOnly).toEqual(['keyOwnership']);
    expect(result.packagedVersion).toBe('0.6');
    expect(result.upstreamVersion).toBe('0.7');
  });

  it('flags mismatched circuit hashes as incompatible', () => {
    const packaged = {
      version: '0.6',
      meta: {},
      policy_tx_2_2_B: { r1cs: 'aa' },
    };
    const upstream = {
      version: '0.7',
      meta: {},
      policy_tx_2_2_B: { r1cs: 'DIFFERENT' },
    };
    expect(compareCircuitFingerprints(packaged, upstream).mismatched).toEqual([
      'policy_tx_2_2_B',
    ]);
  });
});

describe('bootnode readiness policy', () => {
  it('allows missing bootnode when not required', () => {
    const result = resolveSppBootnodeUrl({ bootnodeRequired: false });
    expect(result.ok).toBe(true);
    expect(result.bootnodeUrl).toBeNull();
  });

  it('fails closed when bootnodeRequired and no URL configured', () => {
    const result = resolveSppBootnodeUrl({
      bootnodeRequired: true,
      configuredBootnodeUrl: null,
    });
    expect(result.ok).toBe(false);
    expect(result.bootnodeUrl).toBeNull();
    expect(result.message).toMatch(/bootnodeRequired/i);
  });

  it('accepts operator-supplied bootnode when required', () => {
    const result = resolveSppBootnodeUrl({
      bootnodeRequired: true,
      configuredBootnodeUrl: 'https://bootnode.example/spp',
    });
    expect(result.ok).toBe(true);
    expect(result.bootnodeUrl).toBe('https://bootnode.example/spp');
  });
});
