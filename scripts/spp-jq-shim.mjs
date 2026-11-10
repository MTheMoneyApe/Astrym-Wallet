#!/usr/bin/env node
// Subset of jq used by upstream deployments/scripts/circuit-artifacts.sh.
// Supports: jq -r '.version // empty' FILE
// and:      jq -r --arg obj O --arg key K '.[$obj][$key] // empty' FILE
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
let raw = false;
const vars = {};
const positionals = [];
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '-r') {
    raw = true;
    continue;
  }
  if (arg === '--arg') {
    vars[args[i + 1]] = args[i + 2];
    i += 2;
    continue;
  }
  positionals.push(arg);
}
const program = positionals[0];
const file = positionals[1];
if (!program || !file) {
  console.error('spp-jq-shim: unsupported invocation');
  process.exit(2);
}
const data = JSON.parse(readFileSync(file, 'utf8'));
let value;
if (program === '.version // empty') {
  value = data.version;
} else if (program === '.[$obj][$key] // empty') {
  value = data?.[vars.obj]?.[vars.key];
} else {
  console.error(`spp-jq-shim: unsupported program ${program}`);
  process.exit(2);
}
if (value === undefined || value === null) {
  if (!raw) process.stdout.write('null\n');
  process.exit(0);
}
process.stdout.write(raw ? `${value}\n` : `${JSON.stringify(value)}\n`);
