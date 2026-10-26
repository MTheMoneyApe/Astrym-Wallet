# Fase 2.27 — Browser Document Host + SPP SDK bajo Mock/Guard

**Fecha:** 2026-10-26  
**HEAD:** `d872ac455f47ab8822aace0ba2f62e1574d6cf27`  
**Staging:** vacío  
**Priors:** FASE-2.24 · 2.25 · 2.26  
**SDK:** `stellar-private-payments@0.2.1` (npm local; NOTICE commit `b79107cd…`)

**No es** integración de wallet / extensión. **G8/G9 = FAIL.**

---

## 1. Resumen ejecutivo

1. Spike documental **RO-1** añadido: `ro1-host.html` + `ro1-host.mjs` — sesión estrecha sobre el **SDK real**, Client crudo no expuesto en `window`.  
2. Mock **`/rpc-ro1`**: solo `getLedgerEntries` (fixture `allContractsMinimal`); rechaza send/simulate/tip/events.  
3. Instrumentación de red **a nivel de página** (`fetch`/XHR + log de `Worker`); **NO DEMOSTRADO** el tráfico dentro de workers/WASM-native.  
4. Suite Node offline: **artefactos + mock RO-1** (43 tests en batch con readOnlyPolicy).  
5. **Ejecución headless del SDK en este entorno: no realizada** (Chrome/Edge no encontrados; Playwright no instalado). El recorrido real del SDK en browser queda evidenciado por **código del spike + OBS históricas 2.9/2.12**, no por un dump 2.27 automatizado.

---

## 2. Preflight

| Ítem | Resultado |
|------|-----------|
| Raíz / HEAD | OK `d872ac4…` |
| Staging | vacío |
| Informes 2.24–2.26 | Leídos |
| Backup / manifests / extensión | No tocados |

---

## 3. Arquitectura y entorno

```text
Browser document (ro1-host.html)     serve.mjs @ 127.0.0.1:8765
  ├─ page network guard (fetch/XHR)  ├─ static: wallet-core + node_modules/spp
  ├─ Ro1BrowserSession (narrow API)  ├─ POST /rpc-ro1 → getLedgerEntries only
  │    Storage.open (real)
  │    Client.new (real, no backgroundSync)
  │    aspState / allContractsData (real)
  └─ window.__SPP_RO1_RESULT__ report
     window.__SPP_RO1_SESSION__ { tryInvoke, listDenied }  // no Client
```

| Pieza | Valor |
|-------|--------|
| Package | `node_modules/stellar-private-payments` **0.2.1** |
| WASM | `dist/stellar_private_payments_web_bg.wasm` |
| Workers | `storage-worker.js`, `prover-worker.js` (init load) |
| Config | `synthetic-contract-config.json` (sintético) |
| Fixture RPC | `getLedgerEntries.allContractsMinimal.result.json` |

---

## 4. Comandos reproducibles

```text
cd packages/wallet-core
node tests/stellar/spp/harness/browser/serve.mjs
# Open:
# http://127.0.0.1:8765/tests/stellar/spp/harness/browser/ro1-host.html

pnpm exec vitest run \
  tests/stellar/spp/harness/browser/ro1Host.spike.test.ts \
  tests/stellar/spp/harness/browser/mockRpc.security.test.ts \
  tests/stellar/spp/harness/readOnlyPolicy/
# → 5 files, 43 passed (esta fase)
```

Headless automatizado: **no disponible** aquí (sin Chrome/Edge/Playwright). Abrir la URL manualmente en Chromium con OPFS.

---

## 5. Recorrido esperado (SDK real)

| Paso | ¿SDK real? | Dependencias | RPC esperado | Notas |
|------|------------|--------------|--------------|-------|
| `Storage.open` | Sí | OPFS + storage-worker | ninguno | Falla cerrada si no hay OPFS |
| `Client.new` | Sí | prover-worker + circuits ping | ninguno al init (SRC) | `backgroundSync` no llamado |
| `aspState` | Sí | StateFetcher | `getLedgerEntries` | Resultado decodificado + fixture sintético |
| `allContractsData` | Sí | StateFetcher | `getLedgerEntries` | Idem |
| Mutators / sync / sign | No invocados | — | — | `tryInvoke` deny |

