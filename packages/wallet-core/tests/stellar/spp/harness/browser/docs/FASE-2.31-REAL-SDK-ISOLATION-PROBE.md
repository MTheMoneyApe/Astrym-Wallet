# Fase 2.31 — Real SDK Isolation Probe & Enforced Network Policy

**Fecha:** 2026-10-26  
**HEAD:** `d872ac455f47ab8822aace0ba2f62e1574d6cf27`  
**Staging:** vacío  
**Priors:** FASE-2.27 · 2.28 · 2.29 · 2.30  
**SDK:** `stellar-private-payments@0.2.1` (**real**, no fakes de API pública)

**Alcance:** harness only. Sin producción, manifests, lockfiles, Testnet, firma ni envío.

**G8 = FAIL · G9 = FAIL.**

---

## 1. Resumen ejecutivo

1. Bajo CSP `connect-src 'self'` (+ `'wasm-unsafe-eval'` documentado), el recorrido real RO-1 **PASS**: `Storage.open` → `Client.new` → `aspState` → `allContractsData`; RPC mock solo `getLedgerEntries`.  
2. Bloqueo externo en **documento** a `https://ro1-csp-probe.invalid/…` = **PASS_CSP_CONFIRMED** (`SecurityPolicyViolationEvent`, `effectiveDirective=connect-src`).  
3. Mismo intento desde **DedicatedWorker** de prueba: fetch falla, pero **sin** violación CSP atribuida → **NO DEMOSTRADO_CSP** (no se afirma bloqueo CSP en worker).  
4. Transporte WASM: bindings `__wbg_fetch` → `fetch` del realm (estático + runtime coherente). CSP de documento cubre fetch del realm de página; workers/SDK workers no inyectables → cobertura parcial.  
5. `'wasm-unsafe-eval'` es **necesario** en Chromium (violación `script-src` / `blockedURI=wasm-eval` sin él).  
6. G8/G9 **no** se aprueban: falta host MV3 y prueba CSP en workers/SDK workers.

---

## 2. Preflight

| Ítem | Resultado |
|------|-----------|
| Raíz | `C:\Users\M\Downloads\Stellar privacy project` |
| HEAD | `d872ac4…` |
| Staging | vacío |
| Informes 2.27–2.30 | Leídos (limitaciones workers/WASM/CSP externo) |
| Git mutaciones | Ninguna |

---

## 3. Navegador y entorno

| Campo | Valor |
|-------|--------|
| Host | Cursor embedded Chromium · `Chrome/148.0.7778.280` · Electron/42.10.0 |
| Nota | No Chrome/Edge desktop nativo; válido para documento harness |
| Serve | `127.0.0.1:8765` · `serve.mjs` |
| URL principal | `…/ro1-isolation-host.html` |
| Dump | `window.__SPP_ISOLATION_RESULT__` |

Automatización: CDP/Cursor browser (equivalente a validación manual reproducible).  
Manual: `node tests/stellar/spp/harness/browser/serve.mjs` → abrir URL isolation.

---

## 4. CSP efectiva

### 4.1 Documento (`ro1-isolation-host`)

**Meta + header HTTP** (serve.mjs):

```text
default-src 'none'; base-uri 'none';
script-src 'self' 'wasm-unsafe-eval';
style-src 'self';
connect-src 'self';
worker-src 'self';
img-src 'none'; font-src 'none'; object-src 'none';
frame-src 'none'; form-action 'none'
```

| Directiva | Efecto observado |
|-----------|------------------|
| `connect-src 'self'` | Violación enforce al fetch `.invalid` en documento |
| `script-src 'self' 'wasm-unsafe-eval'` | Permite instantiate WASM SPP |
| `worker-src 'self'` | Permite storage/prover/csp-negative workers same-origin |

Evidencia de política en violación: `originalPolicy` coincide con la CSP anterior.

### 4.2 Necesidad de `wasm-unsafe-eval`

Página `csp-wasm-requirement.html` (**sin** `wasm-unsafe-eval`):

| Resultado | Valor |
|-----------|--------|
| `WebAssembly.instantiate` | Falla |
| Violación | `effectiveDirective=script-src`, `blockedURI=wasm-eval`, `disposition=enforce` |
| Veredicto | **PASS_CSP_BLOCKS_WASM_WITHOUT_UNSAFE_EVAL** |

No se usa `unsafe-eval` / `unsafe-inline` de JS. Solo `'wasm-unsafe-eval'` con evidencia.

### 4.3 Workers

| Afirmación | Estado |
|------------|--------|
| Dedicated workers “heredan” CSP del documento (Chromium) | Hipótesis de plataforma; **no** re-demostrada con evento CSP en este probe |
| Violación CSP en worker al tocar `.invalid` | **NO DEMOSTRADO** (fetch failed, `violations: []`) |
| Page fetch guard ≠ worker | Confirmado (2.30/2.31): no se usa patch como enforcement |

---

## 5. Transporte WASM / workers (SDK)

### Estático (Vitest)

Archivos `stellar_private_payments_web.js`, `storage-worker-module.js`, `prover-worker-module.js`:

- `__wbg_fetch_*` → `fetch(getObject…)` / `getObject(arg0).fetch(…)`

### Runtime

| Canal | Sujeto a CSP `connect-src` del realm | Evidencia 2.31 |
|-------|--------------------------------------|----------------|
| WASM Client en página | Sí, vía `fetch` del documento | Inferido de bindings + CSP confirmada en documento; RPC solo same-origin |
| storage-worker / prover-worker | Sí **si** usan fetch en ese worker y CSP aplica | Bindings sí; **negativo CSP no demostrado** en worker |
| Sockets nativos no-fetch | N/A en glue inspeccionado | No hallado fuera de fetch |

