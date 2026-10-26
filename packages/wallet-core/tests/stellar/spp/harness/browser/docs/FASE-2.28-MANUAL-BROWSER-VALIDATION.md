# Fase 2.28 — Validación manual del Browser Host RO-1

**Fecha:** 2026-10-26  
**HEAD:** `d872ac455f47ab8822aace0ba2f62e1574d6cf27`  
**Staging:** vacío (antes y después de este informe)  
**Prior:** FASE-2.27-BROWSER-HOST-SDK-SPIKE  
**SDK:** `stellar-private-payments@0.2.1` (resolved en página)

**Alcance:** validación en runtime documental del spike 2.27. **Sin** Testnet, **sin** HAR exportado, **sin** cambios de producción / manifests / lockfiles / extensión. **Sin** staging ni commits.

**G8 = FAIL · G9 = FAIL** (justificación en §8).

---

## 1. Resumen ejecutivo

1. El spike RO-1 se ejecutó en un host documental Chromium (Cursor embedded browser, Chrome/148) contra `serve.mjs` en **`127.0.0.1:8765`**.  
2. Recorrido real observado: `Storage.open` → `Client.new` → `aspState` → `allContractsData` → deny mutators → `close`. `ok: true`.  
3. `/rpc-ro1` aceptó solo `getLedgerEntries` (fixture sintética); rechazó send/simulate/tip/events/health.  
4. Durante el recorrido, el `fetch` de página solo vio same-origin; **no** se observó intento externo del SDK. Workers/WASM internos: **NO DEMOSTRADO**.  
5. Tras `restore()` del guard, una URL externa **sí** es alcanzable desde la página — el spike no deja aislamiento permanente.  
6. **G8/G9 permanecen FAIL.** Esta sesión no cubre host de extensión ni todos los canales de red del runtime.

---

## 2. Preflight

| Ítem | Resultado |
|------|-----------|
| Raíz | `C:\Users\M\Downloads\Stellar privacy project` |
| HEAD | `d872ac4…` |
| Staging | vacío |
| Informe 2.27 | Leído |
| `ro1-host.html` / `ro1-host.mjs` / `serve.mjs` | Revisados |
| Bind servidor | `netstat`: `TCP 127.0.0.1:8765 LISTENING` (PID 15548) — **solo loopback** |
| `/rpc-ro1` allowlist | Solo `getLedgerEntries` (código + prueba negativa en vivo) |
| Backup / worktree / mcp.json / manifests / lockfiles | No modificados |
| Git destructivo / staging / commit | No ejecutados |
| Secretos en config del spike | Escaneo de `__SPP_RO1_RESULT__`: sin `secretKey` / mnemonic / seed / PRIVATE |

Corrección de bind: **no requerida** (ya limitado a `127.0.0.1`).

---

## 3. Entorno de ejecución

| Campo | Valor |
|-------|--------|
| Servidor | `node tests/stellar/spp/harness/browser/serve.mjs` |
| URL página | `http://127.0.0.1:8765/tests/stellar/spp/harness/browser/ro1-host.html` |
| Navegador | Cursor embedded Chromium · UA `Chrome/148.0.7778.280` · Electron/42.10.0 · Win32 |
| Nota de host | No es Chrome/Edge de escritorio instalado; es Chromium embebido del IDE. Evidencia válida para el spike documental; **no** sustituye validación en Chrome/Edge nativo ni en extensión MV3. |
| DevTools / CDP | Conservación de evidencia vía CDP `Runtime.evaluate` + snapshot de página (sin export HAR) |
| Red externa de validación | Prohibida para el recorrido RO-1; mock local únicamente |

---

## 4. Recorrido RO-1 — resultados observados

Fuente: `window.__SPP_RO1_RESULT__` tras auto-run (sin editar código desde DevTools).

