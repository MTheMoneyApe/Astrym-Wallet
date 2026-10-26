/**
 * Validate an evidence JSON file (non-destructive).
 * Usage: node evidence/validate-evidence-cli.mjs path/to/export.json
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateEvidenceReport } from './validateEvidence.mjs';

const path = process.argv[2];
if (!path) {
  console.error('Usage: node evidence/validate-evidence-cli.mjs <evidence.json>');
  process.exit(2);
}
const abs = resolve(path);
const evidence = JSON.parse(readFileSync(abs, 'utf8'));
const report = validateEvidenceReport(evidence);
console.log(JSON.stringify({ file: abs, ...report }, null, 2));
process.exit(report.ok ? 0 : 1);
