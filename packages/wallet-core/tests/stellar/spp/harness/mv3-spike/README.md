# Fase 2.36 — Isolated MV3 RO-1 host spike (TEST ONLY)

**Version:** `0.0.36`  
**Not** the production Solanym wallet. No vault, seeds, or signing.

| Doc | Purpose |
|-----|---------|
| `OPERATOR-RUNBOOK.md` | Exact Chrome Desktop steps + evidence export |
| `validate-artifact.mjs` | Static readiness (does **not** run Chrome) |
| `evidence/validate-evidence-cli.mjs` | Validate one export JSON + evaluate G8/G9 |
| `evidence/validateEvidence.test.mjs` | Session persistence / empty export / dedupe tests |
| `evidence/postCloseNested.test.mjs` | Post-close proof schema + containment + static nested audit |
| `evidence/g9ResidualCriteria.mjs` | Exact G9 residual conditions |
| `chrome/cdp-residual-observation.PLAN.md` | CDP plan (not executed) |
| `chrome/devtools-assisted-residual.md` | DevTools + fieldset D assist |
| `evidence/residualDraftBuilder.mjs` | Rejects incomplete residual claims |
| `evidence/wasmGlueWorkerReachability.mjs` | Glue `new Worker(` reachability notes |
| `evidence/TEMPLATE.json` | Manual fill-in if UI export unavailable |
| `evidence/runs/` | Drop exported `spp-2.36-evidence-*.json` here |
| `evidence/fixtures/` | Sample exports for offline validation (never overwrite) |

## Quick start (operator)

```text
# terminal A — from packages/wallet-core
node tests/stellar/spp/harness/browser/serve.mjs

# terminal B — this folder
node prepare-vendor.mjs
node validate-artifact.mjs
# Then Chrome → chrome://extensions → Load unpacked → this folder
# Follow OPERATOR-RUNBOOK.md
```

## Architecture

- **Host:** `host/spp-ro1-host.html` (SDK + containment + RO-1)
- **SW:** `background.js` typed broker only (no SDK)
- **RPC:** `http://127.0.0.1:8765/rpc-ro1` allowlist `getLedgerEntries`
- **Vendor:** `prepare-vendor.mjs` → `vendor/` (`stellar-private-payments@0.2.1`)

## Permissions (spike-only)

- `storage`
- `host_permissions`: `http://127.0.0.1:8765/*`

## Harness twin (not Chrome Desktop)

`../browser/mv3-csp-ro1-host.html` via `serve.mjs` remains Fase 2.35 automated evidence. It does **not** replace Chrome Desktop validation for G8/G9.
