# Fase 2.6 — Offline SPP RPC Deserialization Validation

**Date:** 2026-10-26  
**Repo:** `C:\Users\M\Downloads\Stellar privacy project` · branch `master` · HEAD `d872ac455f47ab8822aace0ba2f62e1574d6cf27`  
**Authority / provenance:** Phase 2.4 SLSA → commit `b79107cd24327198f8eb2dbaf4bdc65a8a1e8cf1`  
**Source snapshot:** `C:\Users\M\AppData\Local\Temp\spp-fase24-rpc-source-20261025-233039\`  
(hashes re-verified: `rpc.rs`, `sdk/web/package.json`, `indexer.rs` — OK)  
**Prior:** Phase 2.5 structural fixture validation only.

## Verdict — Option C (blocker)

**Genuine Rust/WASM deserialization of the harness `getLatestLedger` / `getLedgerEntries` fixtures was not exercised.** There is no supported, offline, dependency-free call path that reaches those deserializers without capabilities this environment lacks (browser OPFS workers) or operations this phase forbids (sync / write / new success fixtures for other methods).

Phase 2.5 TypeScript structural checks remain the only local fixture validation. They are **not** the SDK deserializer.

---

## 1. Available local tools and SDK exports

| Asset | Status |
|-------|--------|
| Installed `stellar-private-payments@0.2.1` WASM + JS glue | Present under `node_modules` |
| Version-matched `rpc.rs` (sparse snapshot) | Present; hashes match Phase 2.4 |
| Full upstream Cargo workspace in snapshot | **Absent** (only selected files retrieved) |
| `rustc` / `cargo` on PATH | **Absent** (`NO_CARGO`) |
| Cached Cargo registry usable offline for SPP | **N/A** (no toolchain) |
| Public WASM/JS exports that name RPC response types or `deserialize_*` | **None** |

**Observed public function exports** (after `initSync` with local WASM bytes):  
`bootnodeRequired`, `readTokenDecimals`, `verifySelectiveDisclosure`, `parseTokenAmount`, `Client`, `Storage`, `Account`, … — **no** `GetLatestLedgerResponse` / parse-RPC helpers.

RPC JSON deserialization lives inside private `RpcClient::rpc_call` → `serde` on response types in `sdk/native/src/chain/rpc.rs` (source-confirmed in Phase 2.4). It is only reached when the client performs an HTTP JSON-RPC round-trip.

---

## 2. Option A — Actual SDK deserializer (attempted / blocked)

### Direct export
**Missing.** Initializing WASM does not expose the response deserializer.

### Indirect paths evaluated

| API | Needs | RPC methods observed / expected | Fit for validating current fixtures? |
|-----|-------|----------------------------------|--------------------------------------|
| `Client.new` | Storage + circuits | Phase 2.1 **OBS:** **0** RPC calls | **No** |
| `backgroundSync` / pool / register / … | Storage + sync/write | Forbidden this phase | **No** |
| `bootnodeRequired(rpcUrl, storage, config)` | **Storage handle** (OPFS worker) | Probe uses `RpcClient` (likely tip/events; source wrapper at `sdk/web/src/bootnode.rs`) | **Blocked in Node** |
| `readTokenDecimals(rpcUrl, token)` | Valid contract id only | **OBS (this phase):** only `simulateTransaction` | **No** — does not touch `getLatestLedger` / `getLedgerEntries` fixtures; success would require a `simulateTransaction` success body (still **blocked** / fail-closed for unverified harness success fixtures) |

### Ephemeral Node probes (not added as harness tests)

1. **`initSync({ module: wasmBytes })`** — succeeds offline (file bytes; avoids `fetch` of `file:` URL).  
2. **Export scan** — no ledger/RPC deserialize symbols.  
3. **`Storage.open()`** — **panics** in Node: `failed to spawn worker` (`gloo-worker` / `spawner.rs`). Same class of failure as earlier harness notes.  
4. **`readTokenDecimals` → `http://127.0.0.1:<mock>`** with synthetic token contract id — mock logged **`simulateTransaction` only**; error `jsonrpc error: -32601 - not modeled simulateTransaction`. Methods list: `['simulateTransaction']`. Fixtures for ledger tip/entries were **never requested**.

**Conclusion:** Option A is unavailable here without (a) a browser OPFS environment plus a carefully scoped probe that still may call unmodeled methods, or (b) adding new success fixtures / forbidden sync paths. Neither was done.

---

## 3. Option B — Version-matched Rust tests

| Requirement | Status |
|-------------|--------|
| Exact types in `rpc.rs` + `#[cfg(test)]` wiremock tests | Source text available in snapshot |
| Runnable crate tree + `Cargo.toml` workspace | **Incomplete** in snapshot |
| `cargo` / `rustc` | **Not installed** |
| Offline `cargo test` without fetching crates | **Impossible** (no toolchain; would need deps even if present) |

**Do not execute** upstream build scripts. Option B **stopped**.

---

## 4. What was *not* claimed

- Structural Fase 2.5 validators were **not** relabeled as SDK deserialization.  
- No substitute TypeScript/serde reimplementation was added as a stand-in for WASM.  
- Fixtures were **not** modified to force progress.  
- `sendTransaction` remains fail-closed; unknown methods remain rejected.

---

## 5. Schema-validation gaps that remain

1. **No runtime proof** that installed WASM `serde` accepts the on-disk `getLatestLedger` / empty `getLedgerEntries` JSON (field names are source-backed; acceptance unproven).  
2. Malformed fixture rejection by **WASM** (missing fields / wrong types) — unproven (only TS structural rejects in Phase 2.5).  
3. `getEvents` / `simulateTransaction` / `getTransaction` success paths — still intentionally unmodeled in the mock.  
4. Browser OPFS + `bootnodeRequired` (or a future read-only probe) could close gap (1) for tip/events **if** limited to modeled methods and still offline — **not done** this phase.

---

## 6. Recommended next step

1. Keep Phase 2.5 structural tests as the offline CI gate; keep mock restrictive.  
2. When a **browser-only** OPFS harness session is explicitly authorized: call `bootnodeRequired` (or another read-only probe) against the loopback mock, capture RPC methods, and record whether `getLatestLedger` / `getLedgerEntries` responses deserialize — still without `backgroundSync` or writes.  
3. Or: obtain a full version-matched checkout + Rust toolchain and run **offline** `cargo test` for `rpc.rs` wiremock cases (deps must already be cached).  
4. Do **not** treat Option C as license to invent success fixtures for `simulateTransaction` solely to call `readTokenDecimals`.

---

## 7. Tests run this phase

| Command | Result |
|---------|--------|
| Ephemeral Node `initSync` / export / `Storage.open` / `readTokenDecimals` probes | Documented above (discovery only; **not** committed as tests) |
| Phase 2.5 structural Vitest suite | **Not re-run** this phase (no harness code changes) |

No new harness tests added (real deserializer path unavailable).

---

## 8. Files changed

| File | Action |
|------|--------|
| `packages/wallet-core/tests/stellar/spp/harness/browser/docs/FASE-2.6-OFFLINE-DESERIALIZATION.md` | **Created** |

Production / fixtures / mock / Phase 2.5 tests: **unchanged**.
