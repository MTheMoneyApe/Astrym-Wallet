import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { assertNymMixfetchDestinationSafe } from '../../scripts/nym-mixfetch-destination-safety.mjs';

const ASSET_FILES = [
  'index.js',
  'web-worker-0.js',
  'go_conn.wasm',
  'mix_fetch_wasm_bg.wasm',
  'package.json',
];
const META_NAME = 'NYM_MIXFETCH_ASSET_META.json';
const EXPECTED_META = {
  managedBy: 'solanym-extension-copy-nym-mixfetch-assets',
  package: '@nymproject/mix-fetch',
  version: '1.4.2',
};
const tempDirs: string[] = [];

function createDestination() {
  const root = mkdtempSync(join(tmpdir(), 'nym-mixfetch-copy-test-'));
  tempDirs.push(root);
  const metadata = { ...EXPECTED_META, files: ASSET_FILES };
  for (const file of ASSET_FILES) {
    writeFileSync(join(root, file), `managed:${file}`);
  }
  writeFileSync(join(root, META_NAME), JSON.stringify(metadata));
  return root;
}

function assertSafe(destination: string) {
  assertNymMixfetchDestinationSafe(destination, {
    files: ASSET_FILES,
    metaName: META_NAME,
    managedBy: EXPECTED_META.managedBy,
    packageName: EXPECTED_META.package,
    version: EXPECTED_META.version,
  });
}

function snapshot(destination: string) {
  return [...ASSET_FILES, META_NAME]
    .map((file) => [file, readFileSync(join(destination, file), 'utf8')])
    .concat(
      ['manual.txt'].flatMap((file) => {
        try {
          return [[file, readFileSync(join(destination, file), 'utf8')]];
        } catch {
          return [];
        }
      }),
    );
}

afterEach(() => {
  while (tempDirs.length) {
    const directory = tempDirs.pop();
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});

describe('Nym mix-fetch destination safety', () => {
  it('accepts a complete managed destination', () => {
    expect(() => assertSafe(createDestination())).not.toThrow();
  });

  it('aborts on an unexpected file without changing the destination', () => {
    const destination = createDestination();
    writeFileSync(join(destination, 'manual.txt'), 'preserve me');
    const before = snapshot(destination);

    expect(() => assertSafe(destination)).toThrow(/manual\.txt \(unexpected file\)/);
    expect(snapshot(destination)).toEqual(before);
  });

  it('aborts on an unexpected directory', () => {
    const destination = createDestination();
    mkdirSync(join(destination, 'manual-directory'));

    expect(() => assertSafe(destination)).toThrow(
      /manual-directory \(unexpected directory\)/,
    );
  });

  it('fails closed when metadata is missing or invalid', () => {
    const missingMetadata = createDestination();
    rmSync(join(missingMetadata, META_NAME));
    expect(() => assertSafe(missingMetadata)).toThrow(/missing .*NYM_MIXFETCH_ASSET_META\.json/);

    const invalidMetadata = createDestination();
    writeFileSync(join(invalidMetadata, META_NAME), '{invalid');
    expect(() => assertSafe(invalidMetadata)).toThrow(/Cannot read valid NYM_MIXFETCH_ASSET_META\.json/);
  });

  it('fails closed when metadata lists an unexpected inventory', () => {
    const destination = createDestination();
    writeFileSync(
      join(destination, META_NAME),
      JSON.stringify({ ...EXPECTED_META, files: [...ASSET_FILES, 'other.js'] }),
    );

    expect(() => assertSafe(destination)).toThrow(/expected managed Nym asset inventory/);
  });

  it('allows repeated checks of an unchanged managed destination', () => {
    const destination = createDestination();
    const before = snapshot(destination);

    expect(() => assertSafe(destination)).not.toThrow();
    expect(() => assertSafe(destination)).not.toThrow();
    expect(snapshot(destination)).toEqual(before);
  });
});
