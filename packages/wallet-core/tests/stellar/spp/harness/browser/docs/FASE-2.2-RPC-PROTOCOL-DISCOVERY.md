# Fase 2.2 — SPP RPC Protocol Discovery (Read-Only, Offline)

**Date:** 2026-10-26  
**Package:** `stellar-private-payments@0.2.1` (local install under `packages/wallet-core/node_modules/stellar-private-payments`)  
**Repo:** `C:\Users\M\Downloads\Stellar privacy project` · branch `master` · HEAD `d872ac455f47ab8822aace0ba2f62e1574d6cf27`  
**Scope:** Evidence inventory only. No network, no fixture expansion, no production integration.

## Evidence legend

| Tag | Meaning |
|-----|---------|
| **OBS** | Observed at runtime in Phase 2.1 harness (browser) |
| **SRC** | Confirmed from published package JS/types/README |
| **WASM** | Confirmed as a string / struct label inside `dist/stellar_private_payments_web_bg.wasm` |
| **INF** | Inferred (classic Soroban RPC / `@stellar/stellar-sdk` types / field-count matching) — **not** complete schema proof |
| **UNK** | Unknown / blocked without Rust source or live capture |

**Important limitation:** The npm tarball does **not** ship Rust sources or JS source maps for the RPC client (`sdk/web/src/*.rs` is referenced only as a string path inside WASM). Struct **element counts** are WASM-confirmed; **field names and order** for those structs are **not** source-confirmed unless separately evidenced.

---

## 1. Transport and JSON-RPC envelope

| Claim | Status | Evidence |
|-------|--------|----------|
| HTTP JSON-RPC via Rust `reqwest` inside WASM | **WASM** | `reqwest-0.13.5`, `reqwest::errors::TimedOut`, `jsonrpc error:` in WASM |
| Client configured with `rpcUrl` string | **SRC** | `js/types/api-types.d.ts` `ClientNewOptions.rpcUrl`; `js/index.js` passes `options.rpcUrl` to `WasmClient.new` |
| Optional `bootnodeUrl` second RPC | **SRC** / **WASM** | `ClientNewOptions.bootnodeUrl`; strings `bootnode rpc`, `sdk/web/src/bootnode.rs` |
| No public transport/fetch injection API | **SRC** | No such options in `js/types` or `js/index.js` |
| Request keys include `jsonrpc`, `id`, `method`, `params` | **WASM** (names present) | Concatenated blob starting `setupjsonrpcidmethodparams…` |
| Exact JSON-RPC version / batch support | **UNK** | Mock assumes `"2.0"` and rejects batches; not proven against SPP deserializer |
| `JsonRpcResponse` has 2 elements | **WASM** | `struct JsonRpcResponse with 2 elements` — likely success/error enum; field layout **UNK** |
| `JsonRpcErrorResponse` has 3 elements | **WASM** | `struct JsonRpcErrorResponse with 3 elements` — layout **UNK** |

---

## 2. RPC method inventory (SPP WASM)

Methods whose **names** appear as callable RPC methods in WASM:

| Method | Name in WASM | Element-count struct(s) | Likely role (INF unless noted) | When used |
|--------|--------------|-------------------------|--------------------------------|-----------|
| `getLatestLedger` | **WASM** | `GetLatestLedgerResponse` **3** elements | Tip ledger | Sync / prep (**INF**); **not** called during Phase 2.1 `Client.new` (**OBS**) |
| `getLedgerEntries` | **WASM** | `GetLedgerEntriesResponse` **2**; `LedgerEntryResult` **3** | Contract/account entries | Sync / state; string `expected account ledger entry` (**WASM**) |
| `getEvents` | **WASM** | `GetEventsResponse` **6**; `Event` **11** | Indexer / background sync | `backgroundSync` / sync (**INF**); error `cursor is not found in the events response` (**WASM**) |
| `getTransaction` | **WASM** | `GetTransactionResponse` **2** | Confirm submit | After send (**WASM** errors `getTransaction failed for`) |
| `simulateTransaction` | **WASM** | `SimulateTransactionResponse` **6**; also `SimulateHostFunctionResult` | Tx prep / auth | Flow `Proving→Simulating→simulate→Signing→sign→Submitting→submit` (**WASM**) |
| `sendTransaction` | **WASM** | `SendTransactionResponse` **4** | Broadcast | Submit path; **must not succeed** in harness. Errors: `sendTransaction failed`, `sendTransaction returned empty hash`, `transaction_submitted` (**WASM**) |

