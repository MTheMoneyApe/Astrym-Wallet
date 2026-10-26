# Fase 2.30 — Typed Broker, Worker Network Probe & CSP Draft

**Fecha:** 2026-10-26  
**HEAD:** `d872ac455f47ab8822aace0ba2f62e1574d6cf27`  
**Staging:** vacío (antes y después)  
**Prior:** FASE-2.29-CAPABILITY-ISOLATION-DESIGN · 2.27 · 2.28  
**SDK:** `stellar-private-payments@0.2.1` (real path = 2.28; esta fase no re-ejecuta SDK en el host del broker)

**Alcance:** solo `packages/wallet-core/tests/stellar/spp/harness/`. **Sin** producción, manifests, lockfiles, Testnet, firma ni envío.

**G8 = FAIL · G9 = FAIL.**

---

## 1. Resumen ejecutivo

1. Broker tipado RO-1 implementado (`ro1Broker/`) con validación estricta de envelopes, sesión, `requestId`, deny-by-default y backend vía `ReadOnlySession` (fakes). **14** pruebas adversariales offline **PASS**.  
2. Host browser del broker usa backend **fake** (resultados separados del SDK real 2.28).  
3. Worker probe: `fetch`/`XHR` **disponibles** en DedicatedWorker; intentos **locales** observados; bloqueo externo verificado = **NO DEMOSTRADO** (sin probes a dominios públicos).  
4. CSP draft en documentos 2.30: `script-src/style-src/connect-src/worker-src 'self'` sin `unsafe-eval`/`unsafe-inline` de script; worker create + local connect **PASS** bajo esa CSP.  
5. El broker **no** es frontera de seguridad del navegador por sí solo. G8/G9 no se elevan.

---

## 2. Preflight

| Ítem | Resultado |
|------|-----------|
| Raíz | `C:\Users\M\Downloads\Stellar privacy project` |
| HEAD | `d872ac4…` (coincide) |
| Staging | vacío |
| Informe 2.29 + artefactos 2.27–2.28 | Leídos |
| Backup / mcp / manifests / lockfiles / prod | No tocados |
| Git mutaciones | Ninguna |

---

## 3. Arquitectura

```text
[ Vitest / browser UI ]
        │ Ro1RequestMessage (v=1, kind=req, sessionId, requestId, method, args)
        ▼
┌─ Ro1Broker ─────────────────────────────────────────┐
│  parseRo1Request (exact keys, JSON-safe, no fns)     │
│  session open|closed + pending/completed requestIds  │
│  deny unknown / extra / replay / late inject         │
│  NO Client on wire; sanitize JSON results            │
└──────────────────────┬──────────────────────────────┘
                       │ Ro1BrokerBackend.execute
                       ▼
┌─ createSessionBrokerBackend → ReadOnlySession ──────┐
│  Storage.open / createClient / aspState / all…       │
│  Fake handlers (tests) or future real adapter        │
└──────────────────────────────────────────────────────┘

Browser pages (serve.mjs @ 127.0.0.1):
  ro1-broker-host.html     → standalone broker + fake
  worker-network-probe.html → CSP draft + worker local fetch/XHR
  ro1-host.html (2.27)     → real SDK (unchanged; evidence 2.28)
```

**Aviso:** abstracción experimental ≠ sandbox.

---

## 4. Esquemas de mensaje

### Request (exact keys)

| Campo | Tipo | Notas |
|-------|------|--------|
| `v` | `1` | versión |
| `kind` | `'req'` | |
| `sessionId` | string | sesión broker abierta |
| `requestId` | string | único; replay → `DUPLICATE_REQUEST` |
| `method` | allowlist RO-1 | otros → `UNKNOWN_METHOD` |
| `args` | JSON plain object | sin funciones/accessors; `Client.new` sin `storage`/`prover`/`bootnodeUrl` |

### Response

