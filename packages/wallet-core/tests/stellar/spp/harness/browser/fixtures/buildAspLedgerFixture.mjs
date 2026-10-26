/**
 * Offline generator for synthetic getLedgerEntries fixtures (Fase 2.9 / 2.12).
 *
 * Authority: stellar-private-payments@0.2.1 / commit b79107cd…
 *   - rpc.rs build_contract_data_key_specs: DataKey unit = Vec([Symbol(name)])
 *   - contract_state.rs asp_state: Admin → Address, NextIndex → U64;
 *     Levels → U32, Root → U256 (from instance storage via instance_storage_entries)
 *   - contract_state.rs pool_request: enum_keys Admin + State
 *   - contract_state.rs pool_info instance keys: Levels, MaximumDepositAmount,
 *     Token, Verifier, ASPMembership, ASPNonMembership, PolicyFlags
 *     (DepositsPaused / AdminViewKey / GvkMode optional — omitted = non-GVK pool)
 *   - conversions.rs scval_to_tree_state: Map with Symbol keys next_index (U64),
 *     roots (Vec<U256>); filled_subtrees ignored
 *   - conversions.rs instance_storage_entries: map keys must be one-symbol Vec
 *
 * Uses existing workspace dependency @stellar/stellar-sdk only. No network.
 *
 * Run: node fixtures/buildAspLedgerFixture.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Address, nativeToScVal, xdr } from '@stellar/stellar-sdk';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Must match synthetic-contract-config.json. */
const SYNTH_ADMIN_G = 'GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6';
const ASP_MEMBERSHIP = 'CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526';
const ASP_NON_MEMBERSHIP = 'CABAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAFNSZ';
const POOL = 'CACQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQLC2U';
const TOKEN = 'CADAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMSST';
const VERIFIER = 'CABQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGCK3';

const LATEST_LEDGER = 1000;
const LAST_MODIFIED = 1000;

/** Unit DataKey variant: Vec([Symbol(name)]) — rpc.rs symbol_key / build_contract_data_key_specs. */
function unitDataKey(name) {
  return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(name)]);
}

function contractScAddress(contractId) {
  return Address.fromString(contractId).toScAddress();
}

function ledgerKeyContractData(contractId, scKey) {
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: contractScAddress(contractId),
      key: scKey,
      durability: xdr.ContractDataDurability.persistent,
    }),
  );
}

function ledgerEntryDataContractData(contractId, scKey, scVal) {
  return xdr.LedgerEntryData.contractData(
    new xdr.ContractDataEntry({
      ext: xdr.ExtensionPoint.v0(),
      contract: contractScAddress(contractId),
      key: scKey,
      durability: xdr.ContractDataDurability.persistent,
      val: scVal,
    }),
  );
}

function rpcEntry(contractId, scKey, scVal) {
  return {
    key: ledgerKeyContractData(contractId, scKey).toXDR('base64'),
    xdr: ledgerEntryDataContractData(contractId, scKey, scVal).toXDR('base64'),
    lastModifiedLedgerSeq: LAST_MODIFIED,
  };
}

/**
 * Instance entry whose storage map uses one-symbol Vec keys (Levels, Root, …).
 * Executable: StellarAsset (matches upstream unit tests; synthetic only).
 */
function instanceEntry(contractId, storagePairs) {
  const storage = storagePairs.map(
    ([name, val]) =>
      new xdr.ScMapEntry({
        key: unitDataKey(name),
        val,
      }),
  );
  const instance = new xdr.ScContractInstance({
    executable: xdr.ContractExecutable.contractExecutableStellarAsset(),
    storage: storage.length ? storage : null,
  });
  const scKey = xdr.ScVal.scvLedgerKeyContractInstance();
  const scVal = xdr.ScVal.scvContractInstance(instance);
  return rpcEntry(contractId, scKey, scVal);
}

