# Fase 2.33 — Real SPP Worker Egress & Disposal Audit

**Fecha:** 2026-10-26  
**HEAD:** `d872ac455f47ab8822aace0ba2f62e1574d6cf27`  
**Staging:** vacío  
**Priors:** FASE-2.29 · 2.30 · 2.31 · 2.32  
**SDK:** `stellar-private-payments@0.2.1` (npm local `node_modules`; repo `NethermindEth/stellar-private-payments` directory `sdk/web`)

**Alcance:** harness only. Sin producción, lockfiles, Testnet, firma, sync ni mutaciones.

**G8 = FAIL · G9 = FAIL.**

---

## 1. Resumen ejecutivo

1. Workers **SDK_REAL** identificados: `storage-worker.js` y `prover-worker.js` (módulos + WASM), creados vía wasm-bindgen `new Worker`.  
2. Cabecera CSP del harness en esos scripts: `connect-src 'self'` + `'wasm-unsafe-eval'` → **PASS_HEADER_PRESENT**.  
3. Intento `.invalid` **dentro** del realm del worker real: **NOT_TESTED** — CDP `Target.*` denegado; sustituir el script invalidaría la etiqueta SDK_REAL.  
4. `Client.dispose()` / `Storage.free()` **no** llaman `Worker.terminate()` (cero `terminate` en el paquete JS publicado; runtime: workers siguen `terminated: false`) → **WORKER_STILL_ACTIVE** / dispose≠terminate.  
5. Host con `Worker` tracker sí puede `terminate()` → **HOST_TERMINATES_TRACKED_WORKER**.  
6. Harness worker ≠ worker SPP. Documento `connect-src` ≠ CSP del worker HTTP.

---

## 2. Preflight

| Ítem | Resultado |
|------|-----------|
| Raíz | `C:\Users\M\Downloads\Stellar privacy project` |
| Rama | `master` |
| HEAD | `d872ac4…` (coincide) |
| Staging | vacío |
| Informes 2.29–2.32 | Leídos |
| SDK | `0.2.1` en `packages/wallet-core/node_modules/stellar-private-payments` |
| Serve | `tests/stellar/spp/harness/browser/serve.mjs` |

---

## 3. Identificación de workers

| Worker | Archivos | Clase | Creación |
|--------|----------|-------|----------|
| Storage | `dist/workers/storage-worker.js` → `storage-worker-module.js` (+ `_bg.wasm`) | **SDK_REAL** | `Storage.open({ workerUrl })` → WASM `new Worker` |
| Prover | `dist/workers/prover-worker.js` → `prover-worker-module.js` (+ `_bg.wasm`) | **SDK_REAL** | `ProverBridge.spawn(url)` → WASM `new Worker` |
| Facades JS | `js/index.js` URLs por defecto | **SDK_REAL** (wiring) | — |
| `worker-csp-probe.*` / audit helpers | harness | **HARNESS_CONTROL** | No confundir con SPP |
| SharedWorker | — | **NOT_IDENTIFIED** en 0.2.1 |
| blob: SPP entries | — | **NOT_IDENTIFIED** |

Runtime (audit page): spawns observados exactamente a esos dos scripts HTTP module.

Glue: `dist/stellar_private_payments_web.js` contiene `new Worker(...)`; módulos worker exponen `__wbg_fetch_*`.

---

## 4. CSP efectiva y egress

### Modelo (2.32 + MDN)

HTTP DedicatedWorker → CSP de **cabeceras del script**, no del documento.

### Headers observados (serve.mjs harness)

```text
default-src 'none'; script-src 'self' 'wasm-unsafe-eval';
connect-src 'self'; worker-src 'self'; object-src 'none'
```

(ambos `storage-worker.js` y `prover-worker.js`)

| Afirmación | Estado |
|------------|--------|
| Header CSP en script SDK_REAL | **PASS** (`PASS_HEADER_PRESENT`) |
| Violación CSP por fetch `.invalid` **dentro** del worker real | **NOT DEMONSTRATED** (`NOT_TESTED`) |
| Documento bloquea `.invalid` con evento CSP | **PASS_CSP_CONFIRMED** (control de página) |
| Inferir bloqueo por DNS sin evento | **Prohibido** — no hecho |

