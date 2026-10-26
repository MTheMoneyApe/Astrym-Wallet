# Fase 2.9 — Validate SPP Ledger Entry Fixtures Through Real WASM

**Date:** 2026-10-26  
**Repo:** `C:\Users\M\Downloads\Stellar privacy project` · branch `master` · HEAD `d872ac455f47ab8822aace0ba2f62e1574d6cf27`  
**Upstream:** `b79107cd24327198f8eb2dbaf4bdc65a8a1e8cf1`  
**Prior:** Phases 2.4–2.8 (`getLedgerEntries` empty body accepted; missing `Admin`/`NextIndex`)

## Verdict

A **minimal synthetic** `getLedgerEntries` success body with source-backed `Admin` / `NextIndex` (plus instance `Levels` / `Root`) was constructed offline with existing `@stellar/stellar-sdk`, served by the loopback mock, and **accepted by the real WASM**.

`Client.aspState()` completed successfully. **Decoded synthetic values were observed** (admin G-address, `nextIndex: "0"`, `levels: 1`, zero roots). Values are **not** a real deployment.

No write-capable ops; no external network; `sendTransaction` / unmodeled methods remain fail-closed.

---

## 1. Source evidence (keys / types / encoding)

| Item | Evidence |
|------|----------|
| ASP membership enum keys | `contract_state.rs` `enum_keys: vec!["Admin", "NextIndex"]` |
| ASP non-membership enum keys | `enum_keys: vec!["Admin"]` |
| Ledger key shape for unit DataKey | `rpc.rs` `build_contract_data_key_specs`: `ScVal::Vec([ScVal::Symbol(name)])`, Persistent `LedgerKeyContractData` |
| Also fetches contract instance | Same function pushes `ScVal::LedgerKeyContractInstance` (not “required” for MissingRequiredContractKeys) |
| `Admin` decode | `scval_to_address_string` → **`ScVal::Address`** (Account → G… or Contract → C…) |
| `NextIndex` decode | `scval_to_u64` → **`ScVal::U64`** |
| `Levels` / `Root` after bulk | Read from flattened instance storage via `instance_storage_entries` → **`U32`** / **`U256`** |
| Instance map key shape | `conversions.rs`: map key must be **one-symbol Vec** (plain `Symbol` keys are skipped) |
| Response schema | `{ entries?: [{ key, xdr, lastModifiedLedgerSeq }], latestLedger }` (Phase 2.4/2.5) |
| Non-read-only after missing keys? | **No** — errors only; no send/simulate/sync on `aspState` path (Phase 2.8) |

**Not inferred:** encodings built with `@stellar/stellar-sdk` XDR types matching the Rust layouts above (same shapes as upstream `rpc.rs` / conversion unit tests).

---

## 2. Fixture construction

| Artifact | Role |
|----------|------|
| `fixtures/buildAspLedgerFixture.mjs` | Offline generator (workspace `stellar-sdk` only) |
| `fixtures/getLedgerEntries.aspMinimal.result.json` | Served synthetic result (5 entries) |
| `fixtures/getLedgerEntries.empty.result.json` | Retained for structural archive / Phase 2.8 history |

Synthetic contents (ASP ids from `synthetic-contract-config.json`):

| Contract | Entries |
|----------|---------|
| `CAAQ…C526` (membership) | `Admin` → Address(GDRXE…), `NextIndex` → U64(0), instance storage `Levels`=U32(1), `Root`=U256(0) |
| `CABA…FNSZ` (non-membership) | `Admin` → same G, instance `Root`=U256(0) |

Marked synthetic in fixture `_comment` / FIXTURES_NOTES. Mock strips `_comment` before RPC result.

**Not done:** inventing `simulateTransaction` success; querying live Stellar; modeling pool `State` for `allContractsData()`.

---

## 3. Browser validation (Stage E → `aspState`)

| Check | Result |
|-------|--------|
| RPC methods | **`getLedgerEntries` only** (`synthetic_getLedgerEntries_aspMinimal`) |
| Forbidden RPC | none |
| External network | `blockedExternal: []`, `externalSentCount: 0` |
| WASM accepted success body | **true** |
| `callCompletedOk` | **true** |
| `contractEntryDecodeObserved` | **true** |
| Parsed membership | `admin=GDRXE…`, `nextIndex="0"`, `levels=1`, `root=0x00…00`, `capacity="2"`, `ledger=1000` |
| Parsed non-membership | same admin, zero root, `isEmpty=true` |
| Stage status | **OBSERVADO** |
| Writes / sync / send | Not invoked |

Harness phase `2.9`, overall `ok: true`.

---

## 4. Tests / commands

```text
node tests/stellar/spp/harness/browser/fixtures/buildAspLedgerFixture.mjs
→ Wrote getLedgerEntries.aspMinimal.result.json entries=5

pnpm exec vitest run …/mockRpc.security.test.ts …/rpcFixtureSchema.test.ts
→ 2 files, 12 tests passed

node …/serve.mjs + Cursor browser harness
→ aspState=OBSERVADO as above
```

---

## 5. Remaining blockers / next step

1. **`getLatestLedger`** still lacks a safe non-sync export (Phase 2.8).  
2. **`allContractsData()`** still needs pool `Admin` + `State` (TreeState map) synthetic entries — out of Admin/NextIndex scope.  
3. Do not treat this as private-payment or Testnet functionality.

---

## 6. Files changed (harness only)

- `fixtures/buildAspLedgerFixture.mjs` (new)
- `fixtures/getLedgerEntries.aspMinimal.result.json` (new)
- `fixtures/FIXTURES_NOTES.txt`
- `mock-rpc.mjs` — serve aspMinimal; strip `_comment`
- `harness.mjs` / `index.html` — Stage E `aspState`, phase 2.9
- `rpcFixtureSchema.test.ts` — aspMinimal structural + mock serve checks
- `docs/FASE-2.9-CONTRACT-ENTRY-VALIDATION.md` — this report
