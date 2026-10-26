# Fase 2.36 — Chrome Desktop operator runbook

**Artifact:** this folder (`mv3-spike`), version **0.0.36**  
**SDK:** `stellar-private-payments@0.2.1` under `vendor/`  
**NOT** production Solanym. No vault, seeds, signing, Testnet, or public RPC.

Preparation of this package is **not** Chrome Desktop execution. Fill evidence only after real Chrome steps below.

---

## 0. Prerequisites

1. Install **Google Chrome** (Desktop) if missing.
2. From `packages/wallet-core`:

```text
node tests/stellar/spp/harness/browser/serve.mjs
```

Confirm `http://127.0.0.1:8765/rpc-ro1` is up (loopback only).

3. In this folder:

```text
node prepare-vendor.mjs
```

Expect exit `0` and `vendor/VENDOR_META.json` with `"version": "0.2.1"`.

4. Optional static check:

```text
node validate-artifact.mjs
```

---

## 1. Load unpacked

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select this directory:  
   `...\packages\wallet-core\tests\stellar\spp\harness\mv3-spike`
4. Record:
   - Chrome version: `chrome://version` → copy into evidence
   - Extension ID (32-char id on the card)
   - Artifact version from card (`0.0.36`)

---

## 2. Service worker check (no SDK in SW)

1. On the extension card → **Service worker** / “Inspect views: service worker”
2. In SW console:

```js
typeof importScripts
// Confirm you did NOT import stellar-private-payments
```

3. Popup → **Ping SW** → response must include `"sdkInServiceWorker": false`
4. Popup → **Send unknown type** → expect `UNKNOWN_METHOD` / envelope error

---

## 3. Open host (extension page)

1. Popup → **Open RO-1 host**  
   URL must be `chrome-extension://<id>/host/spp-ro1-host.html`
2. Confirm banner and context line show `extensionPage=true`

---

## 4. Broker adversarial

On host page → **Broker adversarial**.  
Expect rejects for malformed, unknown type, extra fields, duplicate `requestId`, unknown dispatch method.

---

## 5. Run RO-1

1. Ensure `serve.mjs` still listening.
2. Host → **Run RO-1**
3. Expect `aspState` / `allContractsData` ok; RPC log only `getLedgerEntries`
4. Denied RPC probes (`sendTransaction`, etc.) show `rejected: true`

---

## 6. Effective CSP

### Page

- Manifest `content_security_policy.extension_pages` is authoritative for extension pages (HTML meta CSP is ignored).
- Optional: host records document fetch to `https://csp-probe.invalid/` + `securitypolicyviolation` → `PASS_CSP_CONFIRMED` if attributed.

### Workers (real SDK scripts)

1. After RO-1, DevTools on host → **Sources** → **Threads** (or Network) → note `storage-worker.js` / `prover-worker.js` under `chrome-extension://…/vendor/dist/workers/`
2. Effective CSP for those workers = **same** `extension_pages` CSP (no separate HTTP CSP header expected).
3. Record in evidence that worker script fetch showed `cspHeader: null` with note about manifest policy.

---

## 7. Worker egress probe (required technique)

**Do not** replace `workerUrl` with a harness wrapper (that would invalidate “SDK_REAL”).

1. Host DevTools → select the **worker** thread for `storage-worker.js`
2. In **that** worker’s console:

```js
fetch('https://csp-probe.invalid/', { mode: 'cors' })
  .then(r => console.log('OK', r.status))
  .catch(e => console.error('ERR', e && e.message, e));
```

3. Also watch the worker console / Issues for a **Content Security Policy** / `Refused to connect` message naming `connect-src` or CSP.
4. Classify on the host form:
   - **PASS_CSP_CONFIRMED** — CSP violation attributed (console/Issues), not merely DNS
   - **DNS_OR_NETWORK_ONLY** — TypeError/DNS without CSP attribution
   - **NOT_DEMONSTRATED** — could not open worker console / inconclusive
   - **FAIL_REACHED** — request appeared allowed
5. Repeat for `prover-worker.js` if present
6. Click **Record egress attempt**

---

