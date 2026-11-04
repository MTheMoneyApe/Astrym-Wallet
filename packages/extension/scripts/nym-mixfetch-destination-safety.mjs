import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

function fail(message) {
  throw new Error(`[copy-nym-mixfetch-assets] ${message}`);
}

function toPosix(path) {
  return path.split(sep).join('/');
}

export function assertNymMixfetchDestinationSafe(
  destination,
  { files, metaName, managedBy, packageName, version },
) {
  let rootStats;
  try {
    rootStats = lstatSync(destination);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }

  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    fail(`Destination is not a regular directory: ${destination}`);
  }

  const expectedFiles = [...files, metaName];
  const expectedFileSet = new Set(expectedFiles);
  if (expectedFileSet.size !== expectedFiles.length) {
    fail('Configured Nym asset inventory contains duplicate paths.');
  }

  const metaPath = join(destination, metaName);
  let metaStats;
  try {
    metaStats = lstatSync(metaPath);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      fail(`Destination is missing ${metaName}; refusing to replace unverified content.`);
    }
    throw error;
  }
  if (!metaStats.isFile() || metaStats.isSymbolicLink()) {
    fail(`${metaName} must be a regular file; refusing to replace destination.`);
  }

  let meta;
  try {
    meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  } catch (error) {
    fail(`Cannot read valid ${metaName}: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (
    meta?.managedBy !== managedBy ||
    meta?.package !== packageName ||
    meta?.version !== version ||
    !Array.isArray(meta?.files) ||
    meta.files.length !== files.length ||
    meta.files.some((file, index) => file !== files[index])
  ) {
    fail(`${metaName} does not match the expected managed Nym asset inventory; refusing to replace destination.`);
  }

  const actualFiles = new Set();
  const unexpectedEntries = [];

  function inspectDirectory(directory) {
    for (const name of readdirSync(directory)) {
      const fullPath = join(directory, name);
      const relativePath = toPosix(relative(destination, fullPath));
      const stats = lstatSync(fullPath);

      if (stats.isSymbolicLink()) {
        unexpectedEntries.push(`${relativePath} (symbolic link)`);
      } else if (stats.isDirectory()) {
        const hasExpectedChild = [...expectedFileSet].some((file) =>
          file.startsWith(`${relativePath}/`),
        );
        if (!hasExpectedChild) {
          unexpectedEntries.push(`${relativePath} (unexpected directory)`);
        } else {
          inspectDirectory(fullPath);
        }
      } else if (stats.isFile()) {
        actualFiles.add(relativePath);
        if (!expectedFileSet.has(relativePath)) {
          unexpectedEntries.push(`${relativePath} (unexpected file)`);
        }
      } else {
        unexpectedEntries.push(`${relativePath} (unsupported filesystem entry)`);
      }
    }
  }

  inspectDirectory(destination);

  const missingFiles = expectedFiles.filter((file) => !actualFiles.has(file));
  if (unexpectedEntries.length > 0 || missingFiles.length > 0) {
    const details = [
      ...unexpectedEntries.map((entry) => `  - ${entry}`),
      ...missingFiles.map((file) => `  - ${file} (missing managed file)`),
    ];
    fail(
      `Destination does not match its managed inventory; refusing to replace it:\n${details.join('\n')}`,
    );
  }
}
