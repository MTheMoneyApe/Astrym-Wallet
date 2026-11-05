/**
 * Load packaged circuitLock and probe proving-key artifacts.
 * Never invents hashes — uses circuits.json fingerprints and HTTP / on-disk presence checks.
 */

export type SppCircuitLock = {
  version: string;
  meta: Record<string, unknown>;
  [circuitId: string]: unknown;
};

export type SppProvingKeyProbeResult =
  | { ok: true; circuitIds: string[]; lock: SppCircuitLock }
  | {
      ok: false;
      reason: 'missing_lock' | 'invalid_lock' | 'missing_proving_keys';
      message: string;
      missing: string[];
      circuitIds: string[];
      lock: SppCircuitLock | null;
    };

/** Artifact kinds required beside each circuit fingerprint in circuits.json. */
export const SPP_CIRCUIT_ARTIFACT_SUFFIXES = ['.r1cs', '.graph.bin', '_proving_key.bin'] as const;

/**
 * stellar-private-payments@0.2.1 ships 16 Groth16 circuit bundles
 * (12 policy_tx_* + 4 selectiveDisclosure_*). Used as a readiness floor — never invent IDs.
 */
export const SPP_PACKAGED_CIRCUIT_COUNT_0_2_1 = 16;

function isCircuitEntry(value: unknown): value is {
  r1cs?: string;
  'graph.bin'?: string;
  'proving_key.bin'?: string;
} {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function listCircuitIds(lock: SppCircuitLock): string[] {
  return Object.keys(lock).filter((key) => key !== 'version' && key !== 'meta' && isCircuitEntry(lock[key]));
}

/** Relative artifact file names for one circuit id (`id.r1cs`, `id.graph.bin`, `id_proving_key.bin`). */
export function listCircuitArtifactNames(circuitId: string): string[] {
  return SPP_CIRCUIT_ARTIFACT_SUFFIXES.map((suffix) => `${circuitId}${suffix}`);
}

export function parseCircuitLock(raw: unknown): SppCircuitLock {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('circuitLock must be a non-null object');
  }
  const lock = raw as Record<string, unknown>;
  if (lock['labPlaceholder'] === true) {
    throw new Error('Rejecting labPlaceholder circuitLock — load packaged circuits.json');
  }
  if (typeof lock['version'] !== 'string' || !lock['version'].trim()) {
    throw new Error('circuitLock.version must be a non-empty string');
  }
  if (!lock['meta'] || typeof lock['meta'] !== 'object' || Array.isArray(lock['meta'])) {
    throw new Error('circuitLock.meta must be an object');
  }
  const ids = Object.keys(lock).filter(
    (key) => key !== 'version' && key !== 'meta' && isCircuitEntry(lock[key]),
  );
  if (ids.length === 0) {
    throw new Error('circuitLock has no circuit fingerprint entries');
  }
  return lock as SppCircuitLock;
}

/**
 * Join a circuitsBaseUrl with a relative artifact name.
 * Supports chrome-extension://… and path-absolute same-origin bases (`/spp/…`)
 * used by the Android webapp chrome.runtime.getURL shim. `new URL(rel, '/spp/')`
 * throws "Invalid base URL" — never use the URL constructor for bare paths.
 */
export function resolveCircuitArtifactUrl(circuitsBaseUrl: string, relativePath: string): string {
  const base = circuitsBaseUrl.endsWith('/') ? circuitsBaseUrl : `${circuitsBaseUrl}/`;
  const rel = relativePath.replace(/^\//, '');
  if (base.startsWith('/') && !base.startsWith('//')) {
    return `${base}${rel}`;
  }
  return new URL(rel, base).href;
}

export async function loadCircuitLockFromBaseUrl(
  circuitsBaseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SppCircuitLock> {
  const response = await fetchImpl(resolveCircuitArtifactUrl(circuitsBaseUrl, 'circuits.json'), {
    method: 'GET',
  });
  if (!response.ok) {
    throw new Error(`Failed to load circuits.json (${response.status})`);
  }
  return parseCircuitLock(await response.json());
}

function missingProvingKeysResult(
  missing: string[],
  circuitIds: string[],
  lock: SppCircuitLock,
): SppProvingKeyProbeResult {
  return {
    ok: false,
    reason: 'missing_proving_keys',
    message: `Faltan ${missing.length} artefactos de circuito (proving keys / r1cs / graph).`,
    missing: missing.slice(0, 24),
    circuitIds,
    lock,
  };
}

/**
 * Verify proving-key / graph / r1cs artifacts exist under circuitsBaseUrl.
 * Uses HEAD when available, falls back to ranged GET.
 */
export async function probeSppProvingKeys(input: {
  circuitsBaseUrl: string;
  lock: SppCircuitLock;
  fetchImpl?: typeof fetch;
}): Promise<SppProvingKeyProbeResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const circuitIds = listCircuitIds(input.lock);
  const missing: string[] = [];

  for (const id of circuitIds) {
    for (const artifact of listCircuitArtifactNames(id)) {
      const url = resolveCircuitArtifactUrl(input.circuitsBaseUrl, artifact);
      let present = false;
      try {
        const head = await fetchImpl(url, { method: 'HEAD' });
        if (head.ok) {
          present = true;
        } else if (head.status === 405 || head.status === 501) {
          const get = await fetchImpl(url, {
            method: 'GET',
            headers: { Range: 'bytes=0-0' },
          });
          present = get.ok || get.status === 206;
        }
      } catch {
        present = false;
      }
      if (!present) missing.push(artifact);
    }
  }

  if (missing.length > 0) {
    return missingProvingKeysResult(missing, circuitIds, input.lock);
  }

  return { ok: true, circuitIds, lock: input.lock };
}

/**
 * Node/fs probe for packaged circuit artifacts (no HTTP).
 * `existsSync` must be supplied by the caller (keeps this module DOM-safe).
 */
export function probeSppProvingKeysOnDisk(input: {
  circuitsDir: string;
  lock: SppCircuitLock;
  existsSync: (path: string) => boolean;
  joinPath?: (...parts: string[]) => string;
}): SppProvingKeyProbeResult {
  const joinPath =
    input.joinPath ??
    ((...parts: string[]) => parts.join('/').replace(/\/{2,}/g, '/'));
  const circuitIds = listCircuitIds(input.lock);
  const missing: string[] = [];
  const base = input.circuitsDir.replace(/\/+$/, '');

  for (const id of circuitIds) {
    for (const artifact of listCircuitArtifactNames(id)) {
      if (!input.existsSync(joinPath(base, artifact))) {
        missing.push(artifact);
      }
    }
  }

  if (missing.length > 0) {
    return missingProvingKeysResult(missing, circuitIds, input.lock);
  }

  return { ok: true, circuitIds, lock: input.lock };
}
