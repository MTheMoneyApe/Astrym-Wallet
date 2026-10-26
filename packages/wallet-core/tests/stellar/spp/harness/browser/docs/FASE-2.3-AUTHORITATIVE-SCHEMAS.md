# Fase 2.3 — Recover Authoritative SPP RPC Schemas

**Date:** 2026-10-26  
**Prior:** `FASE-2.2-RPC-PROTOCOL-DISCOVERY.md`  
**Repo:** `C:\Users\M\Downloads\Stellar privacy project` · branch `master` · HEAD `d872ac455f47ab8822aace0ba2f62e1574d6cf27`  
**Scope:** Recover authoritative request/response schemas for `stellar-private-payments@0.2.1` from **local artifacts only**. No network fetch, no fixture promotion, no SPP write/sync operations.

## Verdict

**Authoritative field-level RPC schemas cannot be recovered from the installed npm package or any other local artifact in this workspace.**

The investigation identifies the upstream repository path for the RPC client and the missing source file that would authorize schemas, then **stops**. Circuit provenance commits in the package are **not** sufficient proof of the SDK/WASM revision that embeds the RPC types.

---

## 1. Package identity (local evidence)

| Field | Value | Evidence |
|-------|-------|----------|
| Name | `stellar-private-payments` | `packages/wallet-core/node_modules/stellar-private-payments/package.json` |
| Version | `0.2.1` | Same `package.json`; `packages/wallet-core/package.json` dependency `"stellar-private-payments": "0.2.1"` |
| Lock integrity | `sha512-d4ABQKBB0DzLqM6v0sLpfGL7MdxnqXwhNIy5E3jtDgOI1S5jBhlJbkQxNl0g94MnGFyKZ1bl90thMTdSOOkhuQ==` | `pnpm-lock.yaml` → `stellar-private-payments@0.2.1` |
| License (SDK) | Apache-2.0 | `package.json` `license`; `dist/LICENSE.txt` |
| Published layout | `dist/` + `js/` only (`files` array) | `package.json` |
| Install path | `packages/wallet-core/node_modules/stellar-private-payments` | Workspace install |

No npm `gitHead`, no embedded WASM git SHA, and no source-map URL for the RPC client were found in the package.

---

## 2. Upstream repository / commit (local evidence only)

### Repository URL (supported)

| Claim | Status |
|-------|--------|
| Upstream git URL is `https://github.com/NethermindEth/stellar-private-payments.git` | **Confirmed locally** — `package.json` → `repository.url` = `git+https://github.com/NethermindEth/stellar-private-payments.git` |
| npm package subdirectory | **Confirmed** — `repository.directory` = `sdk/web` |
| Same org/repo named in circuit licensing | **Confirmed** — `dist/circuits/NOTICE.txt` cites `https://github.com/NethermindEth/stellar-private-payments`; `dist/circuits/circuits.json` → `meta.repository` = `NethermindEth/stellar-private-payments` |

This URL comes from **installed package metadata**, not from an external fetch or guessed host.

### Commit pin for the **0.2.1 WASM / RPC client** (not recovered)

Local commits appear only in **circuit** provenance, and they **disagree** with each other:

| Source | Commit | What it claims |
|--------|--------|----------------|
| `dist/circuits/circuits.json` → `meta.commit` | `affec1e9d0e6282ad35b6ab67019d84a1eb2725d` | Circuit lock / fingerprint metadata |
| `dist/circuits/NOTICE.txt` → “Build provenance” | `b79107cd24327198f8eb2dbaf4bdc65a8a1e8cf1` | Circuit artifact build date 2026-10-16 |

Neither SHA appears inside `dist/stellar_private_payments_web_bg.wasm` (byte search offline). Neither document states that the commit built the **browser SDK RPC client** shipped as npm `0.2.1`.

**Conclusion:** Upstream **repository** is identifiable. An authoritative **git commit for the RPC serde types in this exact npm binary** is **not** identifiable from local evidence. This phase does **not** fetch GitHub to resolve `v0.2.1` / release tags.

---

## 3. Artifacts inspected

| Artifact | Result for RPC schemas |
|----------|------------------------|
| `package.json`, `README.md` | Repo URL; public API docs; no RPC JSON schemas |
| `js/types/*.d.ts`, `js/types/crates/stellar_private_payments_web.d.ts` | Client/Storage/signer surfaces; **no** `GetLatestLedgerResponse` / JSON-RPC result types |
| `js/index.js`, `js/freighter.js` | Facade only; `rpcUrl` / `bootnodeUrl` passed into WASM |
| `dist/stellar_private_payments_web.js` + `_bg.wasm` / `.d.ts` | Method **names** + struct **element counts** (Phase 2.2); panic paths name Rust files (below) |
| `dist/workers/*` | Storage/prover workers; no RPC type defs |
| `dist/circuits/circuits.json`, `NOTICE.txt`, `source-bundle.tar.gz` | Circom / LGPL corresponding source only — **no** `sdk/native` RPC Rust |
| `*.map`, `*.rs`, `Cargo.toml` under package | **Absent** (except circuit Rust test helpers inside the tarball) |
| Workspace / Downloads search for a local clone of `stellar-private-payments` | **None found** |
| `@stellar/stellar-sdk` `rpc/api.d.ts` (workspace dep) | Ecosystem cross-check only — **not** SPP’s serde types (Phase 2.2 arity conflict on `getLatestLedger`) |
| Harness fixtures + `mock-rpc.mjs` + `mockRpc.security.test.ts` | Synthetic mock policy; security test asserts fixture **contents**, not WASM deserialize success |
| Phase 2.2 report | Baseline inventory; unchanged conclusions |