| Etapa | Estado | Detalle depurado |
|-------|--------|------------------|
| `Storage.open` | **PASS** | `result: ok` · deps OPFS + storage-worker · `2026-10-26T00:29:03.382Z` |
| `Client.new` | **PASS** | `result: ok` · `rpcUrl=http://127.0.0.1:8765/rpc-ro1` · `backgroundSyncCalled: false` · prover-worker cargado para init, APIs prove **no** llamadas |
| `aspState` | **PASS** (OBSERVADO) | SDK real + fixture `/rpc-ro1` · summary `poolsLen: 0` · `hasAspMembership: true` |
| `allContractsData` | **PASS** (OBSERVADO) | SDK real + fixture · `poolCount: 1` |
| `sessionClose` | **PASS** | `closed: true` |
| Client crudo en `window` | **PASS** (no expuesto) | `__SPP_RO1_SESSION__` keys: `tryInvoke`, `listDenied`, `closed` únicamente |
| Status UI | — | `RO-1 spike OBSERVADO (SDK real + mock fixture). G8/G9 FAIL.` |
| Consola | — | Sin errores capturados en el buffer del spike (`consoleLog: []`); sin fallos visibles en snapshot |

`report.ok === true` · `finishedAt: 2026-10-26T00:29:03.479Z` · duración ~400 ms desde start.

---

## 5. Evidencia de red (depurada)

### 5.1 Solicitudes página (`fetch` instrumentado durante la sesión)

Same-origin permitidas (lista del reporte; sin cuerpos ni cookies):

| URL (path) | Rol |
|------------|-----|
| `/mock-rpc-log/clear` | clear log |
| `/node_modules/stellar-private-payments/dist/stellar_private_payments_web_bg.wasm` | WASM |
| `/node_modules/stellar-private-payments/package.json` | versión 0.2.1 |
| `/tests/stellar/spp/harness/browser/synthetic-contract-config.json` | config sintética |
| `/node_modules/stellar-private-payments/dist/circuits/circuits.json` | circuits lock |
| `/rpc-ro1` ×2 | `getLedgerEntries` |
| `/mock-rpc-log` | lectura del log |

`blocked: []` durante el auto-run · `externalBlockedCount: 0` · **ningún intento externo del SDK observado en el canal de página**.

### 5.2 Workers spawneados (constructor instrumentado)

| Script | Nota |
|--------|------|
| `…/dist/workers/storage-worker.js` | spawn observado |
| `…/dist/workers/prover-worker.js` | spawn observado (init; prove no invocado) |

Tráfico **dentro** de estos workers: **NO DEMOSTRADO** (realm separado).

### 5.3 Log servidor `/mock-rpc-log` (post-sesión + negativas)

| at (UTC) | method | outcome |
|----------|--------|---------|
| 00:29:03.464 | `getLedgerEntries` | `synthetic_getLedgerEntries_allContractsMinimal_ro1` |
| 00:29:03.474 | `getLedgerEntries` | idem |
| 00:30:05.321 | `sendTransaction` | `reject_ro1_not_allowlisted` |
| 00:30:05.325 | `simulateTransaction` | `reject_ro1_not_allowlisted` |
| 00:30:05.328 | `getLatestLedger` | `reject_ro1_not_allowlisted` |
| 00:30:05.331 | `getEvents` | `reject_ro1_not_allowlisted` |
| 00:30:05.334 | `getHealth` | `reject_ro1_not_allowlisted` |
| 00:30:05.338 | `getLedgerEntries` | synthetic OK (control positivo post-negativas) |

`rpcMethodsObserved` del spike: `["getLedgerEntries"]` · `rpcOnlyGetLedgerEntries: true`.

### 5.4 Canales no inspeccionables (declarados por el spike)

- fetch/XHR dentro de DedicatedWorker (storage/prover)
- HTTP interno WASM/reqwest si no pasa por `fetch` de página
- WebSocket/EventSource en workers
- Sockets nativos / de extensión (N/A en este host)

Una sesión **sin** requests externos observados **no** demuestra aislamiento total frente a esos canales.

---

## 6. Pruebas negativas