**No** se infiere aislamiento solo por “no hubo requests externos en observe-log” (`pageFetchExternalObserved: []`).

---

## 6. Recorrido SDK real

| Etapa | Estado |
|-------|--------|
| OPFS | INICIALIZADO |
| WASM init | INICIALIZADO |
| `Storage.open` | INICIALIZADO · worker `storage-worker.js` |
| `Client.new` | INICIALIZADO · `prover-worker.js` (init; prove no llamado) |
| `aspState` | OBSERVADO |
| `allContractsData` | OBSERVADO |
| RPC | solo `getLedgerEntries` · `rpcOnlyGetLedgerEntries: true` |
| APIs públicas | **no** sustituidas por fakes |

Workers spawneados: probe CSP + storage + prover (3).

---

## 7. Pruebas negativas de red

Objetivo: `https://ro1-csp-probe.invalid/isolation` (TLD `.invalid`, sin servicios públicos).

| Contexto | Fetch | Violación CSP | Veredicto |
|----------|-------|---------------|-----------|
| Documento (antes SDK) | failed | `connect-src` + blockedURI `.invalid` | **PASS_CSP_CONFIRMED** |
| DedicatedWorker probe | failed (local OK) | ninguna | **NO DEMOSTRADO_CSP** |
| Documento (después SDK) | failed | `connect-src` | **PASS_CSP_CONFIRMED** |
| Inyección en worker SPP | — | — | **NO DEMOSTRADO** |
| Control local `/mock-rpc-log` | 200 | — | **PASS** |

Leyenda: fallo DNS sin evento CSP ≠ bloqueo CSP demostrado.

---

## 8. Adversarial

| Prueba | Resultado |
|--------|-----------|
| Mock rechaza `sendTransaction` | **PASS** (error allowlist) |
| tryInvoke sync/sign/send/deposit | **PASS** deny |
| Invoke tras `close` | **PASS** deny |
| Workers vivos tras close | **NO DEMOSTRADO** |
| Broker tipado (offline 2.30) | **PASS** (re-ejecutado en batch estático/broker; sin relajar) |
| Fallback a métodos bloqueados | No observado |

---

## 9. Real vs mocks

| Capa | Real / mock |
|------|-------------|
| `Storage` / `Client` / asp / allContracts | **SDK real 0.2.1** |
| Ledger RPC | **Mock** `/rpc-ro1` fixture |
| Broker browser 2.30 | Fake (no esta página) |
| Enforcement red documento | **CSP browser** (no patch deny) |
| Observe-fetch | Solo telemetría |

---

## 10. Clasificación G8 / G9

| Gate | Estado | Justificación |
|------|--------|---------------|
| **G8** | **FAIL** | Read path real en **documento harness** no activó sync/sign/send (PASS parcial de comportamiento), pero **no** es integración extensión MV3 ni broker de producción |
| **G9** | **FAIL** | CSP documento confirmada; worker CSP **NO DEMOSTRADO**; sin host extensión; wasm-unsafe-eval ensancha script-src |

Página documental ≠ garantías del host de extensión.

---

## 11. Limitaciones de instrumentación

- Cursor Chromium ≠ Chrome/Edge instalado.  
- Workers: eventos CSP no observados en el probe.  
- No se puede forzar fetch `.invalid` **dentro** de storage/prover SPP sin modificar el SDK.  
- `session.close` / `dispose` no prueba kill de workers.  
- Ausencia de URLs externas en observe-log ≠ prueba de imposibilidad.

---

## 12. Archivos (harness)

| Archivo | Rol |
|---------|-----|
| `ro1-isolation-host.html/.mjs` | SDK real + CSP + negativos |
| `csp-negative-probe.worker.js` | Worker `.invalid` |
| `csp-wasm-requirement.html/.mjs` | Evidencia wasm-unsafe-eval |
| `serve.mjs` | Header CSP paths 2.31 |
| `wasmTransport.static.test.ts` | Bindings fetch |
| `docs/FASE-2.31-REAL-SDK-ISOLATION-PROBE.md` | Este informe |

---

## 13. Recomendación Fase 2.32

1. Aislar evidencia CSP en **workers** (Reporting API / `report-to`, o Chrome DevTools Protocol `Security.csp*` / network blocked-reason) hasta **PASS_CSP_CONFIRMED** o documentar imposibilidad.  
2. Spike **offscreen/página extensión** con la misma CSP (sin merge prod) para acercar G8.  
3. No aprobar G9 hasta worker+CSP + host extensión; no ampliar CSP en silencio.

---

## 14. Git

| Ítem | Valor |
|------|--------|
| HEAD | `d872ac4…` |
| Staging | vacío |
| Commits | ninguno |

---

## 15. Separación final

### Demostrado (PASS)

- SDK real RO-1 bajo CSP con mock local  
- Solo `getLedgerEntries` en mock  
- CSP documento bloquea `.invalid` con violación `connect-src`  
- WASM requiere `'wasm-unsafe-eval'` (violación `wasm-eval`)  
- Bindings HTTP = `fetch`  
- Deny superficie + mock send  

### Fallido / no aprobado

- G8, G9  

### NO DEMOSTRADO

- Bloqueo CSP **confirmado** en DedicatedWorker  
- Negativo dentro de workers SPP  
- Terminación de workers tras close  
- Host MV3 / extensión  
