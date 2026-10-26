# Fase 2.34 — Host-Owned Worker Containment Spike

**Fecha:** 2026-10-26  
**HEAD:** `d872ac455f47ab8822aace0ba2f62e1574d6cf27`  
**Staging:** vacío  
**Priors:** FASE-2.31 · 2.32 · 2.33  
**SDK:** `stellar-private-payments@0.2.1` (`node_modules`; NethermindEth `sdk/web`)

**Alcance:** harness only. Sin producción, manifests, lockfiles, Testnet, firma ni mutaciones.

**G8 = FAIL · G9 = FAIL.**

---

## 1. Resumen ejecutivo

1. Capa **host** `createHostContainment()` envuelve `window.Worker` **antes** del SDK y registra workers con clase `SDK_REAL` / etc.  
2. `emergencyClose()` cierra broker/sesión, deniega constructs posteriores, llama **`terminate()`** a workers poseídos — **sin** confiar en `dispose()` (2.33: workers siguen vivos tras dispose).  
3. Evidencia browser: storage + prover **SDK_REAL** con `terminateCalls: 1` tras cierre de emergencia.  
4. Cobertura de realm: **solo** el realm de la página; workers anidados dentro de otro DedicatedWorker = **fuera de alcance**.  
5. Contención de ciclo de vida **≠** bloqueo CSP de egress (`NOT DEMONSTRATED`).  
6. No es prueba MV3.

---

## 2. Preflight

| Ítem | Resultado |
|------|-----------|
| Raíz | `C:\Users\M\Downloads\Stellar privacy project` |
| Rama | `master` |
| HEAD | `d872ac4…` |
| Staging | vacío |
| Informes 2.31–2.33 | Leídos |

---

## 3. Mecanismo de registro

| Pieza | Rol |
|-------|-----|
| `hostWorkerContainment.mjs` | `createHostContainment`, `classifyWorkerScript`, `emergencyClose` |
| Momento | Instalar **antes** de `Storage.open` / `Client.new` |
| Captura | `Worker` classic/module, URL HTTP y `blob:` (clasificación) |
| SharedWorker | Envuelto; si aparece → fail-closed (SPP 0.2.1 no lo usa) |
| No captura | `new Worker` **dentro** de otro worker |

Clases: `SDK_REAL` (storage/prover paths), `DEPENDENCY_REAL`, `HARNESS_CONTROL`, `NOT_IDENTIFIED`, `UNTRACKED` (no usado si construct denegado tras close).

---

## 4. Workers capturados / no capturados

| Worker | Clase | Capturado en página |
|--------|-------|---------------------|
| `storage-worker.js` | SDK_REAL | **Sí** (2 observados en closeAfterInit) |
| `prover-worker.js` | SDK_REAL | **Sí** |
| Nested inside modules | — | **NOT DEMONSTRATED** / fuera de cobertura |
| Harness probes | HARNESS_CONTROL | N/A en escenarios SDK |

Evidencia `terminate()` (closeAfterInit, tras dispose que dejó vivos):

```text
storage-worker.js  class=SDK_REAL  terminated=true  terminateCalls=1
prover-worker.js   class=SDK_REAL  terminated=true  terminateCalls=1
```

---

## 5. Cobertura por realm

```text
wrapsWindowWorker: true
wrapsSharedWorker: true
nestedWorkersInsideDedicatedWorker: false
```

Un wrapper de `window.Worker` **no** captura constructores en otro DedicatedWorker.

---

## 6. Pruebas de cierre (browser + offline)

### Offline (`hostWorkerContainment.classify.test.ts`)

```text
pnpm exec vitest run tests/stellar/spp/harness/browser/hostWorkerContainment.classify.test.ts
→ exit 0 (junto availability: 8 passed)
```

Fake Worker: register → emergencyClose → terminate; dispatch `HOST_CLOSED`; construct denegado; close temprano idempotente.

### Browser (`host-worker-containment.html`)

UA: Cursor Chromium Chrome/148. Dump: `__SPP_HOST_CONTAINMENT__` · `ok: true`.

| Escenario | Resultado |
|-----------|-----------|
| Close antes de workers | **PASS** (construct denied + HOST_CLOSED) |
| Close tras init + dispose | **PASS** (dispose deja vivos; host terminate SDK_REAL) |
| Close durante `Client.new` | **PASS** (workers terminados; client err timeout esperado) |
| Late dispatch + repeat close | **PASS** (idempotent + HOST_CLOSED×2) |
| Worker no registrable / nested | **NOT DEMONSTRATED** |

Broker/host: mensajes tardíos → `HOST_CLOSED`. No se aceptan ops tras cierre (en esta capa).

---

## 7. CSP / egress

**Separado.** Estado: **NOT DEMONSTRATED** (sin inject in-worker atribuible a CSP; sin red pública).

---

## 8. Limitaciones / falsos positivos

- `terminateCalls≥1` prueba invocación de `terminate()` en el wrapper, no ausencia total de actividad asíncrona previa al kill.  
- “No actividad posterior” requiere canales egress observados → **NOT DEMONSTRATED**.  
- Nested workers no cubiertos → no afirmar “todos los workers del universo SDK”.  
- Harness ≠ MV3.

---

## 9. Tabla final obligatoria

| Afirmación | Estado |
|---|---|
| Se registran todos los workers relevantes del SDK | **PASS** (storage+prover en realm de página; nested NOT DEMONSTRATED) |
| El host termina workers reales que posee | **PASS** |
| No se aceptan operaciones tras el cierre | **PASS** |
| No hay actividad posterior al cierre | **NOT DEMONSTRATED** |
| CSP bloquea egress en workers reales | **NOT DEMONSTRATED** |
| Host MV3 aislado y demostrado | **NOT TESTED** |

**G8 = FAIL · G9 = FAIL.**

---

## 10. Archivos

| Ruta | Rol |
|------|-----|
| `hostWorkerContainment.mjs` | Registro + emergencyClose |
| `host-worker-containment.html/.mjs` | Escenarios SDK real |
| `hostWorkerContainment.classify.test.ts` | Offline |
| `serve.mjs` | Ruta/CSP página |
| `docs/FASE-2.34-HOST-WORKER-CONTAINMENT.md` | Informe |

---

## 11. Git

| Ítem | Valor |
|------|--------|
| HEAD | `d872ac4…` |
| Staging | vacío |
| Commits | ninguno |

---

## 12. Recomendación 2.35

Integrar `emergencyClose` en el diseño del host de extensión (offscreen) como camino de cierre obligatorio; añadir observación de egress post-terminate si hay CDP/worker tooling; no aprobar G8/G9.