---

## 4. Serialization / deserialization paths

### Confirmed (name + location hints only)

From WASM debug/event strings (offline extract):

| Path string in WASM | Role (inferred from name + Phase 2.2) |
|---------------------|----------------------------------------|
| `sdk/native/src/chain/rpc.rs` | Primary JSON-RPC client / response handling (`stellar_private_payments::chain::rpc`) |
| `sdk/native/src/chain/submit.rs` | Submit / `sendTransaction` path |
| `sdk/native/src/chain/indexer.rs` | Events / indexing (`getEvents`) |
| `sdk/native/src/sync.rs` | Background sync orchestration |
| `sdk/web/src/bootnode.rs` | Bootnode RPC gap fill |
| `ReqwestJsonRpc` | Transport label inside WASM |

**These `.rs` files are not present in the npm tarball.** Without them (or equivalent type definitions from the matching commit), field names, order, enums, and request param shapes remain non-authoritative.

### Confirmed RPC surface (unchanged from Phase 2.2)

Method **names** and response struct **arities** in WASM remain the strongest local evidence. They do **not** constitute complete schemas:

| Method | WASM response arity evidence |
|--------|------------------------------|
| `getLatestLedger` | `GetLatestLedgerResponse` — 3 elements |
| `getLedgerEntries` | `GetLedgerEntriesResponse` — 2; `LedgerEntryResult` — 3 |
| `getEvents` | `GetEventsResponse` — 6; `Event` — 11 |
| `getTransaction` | `GetTransactionResponse` — 2 |
| `simulateTransaction` | `SimulateTransactionResponse` — 6 |
| `sendTransaction` | `SendTransactionResponse` — 4 |
| Errors / envelope | `JsonRpcResponse` — 2; `JsonRpcErrorResponse` — 3 |

No JS/TS declaration or Rust source in-tree maps those elements to named fields.

### Precise reason schemas cannot be recovered here

1. Published package ships **compiled WASM + JS facade**, not SDK Rust sources.  
2. The only bundled “source” archive is **circuit** corresponding source (LGPL), not `sdk/native/src/chain/rpc.rs`.  
3. No source maps expose serde field lists.  
4. No local upstream checkout exists to open those files offline.  
5. Fetching the GitHub tree/tag for `0.2.1` is **out of scope** for this phase.

**Missing artifact (blocker):** Offline copy of upstream Rust (at minimum `sdk/native/src/chain/rpc.rs` and its RPC response type modules) for the **exact** revision that built npm `stellar-private-payments@0.2.1` (commit TBD by a later, explicitly authorized acquisition — not performed here).

---

## 5. Offline schema validation feasibility

| Approach | Feasible offline without forbidden ops? | Notes |
|----------|-------------------------------------------|-------|
| Unit-test fixtures against published JS types | **No** | No RPC result types exported |
| Deserialize via a public WASM “parse RPC” API | **No** | No such export in `.d.ts` |
| Feed fixtures into `Client.new` / `account` / `derivePrivacyKeys` | **Insufficient** | Phase 2.1 **OBS:** `Client.new` issued **0** RPC calls |
| Drive deserialize via `backgroundSync` / pool / register / simulate / submit | **Forbidden** by phase safety (and would still not prove field-level authority without recording accepted JSON) |
| Existing `mockRpc.security.test.ts` | **Policy only** | Asserts synthetic fixture shape and `sendTransaction` reject; **not** WASM acceptance |
| Upstream Rust `#[cfg(test)]` / serde round-trips (if sources were local) | **Would be** the preferred offline validator | Sources absent |

**Conclusion:** Offline **authoritative** fixture validation is **not feasible** with current local artifacts. Restrictive mock behavior (unknown methods fail; `sendTransaction` never succeeds) should remain unchanged.

---

## 6. Recommended next step and blockers

### Blocker (precise)

Cannot promote or rewrite RPC success fixtures to “faithful” status until an **offline**, version-matched copy of upstream RPC Rust types (or vendor-published schema docs for 0.2.1) is available. Local npm + circuit provenance are insufficient.

### Recommended next step (does not guess schemas)

1. Keep Phase 2.1 mock policy: unmodeled methods → error; `sendTransaction` → always reject; do not expand success fixtures.  
2. When policy allows **acquiring** source (outside this offline-no-fetch phase): obtain upstream tree for the release that published npm `0.2.1`, open `sdk/native/src/chain/rpc.rs` (+ types), and document field-level serde. Prefer matching by npm tag/release notes over assuming `circuits.json` / NOTICE commits.  
3. Optionally, after authoritative types exist, add a **pure offline** fixture unit test that mirrors Rust/serde field lists (still without live RPC or SPP sync).  
4. Do not use `@stellar/stellar-sdk` `Raw*` types as the SPP schema of record.

---

## 7. Files modified this phase

| File | Action |
|------|--------|
| `packages/wallet-core/tests/stellar/spp/harness/browser/docs/FASE-2.3-AUTHORITATIVE-SCHEMAS.md` | **Created** |
| `FIXTURES_NOTES.txt` | **Unchanged** — Phase 2.2 partial/unverified classification remains correct; no correction required |
| Production / harness code / fixtures / mock | **Unchanged** |

## 8. Validation

No executable code changed. **No tests run.**
