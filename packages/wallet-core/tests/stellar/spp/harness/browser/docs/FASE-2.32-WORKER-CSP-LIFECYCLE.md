# Fase 2.32 — DedicatedWorker CSP, Negative Network Probe & Session Teardown

**Fecha:** 2026-10-26  
**HEAD:** `d872ac455f47ab8822aace0ba2f62e1574d6cf27`  
**Staging:** vacío  
**Priors:** FASE-2.29 · 2.30 · 2.31  
**SDK:** `stellar-private-payments@0.2.1`

**Alcance:** solo `packages/wallet-core/tests/stellar/spp/harness/`. Sin producción, Testnet, firma ni envío.

**G8 = FAIL · G9 = FAIL.**

---

## 1. Resumen ejecutivo

1. **Causa raíz del hueco 2.31:** los Dedicated Workers con script `http(s)` **no heredan** la CSP del documento; toman la CSP de las **cabeceras de respuesta del script** (MDN + Chromium desde ~2021). Sin header en el `.js` del worker, el fallo a `.invalid` era DNS/red → `NO DEMOSTRADO_CSP`.  
2. Con `Content-Security-Policy: connect-src 'self'` en el script del worker: classic y module → **PASS_CSP_CONFIRMED** (`SecurityPolicyViolationEvent`, `connect-src`, `blockedURI=*.invalid`).  
3. Control `?nocsp=1` (sin header): fallo de fetch **sin** violación → **NO DEMOSTRADO_CSP** (contraste válido).  
4. `blob:` worker → hereda CSP del documento → **PASS_CSP_CONFIRMED**.  
5. Workers SPP reales: header CSP aplicado por `serve.mjs` (**PASS_HEADER_PRESENT**); inyección negativa `.invalid` en protocolo SDK → **NO DEMOSTRADO** (experimento distinto).  
6. Teardown: cierre de broker ≠ kill de workers; `terminate()` del host sobre workers **rastreables** → **PASS**; mensajes tardíos al worker tras close del broker aún posibles hasta `terminate`.  
7. G8/G9 no se elevan.

---

## 2. Preflight

| Ítem | Resultado |
|------|-----------|
| Raíz | `C:\Users\M\Downloads\Stellar privacy project` |
| HEAD | `d872ac4…` |
| Staging | vacío |
| Informes 2.29–2.31 | Leídos |
| Git mutaciones | Ninguna |

Nota operativa: un `serve.mjs` antiguo en `:8765` oculta headers nuevos (`EADDRINUSE`); la evidencia válida usa el servidor actualizado.

---

## 3. Navegador

| Campo | Valor |
|-------|--------|
| UA | Cursor Chromium `Chrome/148.0.7778.280` Electron/42.10.0 |
| URL | `http://127.0.0.1:8765/.../worker-csp-lifecycle.html` |
| Dump | `window.__SPP_WORKER_LIFECYCLE__` · `ok: true` |

---

## 4. Cómo se aplica la CSP al worker

| Origen del script | Fuente de CSP | Evidencia 2.32 |
|-------------------|---------------|----------------|
| `http(s)` DedicatedWorker | Cabeceras de la respuesta del script | Header leído + violación con `originalPolicy` del **script** |
| `blob:` / `data:` | Hereda del documento creador | blob probe PASS |
| Documento HTML | meta + header de la página | gobierna página + blob |
| Extensión MV3 | CSP de manifest / extension pages | **NO DEMOSTRADO** aquí |

Referencias: [MDN CSP in workers](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy); Chromium “Fix dedicated worker inheritance” (policy container del worker = response headers).

**No** se asume herencia automática documento→worker HTTP.

### Cabeceras harness (`serve.mjs`)

| Recurso | CSP |
|---------|-----|
| `worker-csp-probe.classic.js` / `.module.js` | `connect-src 'self'; script-src 'self'; …` |
| idem `?nocsp=1` | **sin** CSP (control) |
| `storage-worker*.js` / `prover-worker*.js` | `connect-src 'self'` + `'wasm-unsafe-eval'` |
| `worker-csp-lifecycle.html` | doc CSP + `worker-src 'self' blob:` |

`'wasm-unsafe-eval'` solo en doc isolation / workers SPP que cargan WASM — no `unsafe-eval` JS.

---

## 5. Resultados del negative probe

Objetivo: `https://ro1-csp-probe.invalid/…` (sin dominios públicos).

| Experimento | Header CSP en script | Violación CSP | Veredicto |
|-------------|----------------------|---------------|-----------|
| Classic con CSP | sí | `connect-src` + blockedURI `.invalid` | **PASS_CSP_CONFIRMED** |
| Classic `?nocsp=1` | no | ninguna | **NO DEMOSTRADO_CSP** |
| Module con CSP | sí | `connect-src` | **PASS_CSP_CONFIRMED** |
| blob: inherit | (documento) | confirmada | **PASS_CSP_CONFIRMED** |
| SPP `storage-worker.js` inject `.invalid` | header presente | n/a (no inyectado) | **NO DEMOSTRADO** |
| SPP worker header audit | sí (`wasm-unsafe-eval`+`connect-src 'self'`) | — | **PASS_HEADER_PRESENT** |