## 8. Close / residual activity

1. After RO-1 → **Emergency close now**
2. Confirm evidence `lifecycle` shows terminate on registered workers; repeat close idempotent
3. Try late construct / note `HOST_CLOSED`
4. Network panel + worker threads: look for post-close requests (5–10s)
5. Record post-close classification:
   - **NO_ACTIVITY_OBSERVED** ≠ proven absence
   - **ABSENCE_DEMONSTRATED** only with explicit proof quality (usually **not** claimable)
6. Optional: **Close before workers** on a fresh reload

### 8.1 Post-close **ABSENCE_DEMONSTRATED** (strict — usually not claimable)

Dropdown alone does **not** satisfy the evaluator. Export / store must include:

```json
"postClose": {
  "classification": "ABSENCE_DEMONSTRATED",
  "proof": {
    "observeWindowMs": 8000,
    "networkRequestsObserved": 0,
    "liveWorkerThreadsObserved": 0,
    "technique": "devtools_network_and_threads",
    "recordedAt": "<ISO>"
  }
}
```

### 8.2 Nested workers (Chrome observation)

Host `window.Worker` wrapper **cannot** see `Worker()` inside DedicatedWorker realms. Vendor `*-worker-module.js` contains wasm-bindgen `new Worker(` glue — static Node audit reports call sites; that is **not** a runtime PASS.

To claim `NO_NESTED_OUTSIDE_REGISTRY` in evidence (after RO-1 and/or after close):

```json
"nestedWorkers": {
  "runtimeObservation": "NO_NESTED_OUTSIDE_REGISTRY",
  "method": "devtools_sources_threads",
  "staticAudit": { "newWorkerCallSites": "<from node audit>" },
  "proof": {
    "observedAt": "<ISO>",
    "threadsSeen": ["storage-worker.js", "prover-worker.js"],
    "wasmGlueNewWorkerRuledOut": true
  }
}
```

`wasmGlueNewWorkerRuledOut: true` only if you can justify no nested spawn (e.g. Threads never showed extra workers during RO-1 + post-close). If unsure, leave nested as NOT_DEMONSTRATED — **G9 stays FAIL**.

CDP attach plan (not auto-run): `chrome/cdp-residual-observation.PLAN.md`.

---

## 9. Export evidence

1. Host → **Download evidence JSON** (filename includes `sessionId`)
2. Save as:  
   `mv3-spike/evidence/runs/spp-2.36-evidence-<sessionId>-<timestamp>.json`
3. Paste Chrome version into the JSON `chrome.version` field if empty (or keep UA)
4. Do **not** include seeds, passwords, or personal data
5. **Reload / new host tab starts a NEW empty session.** Prior RO-1 is retained in `chrome.storage.local` under key `spp_2_36_session_store_v1` and in prior export files — it is **not** merged into the new export’s `workers`/`rpc` fields. Check `previousSessionId` / `previousSessionRecoverable`.
6. Offline validate (does not talk to network):

```text
node evidence/validate-evidence-cli.mjs path/to/export.json
node evidence/validateEvidence.test.mjs
```

G8/G9 stay **FAIL** unless every checklist criterion in `evaluateGates.mjs` is PASS (spike almost never: production integration + post-close absence + nested workers).

---

## 10. What this runbook does / does not prove

| Claim | After successful operator run |
|-------|-------------------------------|
| Host is real extension page | Can be PASS |
| SW does not run SDK | Can be PASS |
| RO-1 allowlist RPC | Can be PASS |
| Workers registered + host terminate | Can be PASS |
| Worker CSP egress block | Only if PASS_CSP_CONFIRMED |
| No post-close activity | Usually NOT DEMONSTRATED |
| G8 / G9 | Still evaluated in FASE-2.36 report; do not auto-flip from harness twin |

---

## Spike-only permissions

| Permission | Why |
|------------|-----|
| `storage` | Harmless MV3 default; unused for vault |
| `host_permissions`: `http://127.0.0.1:8765/*` | Loopback mock RPC + fixtures only |

No `debugger`, no broad `<all_urls>`, no production wallet permissions.
