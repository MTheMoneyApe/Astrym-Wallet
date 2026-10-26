# Fase 2.10 — Safe getLatestLedger Deserialization Path

**Date:** 2026-10-26  
**Repo:** `C:\Users\M\Downloads\Stellar privacy project` · branch `master` · HEAD `d872ac455f47ab8822aace0ba2f62e1574d6cf27`  
**Upstream:** `b79107cd24327198f8eb2dbaf4bdc65a8a1e8cf1`  
**Prior:** Phases 2.4–2.9 (`getLedgerEntries` / `aspState` validated; tip path deferred)

## Verdict — blocker (no safe probe)

**No existing public WASM API invokes `getLatestLedger` without also entering event synchronization / catch-up.**

Per the execution gate, **no browser probe was run**. `sync`, `backgroundSync`, and `bootnodeRequired` were **not** invoked.

The on-disk synthetic fixture `getLatestLedger.result.json` remains schema-aligned with source but **still lacks real WASM tip-path deserialization evidence**.

---

## 1. `GetLatestLedgerResponse` (version-matched source)

From `sdk/native/src/chain/rpc.rs`:

```rust
pub struct GetLatestLedgerResponse {
    pub id: String,
    #[serde(rename = "protocolVersion")]
    pub protocol_version: u32,
    pub sequence: u32,
}

pub async fn get_latest_ledger(&self) -> Result<GetLatestLedgerResponse, Error> {
    self.rpc_call("getLatestLedger", json!({})).await
}
```

| Aspect | Rule |
|--------|------|
| JSON-RPC method | `getLatestLedger` |
| Request params | `{}` |
| Result fields | `id` (string), `protocolVersion` (u32), `sequence` (u32) — all required |
| Transport | Private `rpc_call` → HTTP JSON-RPC (same as other methods) |

Harness fixture already matches this shape (Phase 2.5 structural; Phase 2.9 notes tip not WASM-exercised).

---

## 2. Call graph (every production caller of `get_latest_ledger`)

Exhaustive search of the version-matched SDK tree under `sdk/**/*.rs` (local snapshot + priority fetches of missing chain/sync/client modules):

| Location | Role |
|----------|------|
| `rpc.rs` | **Definition** only |
| `indexer.rs:70` | **Sole production call site**: `Indexer::fetch_contract_events` → `self.client.get_latest_ledger().await?.sequence` as `network_tip`, then pages `get_contract_events` / **`getEvents`** |
| `sync.rs` (tests ~732, ~919) | Wiremock expectations for catch-up tests — not a separate product API |

### Who calls `fetch_contract_events`?

| Caller | File | Side effects |
|--------|------|----------------|
| `catch_up_loop` | `sync.rs` | Repeated event fetch + `storage.process_pending_state()` |
| Test helpers | `sync.rs` | N/A |

### Who calls `catch_up_loop` / tip-reaching sync?

| Entry | Path | Also reaches |
|-------|------|----------------|
| `catch_up` | `Indexer::init` (**getEvents** probe) then `catch_up_loop` → **getLatestLedger** + **getEvents** | Event sync + local state apply |
| `BackgroundSync::run` | `Indexer::init` then loop with `fetch_contract_events` (via catch-up / idle rounds) | **backgroundSync** |
| `SyncHandle::ensure_synced` (Inline) | `catch_up(...)` | Full catch-up |
| WASM `Client.sync()` | native `catch_up` | Same |
| WASM `Client.backgroundSync()` | native `background_sync` → `BackgroundSync::run` | Same class |

### Explicit non-callers (do **not** invoke `get_latest_ledger`)

| API | RPC actually reached | Evidence |
|-----|----------------------|----------|
| `bootnodeRequired` | `Indexer::init` → **`getEvents` only** | `bootnode_required` → `Indexer::init` only (Phase 2.8) |
| `Client.aspState` / `allContractsData` | **`getLedgerEntries`** | Phase 2.8–2.9 |
| `readTokenDecimals` | **`simulateTransaction`** | Phase 2.7 |
| `Client.new` | none (OBS) | Phase 2.1 / 2.7 |

### WASM export surface

Public bindgen API exposes `sync`, `backgroundSync`, `aspState`, `allContractsData`, `bootnodeRequired`, `readTokenDecimals`, etc. **No** `getLatestLedger` / tip-only export appears in `stellar_private_payments_web.d.ts`.

---

## 3. Safety gate application

| Candidate | Invokes `getLatestLedger`? | Also sync / events / writes? | Gate |
|-----------|----------------------------|------------------------------|------|
| Dedicated tip export | **No such export** | — | N/A |
| `Client.sync()` | Yes (via catch-up) | **getEvents** + state processing | **FAIL** |
| `Client.backgroundSync()` | Yes | Background indexer | **FAIL** |
| Inline `ensure_synced` (many reads) | Yes when Inline | catch-up | **FAIL** |
| `bootnodeRequired` | **No** | getEvents only | Not a tip path |
| `aspState` | **No** | getLedgerEntries | Not a tip path |

**No candidate passed the gate → probe not executed.**

---

## 4. Actual RPC methods observed (this phase)

**None** (no browser harness run for tip).

---

## 5. WASM acceptance of tip response

**Not demonstrated.** Schema remains source-confirmed; fixture remains synthetic and structurally validated only (Phase 2.5).

---

## 6. Tests run

No executable harness changes. **No tests re-run** this phase (docs / notes only).

---

## 7. Remaining blockers / recommended next step

1. **Upstream / product:** A narrow exported tip probe (e.g. `getLatestLedger`-only helper) that does not call `Indexer::fetch_contract_events` / catch-up — **or** an explicitly authorized sync experiment under a later phase with controlled `getEvents` fixtures (separate policy; out of scope here).  
2. **Do not** weaken the mock or call `sync` / `backgroundSync` solely to force tip deserialize.  
3. Keep using Phase 2.9 `aspState` evidence for ledger-**entries**; treat tip as still unproven at WASM runtime.

---

## 8. Files changed

| File | Action |
|------|--------|
| `docs/FASE-2.10-GET-LATEST-LEDGER.md` | **Created** |
| `fixtures/FIXTURES_NOTES.txt` | Tip-path blocker note (if updated) |

No production code. No mock / fixture body changes.
