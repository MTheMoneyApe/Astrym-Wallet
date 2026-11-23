/**
 * Fail closed unless a canonical SPP artifact matches the versioned manifest.
 * A missing directory, missing file, or hash/size mismatch is fatal.
 * This module never compiles wasm and never returns a fallback.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export class CanonicalArtifactError extends Error {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(message);
    this.name = 'CanonicalArtifactError';
  }
}

/**
 * @param {string} filePath
 * @param {string} label
 */
function readJson(filePath, label) {
  let raw;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new CanonicalArtifactError(
      `canonical SPP artifact ${label} is unreadable (${detail}); refusing to compile`,
    );
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new CanonicalArtifactError(
      `canonical SPP artifact ${label} is not JSON (${detail}); refusing to compile`,
    );
  }
}

/**
 * @param {string} name
 */
function assertArtifactFileName(name) {
  if (typeof name !== 'string' || name.length === 0) return false;
  if (name.includes('/') || name.includes('\\') || name.includes('..')) return false;
  if (name === '.' || name === '..') return false;
  return true;
}

/**
 * @param {string} artifactDir
 * @param {{ sourceCommit?: string, files?: Record<string, { sha256?: string, size?: number }> }} manifest
 * @returns {true}
 */
export function verifyCanonicalArtifact(artifactDir, manifest) {
  if (typeof artifactDir !== 'string' || artifactDir.length === 0 || !existsSync(artifactDir)) {
    throw new CanonicalArtifactError(
      `canonical SPP artifact is missing: ${artifactDir}; refusing to compile`,
    );
  }
  const artifactStat = statSync(artifactDir);
  if (!artifactStat.isDirectory()) {
    throw new CanonicalArtifactError(
      `canonical SPP artifact is missing: ${artifactDir}; refusing to compile`,
    );
  }
  if (!manifest || typeof manifest !== 'object' || typeof manifest.sourceCommit !== 'string') {
    throw new CanonicalArtifactError(
      'versioned SPP manifest is missing sourceCommit; refusing to compile',
    );
  }
  const pinned = manifest.files;
  if (!pinned || typeof pinned !== 'object' || Array.isArray(pinned)) {
    throw new CanonicalArtifactError('versioned SPP manifest has no file pins; refusing to compile');
  }

  const indexPath = join(artifactDir, 'canonical-artifact.json');
  if (!existsSync(indexPath)) {
    throw new CanonicalArtifactError(
      `canonical SPP artifact is missing: ${indexPath}; refusing to compile`,
    );
  }
  const index = readJson(indexPath, 'index');
  if (index.sourceCommit !== manifest.sourceCommit) {
    throw new CanonicalArtifactError(
      'canonical SPP artifact sourceCommit does not match the manifest; refusing to compile',
    );
  }
  const files = index.files;
  if (!files || typeof files !== 'object' || Array.isArray(files) || Object.keys(files).length === 0) {
    throw new CanonicalArtifactError(
      'canonical SPP artifact index has no files; refusing to compile',
    );
  }

  /** @type {string[]} */
  const problems = [];
  for (const [rel, name] of Object.entries(files)) {
    if (!assertArtifactFileName(name)) {
      problems.push(`invalid artifact file name for ${rel}`);
      continue;
    }
    const expect = pinned[rel];
    if (!expect || typeof expect.sha256 !== 'string' || typeof expect.size !== 'number') {
      problems.push(`unpinned ${rel}; refusing to compile`);
      continue;
    }
    const filePath = join(artifactDir, name);
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      problems.push(`missing ${rel}; refusing to compile`);
      continue;
    }
    const data = readFileSync(filePath);
    const sha256 = createHash('sha256').update(data).digest('hex');
    if (sha256 !== expect.sha256 || data.length !== expect.size) {
      problems.push(
        `hash mismatch ${rel}: got ${sha256} ${data.length} expected ${expect.sha256} ${expect.size}`,
      );
    }
  }
  if (problems.length > 0) {
    throw new CanonicalArtifactError(
      `canonical SPP artifact failed pin verification; refusing to compile\n${problems.join('\n')}`,
    );
  }
  return true;
}

function failClosed(message) {
  console.error(`verify-spp-canonical-artifact: ${message}`);
  process.exit(1);
}

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  let artifact = '';
  let manifest = '';
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--artifact') {
      artifact = argv[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (arg === '--manifest') {
      manifest = argv[index + 1] ?? '';
      index += 1;
      continue;
    }
    throw new CanonicalArtifactError(`unknown argument ${arg}; refusing to compile`);
  }
  if (artifact.length === 0 || manifest.length === 0) {
    throw new CanonicalArtifactError(
      'usage: node scripts/verify-spp-canonical-artifact.mjs --artifact DIR --manifest FILE',
    );
  }
  return { artifact, manifest };
}

const entry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (entry && import.meta.url === entry) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (!existsSync(args.manifest)) {
      failClosed(`versioned SPP manifest is missing: ${args.manifest}; refusing to compile`);
    }
    const manifest = readJson(args.manifest, 'manifest');
    verifyCanonicalArtifact(args.artifact, manifest);
    const index = readJson(join(args.artifact, 'canonical-artifact.json'), 'index');
    console.log(
      `ok canonical SPP artifact ${args.artifact} (${Object.keys(index.files).length} pinned files)`,
    );
  } catch (error) {
    failClosed(error instanceof Error ? error.message : String(error));
  }
}