**Resultado del transporte:** fixture sintético (compatible forma SDK, FASE-2.12).  
**Resultado de la lógica SDK:** código WASM real (no stub de `aspState`).

### Ejecución en este agente

| Hecho | Estado |
|-------|--------|
| Spike código + `/rpc-ro1` | Implementado |
| Vitest mock/artefactos | PASS |
| Browser dump headless 2.27 | **NO DEMOSTRADO** (sin browser en PATH) |
| OBS previa aspState/allContractsData | FASE-2.9 / 2.12 (mismo SDK + mock entries) |

---

## 6. Tabla RPC (diseño RO-1)

| Método | `/rpc-ro1` |
|--------|------------|
| `getLedgerEntries` | synthetic allContractsMinimal |
| `sendTransaction` | reject |
| `simulateTransaction` | reject |
| `getLatestLedger` | reject |
| `getEvents` | reject |
| otros | reject |

Log: `GET /mock-rpc-log` (compartido con mock general; clear vía POST).

---

## 7. Red / capacidades

| Mecanismo | Estado |
|-----------|--------|
| `fetch` página | Instrumentado; externo bloqueado |
| XHR página | Instrumentado |
| `Worker` constructor | Contado; **red interna NO DEMOSTRADA** |
| fetch en storage/prover workers | **NO DEMOSTRADO** |
| reqwest/WASM si no usa fetch de página | **NO DEMOSTRADO** |
| Ausencia de requests observados | ≠ prueba de aislamiento total |

Serve: bind `127.0.0.1`, Host allowlist loopback (ya en `serve.mjs`).

---

## 8. G8 / G9

| Gate | Veredicto | Por qué |
|------|-----------|---------|
| **G8** | **FAIL** | Sin integración extensión; sin dump browser 2.27 automatizado; spike ≠ evidencia de host real |
| **G9** | **FAIL** | Guard de página incompleto vs workers/WASM; sin política de host extensión |

---

## 9. Archivos

| Archivo | Cambio |
|---------|--------|
| `browser/ro1-host.html` | Nuevo — página spike |
| `browser/ro1-host.mjs` | Nuevo — sesión RO-1 + SDK real |
| `browser/mock-rpc.mjs` | `handleRo1JsonRpcRequest` + mode `ro1` |
| `browser/serve.mjs` | Monta `/rpc-ro1` |
| `browser/ro1Host.spike.test.ts` | Nuevo — tests Node |
| `browser/browserHarness.availability.test.ts` | Assert ro1-host existe |
| `…/docs/FASE-2.27-BROWSER-HOST-SDK-SPIKE.md` | Este informe |

Producción / manifests / lockfiles / extensión: **intactos**.

---

## 10. Recomendación Fase 2.28

1. Ejecutar el spike en Chromium local (manual o CI con browser autorizado **sin** nueva dep no aprobada) y archivar `__SPP_RO1_RESULT__`.  
2. Si se aprueba herramienta headless: assert `ok===true`, `rpcOnlyGetLedgerEntries`, `blocked.length===0`.  
3. Empezar **diseño** `spp-host.html` en extensión (sin merge prod) solo tras dump RO-1 verde.  
4. Mantener G8/G9 FAIL hasta host extensión + instrumentación worker.

---

## 11. Conclusión honesta

| Demostrado ahora | Simulado / no verificado |
|------------------|---------------------------|
| Interfaz RO-1 + deny mutators (código) | Ejecución browser 2.27 en este entorno |
| Mock RO-1 fail-closed (Vitest) | Aislamiento red dentro de workers |
| Reuso infraestructura 2.7–2.12 | G8/G9 |
| SDK 0.2.1 presente para serve same-origin | Extensión MV3 |

**Bloqueo técnico siguiente:** falta un runtime de navegador en CI/agente (o dump manual archivado) para cerrar el lazo “SDK real + mock + guard de página” con evidencia reproducible de esta fase.

---

## 12. Git final

| Ítem | Valor |
|------|--------|
| HEAD | `d872ac4…` |
| Staging | vacío |
| Tests Node | 43 passed (batch citado) |
| Tráfico externo | no |