| `ok: true` | `result` JSON-safe |
| `ok: false` | `error: { code, message }` |

Códigos: `MALFORMED`, `UNKNOWN_METHOD`, `EXTRA_FIELD`, `INVALID_ARGS`, `SESSION_CLOSED`, `SESSION_UNKNOWN`, `DUPLICATE_REQUEST`, `LATE_OR_UNKNOWN_RESPONSE`, `HANDLER_ERROR`, `TRANSPORT`, `FORBIDDEN_VALUE`.

Operaciones: solo `Storage.open` · `Client.new` · `Client.aspState` · `Client.allContractsData`. Sin sign/prove/sync/send/mutación.

---

## 5. Pruebas adversariales (offline)

```text
cd packages/wallet-core
pnpm exec vitest run tests/stellar/spp/harness/ro1Broker/ \
  tests/stellar/spp/harness/browser/browserHarness.availability.test.ts \
  tests/stellar/spp/harness/browser/ro1Host.spike.test.ts
→ Test Files  3 passed · Tests  23 passed
```

| Caso | Resultado |
|------|-----------|
| Happy path 4 ops + gates FAIL | **PASS** |
| Unknown method (`Client.sync` / `sendTransaction`) | **PASS** deny |
| Extra field en envelope | **PASS** deny |
| Function en args | **PASS** deny |
| Malformed / bad `v` | **PASS** deny |
| Opaque `storage` / `bootnodeUrl` en wire | **PASS** deny |
| Non-loopback rpcUrl | **PASS** deny |
| Replay `requestId` | **PASS** deny |
| After `closeSession` | **PASS** deny |
| Injected / late external response | **PASS** deny |
| Handler error → session closed, no fallback | **PASS** |
| Concurrent distinct requestIds | **PASS** |
| Unknown sessionId | **PASS** deny |
| Client no expuesto | **PASS** |

---

## 6. Integración experimental

| Superficie | Backend | SDK real |
|------------|---------|----------|
| `createSessionBrokerBackend` + `Ro1Broker` (Node) | `ReadOnlySession` + fakes | No en esta corrida |
| `ro1-broker-host.html` (browser) | `createFakeRo1Backend` | **No** — separado explícitamente |
| `ro1-host.html` | SDK 0.2.1 | **Sí** — evidencia FASE-2.28 |

Browser broker dump (`__SPP_BROKER_HOST__`): `ok: true`; adversarial unknown/extra/replay/close denegados; `clientExposedOnWindow: false`.  
Navegador: Cursor Chromium `Chrome/148` (mismo caveat que 2.28: no Chrome/Edge desktop nativo).

---

## 7. Worker network probe — resultados

URL: `http://127.0.0.1:8765/.../worker-network-probe.html`  
Dump: `window.__SPP_WORKER_PROBE__` · `ok: true`

| Ítem | Clasificación |
|------|----------------|
| `fetch` en worker | **mecanismo available** |
| `XMLHttpRequest` en worker | **mecanismo available** |
| Intento local `/mock-rpc-log` + CSS | **observed_local** (HTTP 200 fetch+XHR) |
| Create + terminate worker | **PASS** |
| Page↔worker `postMessage` | **PASS** |
| Guard de página aplica al worker | **false** (documentado) |
| Externo bloqueado por política verificada | **NO DEMOSTRADO** (sin intento público; CSP `connect-src 'self'` presente pero no evidenciado con deny observado) |
| Canales WASM | **NO DEMOSTRADO** |

---

## 8. CSP draft

### Política aplicada (meta, harness)

```text
default-src 'none'; base-uri 'none';
script-src 'self'; style-src 'self';
connect-src 'self'; worker-src 'self';
img-src 'none'; font-src 'none'; object-src 'none';
frame-src 'none'; form-action 'none'
```