**Not found as method names in SPP WASM:** `getHealth`, `getNetwork`, `getFeeStats`, `getVersionInfo` (searched offline).

### `sendTransaction` and initialization

| Question | Answer | Status |
|----------|--------|--------|
| Invoked during Phase 2.1 `Client.new`? | No RPC methods observed | **OBS** |
| Invoked during `account` + rejecting `derivePrivacyKeys`? | No | **OBS** (only `signMessage`) |
| Invoked during register / pool write flows? | Yes in product paths | **WASM** / **INF** (submit stage strings) |
| Safe to return success in mock? | **No** — Phase 2.1 policy + product risk | Policy |

---

## 3. Request/response schemas — confirmed vs inferred

### 3.1 `getLatestLedger`

| Aspect | Detail | Status |
|--------|--------|--------|
| Method string | `getLatestLedger` | **WASM** |
| Response arity | 3 fields in SPP struct | **WASM** |
| Fixture fields used in 2.1 | `id` (string), `sequence` (number), `protocolVersion` (number `22`) | **INF** field set |
| Why inferred | Classic Soroban RPC historically used these three; names `protocolVersion` / `sequence` appear in WASM serde blobs; **no** Rust derive listing proves this exact trio/order for `GetLatestLedgerResponse` | |
| Conflict | `@stellar/stellar-sdk` `RawGetLatestLedgerResponse` now also has `closeTime`, `headerXdr`, `metadataXdr` — **more than 3 fields**. That SDK shape must **not** be assumed identical to SPP’s 3-element struct | **SRC** (stellar-sdk) vs **WASM** (count=3) |
| Request params | Unknown (null vs `{}`) | **UNK** |

### 3.2 `getLedgerEntries`

| Aspect | Detail | Status |
|--------|--------|--------|
| Method string | `getLedgerEntries` | **WASM** |
| Request | Param name `keys` present in WASM near method | **WASM** (name only); key encoding **UNK** |
| Response arity | 2 elements | **WASM** |
| Entry arity | `LedgerEntryResult` 3 elements | **WASM** |
| Plausible raw fields | `entries` + `latestLedger`; entry: `key`, `xdr`, `lastModifiedLedgerSeq` | **INF** (names appear in WASM blob `…sequencekeyxdrlastModifiedLedgerSeqentries…` + classic Raw API) |
| Empty `entries` | Honest “no data” synthetic; does not prove accept/reject rules for missing keys | **INF** / harness policy |
| Errors | `MissingRequiredContractKeys`, `expected account ledger entry` | **WASM** (behavior detail **UNK**) |

### 3.3 `getEvents`

| Aspect | Detail | Status |
|--------|--------|--------|
| Method string | `getEvents` | **WASM** |
| Request hints | `pagination`, `startLedger`, `endLedger`, `cursor` | **WASM** names |
| Response arity | 6 elements; each `Event` 11 elements | **WASM** |
| Must include `cursor` | Error: `cursor is not found in the events response` | **WASM** |
| Full field schema | **UNK** — do not fixture without field-level source or captured traffic | |

### 3.4 `simulateTransaction`

| Aspect | Detail | Status |
|--------|--------|--------|
| Method string | `simulateTransaction` | **WASM** |
| Response arity | 6 elements | **WASM** |
| Required concepts | `retval`, `xdr`, `transactionData` mentioned in error strings | **WASM** |
| Host function result type | `SimulateHostFunctionResult` named in WASM | **WASM** |
| Full schema | **UNK** | |
| stellar-sdk `RawSimulateTransactionResponse` | Related ecosystem type only — not proof of SPP layout | **INF** cross-ref |

### 3.5 `getTransaction`

| Aspect | Detail | Status |
|--------|--------|--------|
| Method string | `getTransaction` | **WASM** |
| Response arity | **2** elements | **WASM** — suggests enum/wrapper, not the large stellar-sdk raw object |
| Full schema | **UNK** | |

### 3.6 `sendTransaction`