| Prueba | Resultado | Evidencia |
|--------|-----------|-----------|
| RPC no allowlisted → reject | **PASS** | JSON-RPC `-32601` “only getLedgerEntries permitted” para send/simulate/getLatestLedger/getEvents/getHealth |
| `getLedgerEntries` sigue OK tras rejects | **PASS** | HTTP 200 + `result` presente; **sin** fallback a otro método |
| Deny sync / backgroundSync / deposit / sign / send | **PASS** | `adversarial.deniedInvokes.*.ok === false` · reasons `RO-1 deny: …` |
| Invoke tras close | **PASS** | `reason: session closed` |
| Política externa (guard activo, mismo criterio same-origin que `ro1-host.mjs`) | **PASS** | Reinstalación breve del guard post-restore: `https://horizon-testnet.stellar.org/` → `blocked external fetch`; loopback `/rpc-ro1` OK |
| Aislamiento externo **tras** `network.restore()` | **FAIL / esperado** | Tras el spike, `fetch` a horizon-testnet **alcanzó** HTTP 200 — el guard de página es **efímero** a la sesión del spike |
| Sync / prove / sign / send / mutación invocados por el recorrido | **PASS** (no invocados) | Solo tryInvoke denegados; `backgroundSyncCalled: false` |
| Testnet / tx real | No ejecutado | Por diseño |

Interpretación: el rechazo de URL externa está **demostrado como mecanismo de página** mientras el guard vive; **no** como propiedad durable del documento ni del SDK.

---

## 7. Clasificación (PASS / FAIL / NO DEMOSTRADO)

| Afirmación | Veredicto |
|------------|-----------|
| RO-1 ejecuta en browser documental con SDK 0.2.1 + mock local | **PASS** |
| Solo `getLedgerEntries` llega al mock durante RO-1 | **PASS** |
| Mutators / sync / sign / send denegados por superficie RO-1 | **PASS** |
| Serve solo loopback | **PASS** |
| Client no expuesto en `window` | **PASS** |
| Página no intentó red externa durante el auto-run | **PASS** (observado) |
| Workers no hacen red externa | **NO DEMOSTRADO** |
| WASM no hace red fuera de page `fetch` | **NO DEMOSTRADO** |
| Aislamiento tras fin de sesión / sin guard | **FAIL** como aislamiento durable (restore permite externo) |
| Aislamiento en extensión instalada | **NO DEMOSTRADO** |
| Cobertura total de canales de red del runtime | **NO DEMOSTRADO** |

---

## 8. G8 / G9

| Gate | Estado | Justificación |
|------|--------|---------------|
| **G8** | **FAIL** | Hay dump real del spike documental, pero **no** hay integración en extensión ni prueba de que el host de producción (MV3 service worker / offscreen / iframe) aplique la misma superficie y política. Una página local ≠ wallet instalada. |
| **G9** | **FAIL** | El guard de página no instrumenta workers ni WASM-native; tras `restore()` la página puede salir a red. Sin evidencia de cobertura de esas rutas + política de host de extensión, G9 no puede aprobarse. |

**No se elevan** G8/G9 con esta fase.

---

## 9. Limitaciones y honestidad

1. Host = Chromium embebido Cursor, no Chrome/Edge desktop nativo.  
2. Evidencia de red = instrumentación de página + log mock + CDP; **sin** HAR (evitado a propósito).  
3. `aspState` / `allContractsData` reflejan fixture sintética (`poolsLen` / `poolCount`); demuestran el **camino SDK**, no datos de ledger real.  
4. Ausencia de requests externos ≠ prueba de que el runtime no pueda emitirlos por otros canales.  
5. Producción / adapter / StateCoordinator / manifests: **intactos**.

---

## 10. Archivos

| Archivo | Cambio |
|---------|--------|
| `…/docs/FASE-2.28-MANUAL-BROWSER-VALIDATION.md` | **Este informe** (único artefacto de la fase) |

Código del harness 2.27: no modificado en esta fase.

---

## 11. Git final

| Ítem | Valor |
|------|--------|
| HEAD | `d872ac4…` (sin cambio) |
| Staging | vacío |
| Diff de esta fase | solo el informe markdown nuevo bajo `tests/stellar/…/docs/` |
| Commits | ninguno |

---

## 12. Conclusión

El spike 2.27 **funciona** en un documento Chromium local: RO-1 completo, mock fail-closed, deny de mutators, bind loopback. Eso cierra el hueco “sin dump browser” de 2.27 para este entorno de agente.

**No** cierra aislamiento host/runtime ni gates G8/G9. Siguiente trabajo útil: Chrome/Edge nativo opcional + diseño de host extensión con instrumentación de workers — sin promover G8/G9 hasta evidencia de esas rutas.
