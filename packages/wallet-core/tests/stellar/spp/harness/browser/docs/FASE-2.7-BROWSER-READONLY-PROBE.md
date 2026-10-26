# Fase 2.7 — Browser OPFS Read-Only RPC Probe

**Date:** 2026-10-26  
**Repo:** `C:\Users\M\Downloads\Stellar privacy project` · branch `master` · HEAD `d872ac455f47ab8822aace0ba2f62e1574d6cf27`  
**Harness URL:** `http://127.0.0.1:8765/tests/stellar/spp/harness/browser/index.html`  
**Prior:** Phases 2.4–2.6 (provenance, structural fixtures, Node deser blocker)

## Verdict

In a real browser with OPFS + Storage worker + loopback mock:

1. **`readTokenDecimals` invokes only `simulateTransaction`** (no `getLatestLedger` / `getLedgerEntries` / other methods observed for that call).
2. The mock **rejected** `simulateTransaction` (`reject_unmodeled`). The WASM therefore **did not** accept a success body for that method.
3. **No claim of successful RPC response deserialization** for any success fixture in this phase.
4. OPFS / WASM / worker / Storage all **INICIALIZADO**; network isolation held (**0** external fetches).

---

## Safety checks (before probe)

| Check | Evidence | Result |
|-------|----------|--------|
| `sendTransaction` fail-closed | `mock-rpc.mjs` + Vitest `mockRpc.security.test.ts` | Pass |
| Unknown methods fail-closed | Same | Pass |
| External origins blocked | Harness `installNetworkGuard`; serve binds `127.0.0.1` + Host allowlist | Pass (runtime: `blockedExternal: []`, `externalSentCount: 0`) |
| No live Stellar endpoint | `rpcUrl = location.origin + '/rpc'` only | Pass |
| No write-capable SPP op from Stage D | `readTokenDecimals` only; stages mark register/deposit/transfer/withdraw/`backgroundSync` BLOQUEADO | Pass |

Vitest (pre-probe):

```text
pnpm exec vitest run tests/stellar/spp/harness/browser/mockRpc.security.test.ts \
  tests/stellar/spp/harness/browser/rpcFixtureSchema.test.ts
→ 2 files, 11 tests passed
```

---

## Exact call path tested

**Source (commit `b79107cd…`, `sdk/native/src/chain/rpc.rs`):**

```text
wasm.readTokenDecimals(rpc_url, token_contract)
  → RpcClient::get_token_decimals(contract_id, source)
    → read_contract(..., "decimals", [])
      → build_invoke_contract_tx_envelope(...)
      → simulate_transaction(tx)   // ONLY RPC method
      → parse SimulateTransactionResponse { result|results, retval|xdr }
```

**Harness Stage D:** after WASM init (and after Stage B/C), clear mock log, then:

```text
wasmMod.readTokenDecimals(`${location.origin}/rpc`, synthetic pools[0].tokenContractId)
```

Synthetic token id prefix recorded only: `CADAMBQG…` (full id is local fixture data, not a secret).

**Not invoked:** `backgroundSync`, `registerPublicKeys`, deposit/transfer/withdraw, `sendTransaction`, production vault.

---

## RPC methods observed (Stage D window)

| Method | Outcome | Classification |
|--------|---------|----------------|
| `simulateTransaction` | `reject_unmodeled` (−32601) | **OBS** — only method for this probe; mock refuse (no success fixture served) |

No additional methods in the cleared Stage D log.

Stage B `Client.new` (same run, before Stage D clear): **0** RPC methods (unchanged from Phase 2.1).

Final mock log after Stage D: only the `simulateTransaction` reject above.

---

## Did real WASM deserialize any response?

| Response | Deserialized by WASM? |
|----------|----------------------|
| `simulateTransaction` **success** body | **No** — mock never returned `result`; error path returned to JS: `jsonrpc error: -32601 - … method not modeled (simulateTransaction)` |
| `getLatestLedger` / `getLedgerEntries` fixtures | **Not requested** by `readTokenDecimals` |
| JSON-RPC **error** object | Client surfaced the mock error string (error handling path exercised; **not** success-schema validation) |

`wasmAcceptedSimulateSuccessBody: false` in harness report.

---

## Browser / OPFS / worker results

| Stage | Status |
|-------|--------|
| OPFS (`navigator.storage.getDirectory`) | INICIALIZADO |
| WASM init (local `/node_modules/…wasm`) | INICIALIZADO |
| Storage worker spawn | INICIALIZADO |
| `Storage.open` | INICIALIZADO |
| `Client.new` (no sync) | INICIALIZADO |
| `readTokenDecimals` probe | OBSERVADO_PATH (simulate-only + mock reject) |
| Network | `allowedSameOriginCount: 10`, `blockedExternal: []`, `externalSentCount: 0` |

---

## Network isolation evidence

- Server: `serve.mjs` listen `127.0.0.1:8765`; non-loopback `Host` → 403.
- Page fetch guard: non-`location.origin` → throw; runtime report shows **no** blocked/external sends.
- Mock RPC: same-origin `POST /rpc` only; no forwarding.

---

## Tests / commands actually run

| Command / action | Result |
|------------------|--------|
| Vitest mock + fixture structural tests | **11 passed** |
| `node tests/stellar/spp/harness/browser/serve.mjs` | Listening; page served |
| Cursor browser → harness `index.html` | Phase `2.7` report `ok: true`; Stage D as above |

---

## Remaining blockers / next evidence

1. **`simulateTransaction` success deserialization** still unproven: would need a source-complete success fixture **and** an explicit decision to serve it in the mock (currently fail-closed by policy). Even then, that validates simulate — **not** the existing `getLatestLedger` / empty `getLedgerEntries` fixtures.
2. **`getLatestLedger` / `getLedgerEntries` WASM accept** still need a read-only path that **calls** those methods (e.g. carefully scoped `bootnodeRequired` or sync-adjacent probe) while keeping writes/`sendTransaction` blocked.
3. Phase 2.5 structural checks remain the offline CI gate for ledger fixtures.

---

## Files changed (harness only)

- `harness.mjs` — Stage D `readTokenDecimals` probe; phase `2.7`; write-path markers
- `index.html` — title
- `docs/FASE-2.7-BROWSER-READONLY-PROBE.md` — this report
- `fixtures/FIXTURES_NOTES.txt` — pointer to 2.7 (if updated)

No production code changes. No new success RPC fixtures.
