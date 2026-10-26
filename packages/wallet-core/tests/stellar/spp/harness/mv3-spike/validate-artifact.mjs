/**
 * Fase 2.36 — Non-destructive static validation of the unpacked spike artifact.
 * Does not launch Chrome. Exit 0 = artifact structurally ready for operator.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateBrokerRequest, BROKER_V, mintRequestId } from './broker/envelope.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const failures = [];
const warnings = [];

function ok(cond, msg) {
  if (!cond) failures.push(msg);
}

function warn(cond, msg) {
  if (!cond) warnings.push(msg);
}

const manifest = JSON.parse(readFileSync(join(__dirname, 'manifest.json'), 'utf8'));
ok(manifest.manifest_version === 3, 'manifest_version must be 3');
ok(manifest.version === '0.0.36', `artifact version expected 0.0.36, got ${manifest.version}`);
ok(
  Array.isArray(manifest.host_permissions) &&
    manifest.host_permissions.length === 1 &&
    manifest.host_permissions[0] === 'http://127.0.0.1:8765/*',
  'host_permissions must be exactly loopback 8765',
);
ok(
  !JSON.stringify(manifest.permissions || []).includes('debugger'),
  'must not request debugger',
);
ok(
  typeof manifest.content_security_policy?.extension_pages === 'string' &&
    manifest.content_security_policy.extension_pages.includes("wasm-unsafe-eval") &&
    manifest.content_security_policy.extension_pages.includes('connect-src'),
  'CSP extension_pages must include wasm-unsafe-eval and connect-src',
);

const bg = readFileSync(join(__dirname, 'background.js'), 'utf8');
ok(!/stellar-private-payments/.test(bg), 'background.js must not reference stellar-private-payments');
ok(!/Storage\.open|Client\.new/.test(bg), 'background.js must not call Storage.open/Client.new');
ok(bg.includes('validateBrokerRequest'), 'background.js must validate envelopes');

const host = readFileSync(join(__dirname, 'host/spp-ro1-host.mjs'), 'utf8');
ok(!/seedPhrase|privateKey|SoftwareSigner|VaultService|ChromeAccountStorage/i.test(host), 'host must not touch vault/keys APIs');
ok(host.includes('rpc-ro1'), 'host must use rpc-ro1');
ok(host.includes('vaultAccess: false'), 'host must declare vaultAccess false');

const vendorMetaPath = join(__dirname, 'vendor/VENDOR_META.json');
warn(existsSync(vendorMetaPath), 'vendor/ missing — run node prepare-vendor.mjs before Chrome load');
if (existsSync(vendorMetaPath)) {
  const meta = JSON.parse(readFileSync(vendorMetaPath, 'utf8'));
  ok(meta.version === '0.2.1', `vendor version must be 0.2.1, got ${meta.version}`);
  ok(existsSync(join(__dirname, 'vendor/dist/workers/storage-worker.js')), 'storage-worker missing');
  ok(existsSync(join(__dirname, 'vendor/dist/workers/prover-worker.js')), 'prover-worker missing');
}

// Envelope unit checks (Node)
const good = validateBrokerRequest({
  v: BROKER_V,
  kind: 'req',
  sessionId: 's1',
  requestId: mintRequestId(),
  type: 'RO1_PING',
});
ok(good.ok === true, 'valid RO1_PING must pass');

const badType = validateBrokerRequest({
  v: BROKER_V,
  kind: 'req',
  sessionId: 's1',
  requestId: mintRequestId(),
  type: 'HACK',
});
ok(badType.ok === false && badType.code === 'UNKNOWN_METHOD', 'unknown type must fail');

const badDispatch = validateBrokerRequest({
  v: BROKER_V,
  kind: 'req',
  sessionId: 's1',
  requestId: mintRequestId(),
  type: 'RO1_DISPATCH',
  method: 'Client.sync',
  args: {},
});
ok(badDispatch.ok === false, 'Client.sync dispatch must fail');

const extra = validateBrokerRequest({
  v: BROKER_V,
  kind: 'req',
  sessionId: 's1',
  requestId: mintRequestId(),
  type: 'RO1_PING',
  evil: 1,
});
ok(extra.ok === false && extra.code === 'EXTRA_FIELD', 'extra field must fail');

const prodTouch = [bg, host].join('\n');
ok(!/packages\/extension/.test(prodTouch), 'spike must not reference packages/extension');
ok(!/ChromeAccountStorage|VaultService|SoftwareSigner/.test(prodTouch), 'spike must not import wallet vault/signer symbols');

const report = {
  ok: failures.length === 0,
  artifactVersion: manifest.version,
  failures,
  warnings,
  chromeDesktop: 'NOT_RUN_BY_THIS_SCRIPT',
  files: readdirSync(__dirname).filter((n) => !n.startsWith('.') && n !== 'vendor'),
};

console.log(JSON.stringify(report, null, 2));
process.exit(failures.length === 0 ? 0 : 1);