- Sin `unsafe-eval` / `unsafe-inline` en scripts.  
- Estilos en `fase-2.30-probe.css` (evita inline).  
- **Efecto observado:** scripts módulo + worker same-origin + `connect-src 'self'` permiten el probe local → **PASS** para ese documento.  
- **SDK real + WASM:** probablemente requiera `'wasm-unsafe-eval'` en hosts que carguen SPP; **no** relajado aquí — documentado como limitación si se unifica CSP con `ro1-host`.  
- **CSP ≠ bloqueo de todos los canales WASM/deps.**

### Página local vs extensión MV3

| | Harness document | Extensión MV3 |
|--|------------------|---------------|
| CSP | meta / headers de `serve.mjs` | `manifest.json` `content_security_policy` |
| Origen | `http://127.0.0.1:8765` | `chrome-extension://…` |
| Red | `connect-src 'self'` | además `host_permissions` / optional_host |
| Workers | `worker-src 'self'` | similar, más offscreen/SW |
| Evidencia 2.30 | documento de prueba | **NO DEMOSTRADO** |

---

## 9. Matriz de cobertura (actualizada)

| Garantía | Estado 2.30 |
|----------|-------------|
| Broker tipado + deny/replay/close | **PASS** (harness) |
| Sin Client en superficie broker | **PASS** |
| Ejecución SDK real RO-1 | **PASS** (heredado 2.28; no re-run aquí) |
| RPC solo getLedgerEntries (mock) | **PASS** (heredado) |
| Red página local | **PASS** (probe + 2.28) |
| Red worker local observada | **PASS** |
| Red worker externa bloqueada | **NO DEMOSTRADO** |
| WASM transport | **NO DEMOSTRADO** |
| CSP draft efecto en doc probe | **PASS** (worker+self connect) |
| Host extensión / G8 | **FAIL** / **NO DEMOSTRADO** integración |
| Aislamiento runtime G9 | **FAIL** |

---

## 10. G8 / G9

| Gate | Estado | Motivo |
|------|--------|--------|
| **G8** | **FAIL** | Broker+fakes ≠ integración extensión con SDK en host real |
| **G9** | **FAIL** | Worker externo / WASM / MV3 CSP no demostrados; broker no es sandbox |

---

## 11. Archivos (harness only)

| Ruta | Rol |
|------|-----|
| `harness/ro1Broker/*` | Broker TS, schema, session backend, tests |
| `browser/ro1-broker.standalone.mjs` | Espejo browser |
| `browser/ro1-broker-host.html/.mjs` | Host fake+CSP |
| `browser/worker-network-probe.*` | Probe worker |
| `browser/fase-2.30-probe.css` | CSS sin inline |
| `browser/serve.mjs` | URLs 2.30 en log |
| `docs/FASE-2.30-TYPED-BROKER-WORKER-PROBE.md` | Este informe |

Producción: **intacta**.

---

## 12. Git final

| Ítem | Valor |
|------|--------|
| HEAD | `d872ac4…` |
| Staging | vacío |
| Commits | ninguno |

---

## 13. Separación final

### Demostrado (PASS)

- Broker tipado fail-closed + tests adversariales  
- Integración broker ↔ ReadOnlySession (fakes)  
- Browser broker host (fake) sin Client  
- Worker: fetch/XHR disponibles; locales observados; lifecycle OK  
- CSP draft permite ese documento under `'self'`  

### Fallido / no aislado

- G8 / G9 (permanecen FAIL)  
- Aislamiento externo del worker (no evidenciado)  

### NO DEMOSTRADO

- Bloqueo externo verificado (worker/CSP)  
- Red WASM  
- Extensión MV3  
- Broker + SDK real en la misma página browser (separado a propósito; SDK = 2.28)

### Siguiente paso mínimo sugerido

Unificar opcionalmente broker + `ro1-host` bajo CSP compatible con WASM **en harness**, o spike offscreen de extensión **sin** merge prod — sin aprobar G8/G9 hasta evidencia de host real + workers/WASM.