**Impedimento inject:** `Target.getTargets` / attach a worker → *CDP method not allowed* en Cursor browser. Reemplazar `workerUrl` por wrapper harness → **HARNESS_CONTROL**, no prueba del entry SDK_REAL.

No se afirma que `connect-src` del documento controle el worker HTTP.

---

## 5. Disposal / terminación

### API SDK

`Client.dispose()` (`js/index.js`): `telemetrySinks.free()` + `wasmClient.free()`.  
`Storage.free()` / `ProverBridge.free()`: free WASM; **sin** `Worker.terminate` en JS publicado (búsqueda en todo el paquete: **0** coincidencias).

### Runtime (`spp-real-worker-audit.html`)

| Momento | storage/prover `terminated` |
|---------|------------------------------|
| Tras RO-1 | `false` / `false` |
| Tras `client.dispose()` | `false` / `false` → **WORKER_STILL_ACTIVE** |
| Tras `storage.free()` | `false` / `false` → **WORKER_STILL_ACTIVE** |
| Tras `registry.terminateMatching(spp)` | ambos terminados → **HOST_TERMINATES_TRACKED_WORKER** |

| Etiqueta | Aplicación |
|----------|------------|
| `SDK_DISPOSE_TERMINATES_WORKER` | **No** demostrado (contrario: FAIL) |
| `HOST_TERMINATES_TRACKED_WORKER` | **PASS** |
| `BROKER_CLOSED_ONLY` | N/A (esta página no usa broker como único close) |
| `WORKER_STILL_ACTIVE` | Tras dispose/free SDK |
| Actividad de red post-close | **NOT DEMONSTRATED** (no egress espontáneo observado; workers vivos) |

---

## 6. Comandos y pruebas

```text
cd packages/wallet-core
pnpm exec vitest run \
  tests/stellar/spp/harness/browser/sppRealWorker.static.test.ts \
  tests/stellar/spp/harness/browser/browserHarness.availability.test.ts
→ exit 0 · 8 passed

node tests/stellar/spp/harness/browser/serve.mjs
# Open: .../spp-real-worker-audit.html
# Dump: window.__SPP_REAL_WORKER_AUDIT__  ok: true
```

Browser: Cursor Chromium Chrome/148. RO-1: solo `getLedgerEntries`.

---

## 7. Tabla de cierre (requerida)

| Punto | Estado |
|-------|--------|
| Worker real identificado | **PASS** |
| CSP efectiva del worker real comprobada | **PASS** (header del script; no violación in-realm) |
| Intento externo bloqueado específicamente por CSP | **NOT DEMONSTRATED** |
| `dispose()` termina workers propios | **FAIL** |
| No hay actividad posterior al cierre | **NOT DEMONSTRATED** |
| Host MV3 demostrado | **NOT TESTED** |

**G8 = FAIL · G9 = FAIL** (harness ≠ MV3; egress in-worker no confirmado).

---

## 8. Archivos

| Ruta | Rol |
|------|-----|
| `spp-real-worker-audit.html/.mjs` | Auditoría browser |
| `sppRealWorker.static.test.ts` | Identificación + ausencia terminate |
| `serve.mjs` | CSP page + workers SPP |
| `docs/FASE-2.33-REAL-SPP-WORKER-EGRESS-DISPOSAL.md` | Este informe |

Producción / manifests / lockfiles: intactos.

---

## 9. Limitaciones / falsos positivos

- Header CSP ≠ prueba de violación dentro del worker.  
- `terminated: false` tras dispose prueba ausencia de `terminate()` en el wrapper; no prueba que el hilo esté “haciendo trabajo”.  
- Ausencia de requests externos observados ≠ imposibilidad de egress.  
- Entorno sin CDP Target.

---

## 10. Recomendación 2.34

1. Entorno con attach CDP a DedicatedWorker **o** extensión MV3 de prueba con misma CSP en scripts worker.  
2. Política de host: siempre `terminate()` tracked workers al cerrar sesión (no confiar en `dispose()`).  
3. No aprobar G9 hasta PASS in-worker CSP + host relevante.

---

## 11. Git

| Ítem | Valor |
|------|--------|
| HEAD | `d872ac4…` |
| Staging | vacío |
| Commits | ninguno |