| Aspect | Detail | Status |
|--------|--------|--------|
| Method string | `sendTransaction` | **WASM** |
| Response arity | 4 elements | **WASM** |
| Plausible fields (INF only) | `status`, `hash`, `latestLedger`, … plus `errorResultXdr` in error paths | **INF** from WASM name blob + stellar-sdk RawSend |
| Harness policy | Always JSON-RPC error; never `result` success | Phase 2.1 **OBS** (mock code) |

---

## 4. Fixture audit (Phase 2.1)

| Fixture / behavior | File | Faithful? | Classification | Notes |
|--------------------|------|-----------|----------------|-------|
| `getLatestLedger` result | `fixtures/getLatestLedger.result.json` | **Partial / unverified field binding** | SYNTHETIC + **INF** | 3 keys match arity; values fake; field set not Rust-confirmed; unused by Phase 2.1 `Client.new` (**OBS**: 0 RPC calls) |
| `getLedgerEntries` empty | `fixtures/getLedgerEntries.empty.result.json` | **Partial** | SYNTHETIC + **INF** | 2-key shape matches arity + common Raw API; empty list avoids inventing XDR; unproven acceptance by SPP validators |
| `sendTransaction` reject | `mock-rpc.mjs` | **Policy-correct** (not a protocol fixture) | SYNTHETIC | Does not claim a valid 4-field success body |
| Unmodeled methods | `mock-rpc.mjs` `-32601` | **Correct refusal** | — | Avoids inventing `getEvents` / `simulateTransaction` bodies |

**Conclusion:** Current success fixtures must **not** be described as “faithful SDK responses.” They are **synthetic placeholders** with **partial** structural evidence (arity ± common Soroban naming).

---

## 5. Minimum evidence before new faithful fixtures

Before adding or promoting any fixture:

1. **Field-level source** for the SPP Rust/serde types (upstream `sdk/web` / shared RPC types), **or**
2. **Captured request/response pairs** from SPP WASM against a controlled mock that logs raw JSON **and** is validated by successful deserialize inside WASM (without inventing permissive junk), **or**
3. Vendor documentation that explicitly documents the SPP client’s expected RPC JSON (not only generic Soroban RPC docs).

Additionally for each method:

- Request param schema (including `keys` encoding for `getLedgerEntries`).
- Error object shape (`JsonRpcErrorResponse` 3 elements).
- Enum/tag encoding for 2-element wrappers (`GetTransactionResponse`, `JsonRpcResponse`).

**Do not** promote stellar-sdk `api.d.ts` alone to “SPP schema” when WASM arity disagrees (notably `getLatestLedger`).

---

## 6. Recommended next step (no guessed schemas)

1. Keep mock rejecting unmodeled methods and always rejecting `sendTransaction`.
2. Optionally add **request logging only** (already present) when/if a future sync path calls RPC — capture **requests** first; respond with controlled errors until deserialize errors name missing fields (**OBS**-driven discovery), without guessing full success bodies.
3. Prefer obtaining upstream RPC type definitions for `stellar-private-payments` 0.2.1 over expanding fixtures.
4. Do **not** run `backgroundSync`, register, deposit, transfer, or withdraw until success fixtures are evidence-backed.
5. Treat Phase 2.1 **OBSERVED** `signMessage` on `derivePrivacyKeys` as independent of RPC fidelity (`Client.new` needed no RPC in that run).

---

## 7. Artifacts consulted

| Path | Role |
|------|------|
| `…/stellar-private-payments/dist/stellar_private_payments_web_bg.wasm` | Method names, struct arities, error strings, serde name blobs |
| `…/stellar-private-payments/js/index.js` | `Client.new` / `rpcUrl` / `bootnodeUrl` wiring |
| `…/stellar-private-payments/js/types/api-types.d.ts` | Public options |
| `…/stellar-private-payments/README.md` | Documented Testnet RPC URL example (not schema) |
| `…/@stellar/stellar-sdk/lib/esm/rpc/api.d.ts` | Ecosystem cross-check only |
| `tests/stellar/spp/harness/browser/mock-rpc.mjs` + `fixtures/*` | Current mock audit |
| Phase 2.1 browser run (Cursor harness) | **OBS**: `Client.new` → 0 RPC; `derivePrivacyKeys` → `signMessage` |

**Not available locally:** SPP Rust RPC source, source maps for RPC structs, npm tests exercising RPC JSON.