Un worker de prueba con CSP **no** demuestra automáticamente el comportamiento de red interno del SDK; solo que, si el worker SPP usa `fetch` bajo ese header, `connect-src` aplicaría.

---

## 6. Transporte WASM / `__wbg_fetch`

| Pregunta | Respuesta |
|----------|-----------|
| Binding | `__wbg_fetch` → `fetch` / `Scope.fetch` (estático 2.31) |
| Client en página | Realm documento → CSP **documento** `connect-src` |
| Llamadas desde worker-module SPP | Realm worker → CSP **del script del worker** (si header) |
| Evidencia de bloqueo WASM-página | 2.31 documento PASS |
| Evidencia de bloqueo WASM-dentro-worker SPP | **NO DEMOSTRADO** (sin inject) |
| Canales no cubiertos | Cualquier transporte ≠ fetch (no hallado en glue); scripts sin header CSP |

No se concluye que “todo el tráfico WASM” esté bajo `connect-src` solo por una llamada observada.

---

## 7. Cierre y ciclo de vida

### Offline (Vitest `sessionLifecycle.adversarial.test.ts`)

| Caso | Resultado |
|------|-----------|
| Close normal → deny | **PASS** `SESSION_CLOSED` |
| Error init → sesión cerrada | **PASS** |
| Close durante pending | **PASS** `SESSION_CLOSED` |
| Replay / late response inject | **PASS** deny |
| Gates | **FAIL** fijos |

### Browser

| Caso | Resultado |
|------|-----------|
| Broker close | reject **PASS**; workers **siguen vivos** |
| Mensaje al worker tras broker close | **recibido** (hasta terminate) |
| `registry.terminateAll()` | **PASS** live=0 |
| Reuse sesión cerrada | **PASS** deny |
| Close tras init error / mid-pending | **PASS** |
| “Broker close termina worker SDK” | **Falso** — no afirmado |
| Referencias SDK internas sin tracker | Host solo termina workers que **él** construyó vía `Worker` parcheado |

---

## 8. Real vs mocks

| Pieza | Tipo |
|-------|------|
| Probes classic/module/blob | Workers de prueba |
| `storage-worker.js` spawn+terminate | Script **real** SPP; sin ops prohibidas |
| Broker teardown UI | Backend **fake** |
| SDK RO-1 completo | Evidencia 2.28/2.31 (no re-ejecutado entero aquí) |

---

## 9. G8 / G9

| Gate | Estado | Motivo |
|------|--------|--------|
| **G8** | **FAIL** | Sin host extensión; read-path integración prod ausente |
| **G9** | **FAIL** | Worker de prueba + headers SPP acercan el modelo; falta inject en worker SDK + host MV3 |

---

## 10. Archivos

| Ruta | Rol |
|------|-----|
| `worker-csp-lifecycle.html/.mjs` | Orquestación 2.32 |
| `worker-csp-probe.classic.js` / `.module.js` | Probes |
| `workerRegistry.mjs` | Track + `terminate` |
| `serve.mjs` | CSP en scripts worker (+ `?nocsp=1`) |
| `ro1Broker/sessionLifecycle.adversarial.test.ts` | Offline teardown |
| `docs/FASE-2.32-WORKER-CSP-LIFECYCLE.md` | Este informe |

---

## 11. Recomendación Fase 2.33

1. Spike **offscreen / página extensión** con la misma entrega de CSP en scripts worker (sin merge prod).  
2. Opcional: Reporting endpoint harness para reports CSP de workers.  
3. No aprobar G9 hasta evidencia en host MV3; no afirmar teardown del SDK sin API de dispose de workers.

---

## 12. Git

| Ítem | Valor |
|------|--------|
| HEAD | `d872ac4…` |
| Staging | vacío |
| Commits | ninguno |

---

## 13. Conclusión explícita

### Demostrado (PASS)

- Modelo CSP worker HTTP = headers del script (no herencia doc)  
- Classic/module + blob: bloqueo `.invalid` con violación CSP  
- Control sin CSP ≠ CSP  
- Header CSP en workers SPP servidos por harness  
- Host `terminate()` de workers rastreados  
- Broker close / late / pending / error paths (offline + browser)

### Fallido / no aprobado

- G8, G9  

### NO DEMOSTRADO

- Inject negativo **dentro** del worker SPP real  
- Que dispose del SDK mate workers  
- Host MV3 / CSP de extensión  
