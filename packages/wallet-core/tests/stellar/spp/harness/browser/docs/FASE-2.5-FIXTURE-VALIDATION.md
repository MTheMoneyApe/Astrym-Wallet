# Fase 2.5 — Validate SPP RPC Fixtures Against Version-Matched Source

**Date:** 2026-10-26  
**Repo:** `C:\Users\M\Downloads\Stellar privacy project` · branch `master` · HEAD `d872ac455f47ab8822aace0ba2f62e1574d6cf27`  
**Authority:** upstream commit `b79107cd24327198f8eb2dbaf4bdc65a8a1e8cf1` (`sdk/native/src/chain/rpc.rs`)  
**Provenance:** Phase 2.4 SLSA chain — isolation dir  
`C:\Users\M\AppData\Local\Temp\spp-fase24-rpc-source-20261025-233039\`  
(snapshot hashes re-verified before this phase: `rpc.rs` / `package.json` / `indexer.rs` OK)

## Verdict

Existing **success** fixtures for `getLatestLedger` and empty `getLedgerEntries` are **schema-valid** against the version-matched Rust types. Values remain **synthetic**. Methods without complete, source-backed success fixtures stay **fail-closed**. Structural Vitest checks were added; they are **not** Rust serde or WASM deserialization proofs.

---

## Per-method fixture audit

| Method | Fixture / mock behavior | Schema validity | Value plausibility | Safe in harness? | Validated by SDK deserializer? |
|--------|-------------------------|-----------------|--------------------|------------------|--------------------------------|
| `getLatestLedger` | `fixtures/getLatestLedger.result.json` | **Yes** — exact keys `id` (string), `sequence` (u32), `protocolVersion` (u32); no extras | Synthetic id/sequence/protocolVersion — **not** a real ledger | **Yes** (read-only tip stub) | **No** — structural TS only; Phase 2.1 `Client.new` issued 0 RPC calls |
| `getLedgerEntries` | `fixtures/getLedgerEntries.empty.result.json` | **Yes** — `entries: []`, `latestLedger` integer; entry shape unused | Honest empty; no invented XDR | **Yes** | **No** — structural only |
| `getEvents` | Unmodeled → `-32601` | N/A (no success fixture) | — | **Blocked** (correct) | N/A |
| `getTransaction` | Unmodeled → `-32601` | Source allows `{ status, resultXdr? }` only | — | **Blocked** until explicitly needed | N/A |
| `simulateTransaction` | Unmodeled → `-32601` | Would need `latestLedger` + optional result/results/… | — | **Blocked** | N/A |
| `sendTransaction` | Always JSON-RPC error | Success body must **never** be returned | — | **Permanently fail-closed** | N/A |

### Required fields verified from source (`rpc.rs` @ `b79107cd`)

- **getLatestLedger result:** `id`, `protocolVersion`, `sequence` (all required). Params: `{}`.
- **getLedgerEntries result:** `latestLedger` (i64); `entries` optional/`null`/array of `{ key, xdr, lastModifiedLedgerSeq }`. Params: `{ keys: [base64…] }`.
- **getEvents result:** `events`, `latestLedger`, `latestLedgerCloseTime`, `oldestLedger`, `oldestLedgerCloseTime`, `cursor` (indexer requires cursor).
- **getTransaction result:** `status`; optional `resultXdr`.
- **simulateTransaction result:** `latestLedger`; optional `result` / `results` / `transactionData` / `minResourceFee` / `error`.
- **sendTransaction result (never served):** `hash`, `status`, `latestLedger`; optional `errorResultXdr`. Client treats `status == "ERROR"` as failure.

---

## Tests added / updated

| File | Role |
|------|------|
| `rpcFixtureSchema.ts` | Dependency-free structural validators labeled as non-serde |
| `rpcFixtureSchema.test.ts` | Fixture load + mock path + malformed/blocked/unknown-method cases |
| `mockRpc.security.test.ts` | Comment only — references `rpc.rs` field contract |
| `fixtures/FIXTURES_NOTES.txt` | Reclassified schema-valid vs blocked |

### Commands and outcomes

```text
cd packages/wallet-core
pnpm exec vitest run tests/stellar/spp/harness/browser/rpcFixtureSchema.test.ts tests/stellar/spp/harness/browser/mockRpc.security.test.ts
```

**Actual result:** Vitest v5.0.1 — **2 files passed, 11 tests passed** (exit 0), duration ~733ms.  
Typecheck/build not required (harness test-only changes; no `src/` edits).

---

## Explicit limitations

1. Structural TypeScript checks ≠ compiling/exercising Rust `serde` or the installed WASM deserializer.  
2. Schema-valid synthetic fixtures ≠ real network ledgers, accounts, or private-payment progress.  
3. No `Client.new` against live RPC, no `backgroundSync`, pools, registration, deposits, transfers, withdrawals, or valid signatures in this phase.  
4. `sendTransaction` success remains **blocked** even if a structural success body could be written.  
5. `getEvents` / `simulateTransaction` / `getTransaction` success fixtures remain **blocked** (no new success fixtures added).

---

## Files changed (harness only)

- `tests/stellar/spp/harness/browser/rpcFixtureSchema.ts` (new)
- `tests/stellar/spp/harness/browser/rpcFixtureSchema.test.ts` (new)
- `tests/stellar/spp/harness/browser/mockRpc.security.test.ts` (comment)
- `tests/stellar/spp/harness/browser/fixtures/FIXTURES_NOTES.txt`
- `tests/stellar/spp/harness/browser/docs/FASE-2.5-FIXTURE-VALIDATION.md` (this file)

Fixture JSON bodies unchanged (already schema-aligned).