/**
 * TreeState as ScVal::Map with Symbol field names (conversions.rs unit test).
 * Decoder requires next_index + roots; filled_subtrees is ignored if present.
 */
function treeStateScVal({ nextIndex, roots, filledSubtrees }) {
  const entries = [
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('next_index'),
      val: nativeToScVal(nextIndex, { type: 'u64' }),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('roots'),
      val: xdr.ScVal.scvVec(roots.map((r) => nativeToScVal(r, { type: 'u256' }))),
    }),
  ];
  if (filledSubtrees) {
    entries.unshift(
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol('filled_subtrees'),
        val: xdr.ScVal.scvVec(filledSubtrees.map((r) => nativeToScVal(r, { type: 'u256' }))),
      }),
    );
  }
  return xdr.ScVal.scvMap(entries);
}

function buildAspEntries() {
  const adminSc = Address.fromString(SYNTH_ADMIN_G).toScVal();
  const nextIndexSc = nativeToScVal(0n, { type: 'u64' });
  const levelsSc = nativeToScVal(1, { type: 'u32' });
  const rootSc = nativeToScVal(0n, { type: 'u256' });

  return [
    rpcEntry(ASP_MEMBERSHIP, unitDataKey('Admin'), adminSc),
    rpcEntry(ASP_MEMBERSHIP, unitDataKey('NextIndex'), nextIndexSc),
    instanceEntry(ASP_MEMBERSHIP, [
      ['Levels', levelsSc],
      ['Root', rootSc],
    ]),
    rpcEntry(ASP_NON_MEMBERSHIP, unitDataKey('Admin'), adminSc),
    instanceEntry(ASP_NON_MEMBERSHIP, [['Root', rootSc]]),
  ];
}

function buildPoolEntries() {
  const adminSc = Address.fromString(SYNTH_ADMIN_G).toScVal();
  // Empty tree: next_index=0 → root_slot(0, ring_len)=0; need ≥1 root.
  const stateSc = treeStateScVal({
    nextIndex: 0n,
    roots: [0n],
    filledSubtrees: [0n],
  });

  return [
    rpcEntry(POOL, unitDataKey('Admin'), adminSc),
    rpcEntry(POOL, unitDataKey('State'), stateSc),
    instanceEntry(POOL, [
      ['Levels', nativeToScVal(1, { type: 'u32' })],
      ['MaximumDepositAmount', nativeToScVal(1_000_000_000n, { type: 'u256' })],
      ['Token', Address.fromString(TOKEN).toScVal()],
      ['Verifier', Address.fromString(VERIFIER).toScVal()],
      ['ASPMembership', Address.fromString(ASP_MEMBERSHIP).toScVal()],
      ['ASPNonMembership', Address.fromString(ASP_NON_MEMBERSHIP).toScVal()],
      ['PolicyFlags', nativeToScVal(0, { type: 'u32' })],
    ]),
  ];
}

function writeFixture(fileName, body) {
  const outPath = path.join(__dirname, fileName);
  fs.writeFileSync(outPath, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${outPath} entries=${body.entries.length}`);
}

function build() {
  const aspEntries = buildAspEntries();
  writeFixture('getLedgerEntries.aspMinimal.result.json', {
    _comment:
      'SYNTHETIC only — not a real network. Built offline for Fase 2.9 aspState() path. See FIXTURES_NOTES.txt and FASE-2.9 report. Retained; Fase 2.12 mock serves allContractsMinimal.',
    entries: aspEntries,
    latestLedger: LATEST_LEDGER,
  });

  writeFixture('getLedgerEntries.allContractsMinimal.result.json', {
    _comment:
      'SYNTHETIC only — not a real network. Built offline for Fase 2.12 allContractsData() path (enabled pool Admin/State + instance keys + ASP). See FIXTURES_NOTES.txt and FASE-2.12 report.',
    entries: [...buildPoolEntries(), ...aspEntries],
    latestLedger: LATEST_LEDGER,
  });
}

build();
