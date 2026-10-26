# Fase 2.8 — Identify a Safe Ledger RPC Deserialization Path

**Date:** 2026-10-26  
**Repo:** `C:\Users\M\Downloads\Stellar privacy project` · branch `master` · HEAD `d872ac455f47ab8822aace0ba2f62e1574d6cf27`  
**Upstream:** `b79107cd24327198f8eb2dbaf4bdc65a8a1e8cf1`  
**Prior:** Phases 2.4–2.7

## Verdict

| Method | Safe WASM path found? | Browser-exercised? | WASM accepted success body? |
|--------|----------------------|--------------------|------------------------------|
| `getLedgerEntries` | **Yes** — `Client.allContractsData()` / `aspState()` | **Yes** (Stage E) | **Yes** (then app error on missing keys) |
| `getLatestLedger` | **No** without sync/catch_up | Not invoked | N/A |

`bootnodeRequired` is **not** a ledger-tip/entries path: it only probes via `getEvents`.

---

## 1. Source files traced

| File (at `b79107cd`) | Role |
|----------------------|------|
| `sdk/web/src/bootnode.rs` | WASM `bootnodeRequired` → native `bootnode_required` |
| `sdk/native/src/sync.rs` | `bootnode_required` → `Indexer::init` only |
| `sdk/native/src/chain/indexer.rs` | `init` → `get_contract_events`; `fetch_contract_events` → **`get_latest_ledger`** + events |
| `sdk/web/src/client/mod.rs` | WASM `allContractsData` / `aspState` → `StateFetcher` (**no** `ensure_synced`) |
| `sdk/native/src/chain/contract_state.rs` | `all_contracts_data` / `asp_state` → `get_contract_data_bulk` |
| `sdk/native/src/chain/rpc.rs` | `get_contract_data_bulk` → **`get_ledger_entries`**; `get_latest_ledger`; `simulate` / `send` |
| `sdk/native/src/client.rs` | `sync` / `background_sync` / `ensure_synced` → catch-up (forbidden) |
| `sdk/native/src/lib.rs` | Re-exports `bootnode_required` from `sync` |

---

## 2. Candidate paths — RPC reachability

### A. `bootnodeRequired` (export)

```text
bootnode_required_js
  → bootnode_required(rpc, storage, config)
    → Indexer::init(...)
      → get_contract_events(...)   // → getEvents only
```

| Method | Reachable? |
|--------|------------|
| `getEvents` | **Yes** (probe) |
| `getLatestLedger` | **No** on this path (`get_latest_ledger` only in `fetch_contract_events`) |
| `getLedgerEntries` | **No** |
| `simulateTransaction` / `sendTransaction` | **No** |
| `backgroundSync` / pool write / register | **No** |

**Safety:** read-only vs writes, but **does not** exercise ledger fixtures. Not selected for ledger validation.

### B. `Client.allContractsData()` / `aspState()` (exports) — **SELECTED**

```text
Client.allContractsData (wasm)
  → state_fetcher()                    // no ensure_synced
  → StateFetcher::all_contracts_data
  → get_contract_data_bulk
  → get_ledger_entries                 // existing empty synthetic fixture
```

| Method | Reachable? |
|--------|------------|
| `getLedgerEntries` | **Yes** |
| `getLatestLedger` | **No** |
| `simulateTransaction` / `sendTransaction` | **No** |
| `getEvents` | **No** |
| `backgroundSync` / register / deposit / transfer / withdraw | **No** |

**Safety gate:** **PASS** — source shows no submit, send, register, pool write, sync initiation, or simulate on this path.

### C. Paths that reach `getLatestLedger`

Only `Indexer::fetch_contract_events` (via `catch_up` / `BackgroundSync` / `Client.sync` / inline `ensure_synced` before many reads).

**Safety gate:** **FAIL** for this phase — would initiate synchronization / event catch-up. **Not probed.**

### D. `readTokenDecimals` (Phase 2.7)

Only `simulateTransaction` — irrelevant to ledger fixtures.

---

## 3. Safety rationale for running Stage E

- Source-proven: `allContractsData` → `get_ledger_entries` only among RPC methods.
- Mock keeps `sendTransaction` and unknown methods (incl. `getEvents` success inventing) fail-closed; existing empty `getLedgerEntries` fixture already schema-backed (2.4/2.5).
- No production vault; recorder unchanged; loopback-only harness.
- Pre-probe Vitest: `mockRpc.security.test.ts` — **4 passed**.

---

## 4. Browser results (Stage E)

Harness `phase: 2.8`, `ok: true`, OPFS/WASM/Storage **INICIALIZADO**, network `externalSentCount: 0`, `blockedExternal: []`.

| Observation | Value |
|-------------|-------|
| RPC methods in Stage E window | **`getLedgerEntries` only** (`synthetic_getLedgerEntries_empty`) |
| `getLatestLedger` invoked | **false** |
| Forbidden RPC (`send` / `simulate` / `getEvents`) | **false** |
| Mock served synthetic success body | **true** |
| `wasmAcceptedGetLedgerEntriesSuccessBody` | **true** |
| Call completed OK | **false** |
| Post-deser error | `missing required contract keys for CAAQCAIB…: ["Admin", "NextIndex"]` |

**Interpretation:** The real WASM **deserialized** the JSON-RPC **success** result for `getLedgerEntries` (empty `entries` + `latestLedger`). Subsequent application logic correctly rejected missing required contract keys. That is **not** a claim that empty entries are a useful pool state — only that the **RPC response schema was accepted** by serde/`rpc_call`.

`getLatestLedger` success deserialization remains **unproven** (no safe export without sync).

---

## 5. Remaining blockers / next step

1. **`getLatestLedger`:** Still needs either a new upstream-exported tip probe that does not sync, or an explicitly authorized narrow sync-adjacent experiment under separate policy (out of scope here).
2. **Richer `getLedgerEntries` fixtures:** Optional later — populate required key XDR from synthetic contracts if application-level success is desired; not required to prove deser of the empty response shape.
3. Keep mock fail-closed for `sendTransaction` / unmodeled methods; do not use `bootnodeRequired` expecting ledger-tip calls.

---

## 6. Files changed / commands

**Changed (harness only):**
- `harness.mjs` — Stage E `allContractsData` probe; phase `2.8`
- `index.html` — title
- `docs/FASE-2.8-LEDGER-READ-PATH.md` — this report
- `fixtures/FIXTURES_NOTES.txt` — 2.8 note

**Commands:**
```text
pnpm exec vitest run tests/stellar/spp/harness/browser/mockRpc.security.test.ts
→ 4 passed
node tests/stellar/spp/harness/browser/serve.mjs
Cursor browser → harness index.html → Stage E OBSERVADO_PATH as above
```
