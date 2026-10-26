# Fase 2.35 — MV3 Read-Only Host Integration Spike

**Fecha:** 2026-10-26  
**HEAD (antes y después):** `d872ac455f47ab8822aace0ba2f62e1574d6cf27`  
**Rama:** `master`  
**Staging:** vacío (antes y después)  
**Priors:** FASE-2.29 · 2.30 · 2.31 · 2.32 · 2.33 · 2.34 (y contexto 2.14 / 2.26)  
**SDK:** `stellar-private-payments@0.2.1`  
**Procedencia:** `packages/wallet-core/node_modules/stellar-private-payments` (npm; repo NethermindEth `sdk/web`)

**Alcance:** diseño + spike **aislado** bajo `harness/mv3-spike` + twin HTTP `mv3-csp-ro1-host.*`.  
**No** depósitos / transferencias / retiros / firmas / ZK prove / sync / Testnet / envíos.  
**No** cambios a producción wallet, lockfiles, backup, worktree aislado ni `.vscode/mcp.json`.  
**Sin** `git add` / `commit` / `reset` / `clean` / `checkout` / `restore`.

**G8 = FAIL · G9 = FAIL.** Un spike exitoso **no** autoriza mutaciones ni pagos privados.

---

## 1. Resumen ejecutivo

1. **Arquitectura elegida:** página de extensión **dedicada** (`host/spp-ro1-host.html`) como único realm que carga WASM/OPFS/workers; service worker **solo** broker tipado RO-1 (sin SDK).  
2. **Offscreen:** no usado — la extensión de producción **no** declara permiso `offscreen`; no se añadió a producción.  
3. **Service worker como runtime SPP:** rechazado (efímero, OPFS/workers frágiles, sin documento adecuado para el SDK 0.2.1).  
4. Spike unpack listo en `harness/mv3-spike/` + `prepare-vendor.mjs` → `vendor/` (script-src `'self'`).  
5. Evidencia automatizada: twin HTTP con CSP alineada a MV3 propuesta — **RO-1 + contención PASS** en Cursor Chromium.  
6. **`chrome-extension://` unpack en Chrome desktop:** **NOT DEMONSTRATED** (no hay Chrome/Edge instalado en esta máquina; el browser embebido no carga extensiones unpacked).  
7. Egress CSP **dentro** de workers SDK_REAL: **NOT DEMONSTRATED** (igual que 2.33).  
8. “No hay actividad posterior al cierre”: **NOT DEMONSTRATED** (terminate observado ≠ ausencia demostrada de actividad).

---

## 2. Preflight

| Ítem | Resultado |
|------|-----------|
| Raíz | `C:\Users\M\Downloads\Stellar privacy project` |
| HEAD | `d872ac455f47ab8822aace0ba2f62e1574d6cf27` (coincide) |
| Staging | vacío |
| Informes 2.29–2.34 | Leídos |
| Manifest prod | MV3; SW `background.js`; CSP `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'`; **sin** `offscreen`; **sin** `host_permissions`; permisos alarms/storage/notifications |
| Offscreen en prod | Ausente |
| Backup / worktree / `.vscode/mcp.json` | No tocados |
| Git mutaciones | Ninguna |

Working tree preexistente (extension, stellar, harness) **preservado**.

---

## 3. Diseño — dónde alojar la sesión SDK

### Comparación (restricciones reales)

| Opción | Factible en prod actual | WASM / OPFS / Worker | Ciclo de vida | Separación vs SW | Veredicto 2.35 |
|--------|-------------------------|----------------------|---------------|------------------|----------------|
| **SW como runtime SDK** | Técnicamente “sí” cargar JS, **no** adecuado | Workers/OPFS frágiles en SW; SW se suspende | Efímero | Nula | **Rechazado** |
| **Offscreen document** | Requiere permiso `offscreen` **ausente** en prod | Documento + workers plausibles | Ligado a offscreen | Buena | **Candidato futuro**; no spike aquí sin tocar prod |
| **Página extensión dedicada** | Compatible hoy (extension page) | Pleno | Tab/ventana | Clara | **Elegida para spike** |

### Broker

```text
Popup (control) ──chrome.runtime.sendMessage──► SW (thin broker)
                                                    │ port spp-ro1-host
                                                    ▼
                                         Dedicated host page
                                         (SDK + containment + RO-1)
                                         ──http://127.0.0.1:8765/rpc-ro1──► mock
```

SW **nunca** importa `stellar-private-payments`. Host **nunca** recibe vault/seeds/claves.

### Artefactos reutilizados (sin mover experimental a producción)

| Artefacto | Uso |
|-----------|-----|
| `/rpc-ro1` + mock getLedgerEntries | RPC allowlist |
| `hostWorkerContainment` / emergencyClose | Registro + terminate |
| RO-1 session surface (aspState / allContractsData) | Protocolo |
| `synthetic-contract-config.json` | Fixture |
| serve.mjs loopback | Harness |

---

## 4. Spike aislado (`harness/mv3-spike`)

| Archivo | Rol |
|---------|-----|
| `manifest.json` | MV3 TEST; `host_permissions` solo `http://127.0.0.1:8765/*`; CSP con `connect-src 'self' http://127.0.0.1:8765` |
| `background.js` | RO1_OPEN_HOST / PING / STATUS / EMERGENCY_CLOSE |
| `popup.*` | Abre host / cierra SW |
| `host/spp-ro1-host.*` | Host documental RO-1 |
| `host/containment.mjs` | Contención (paths `vendor/`) |
| `prepare-vendor.mjs` | Copia SDK 0.2.1 → `vendor/` (**exit 0**) |
| `README.md` | Instrucciones unpack |

**No** cableado a `packages/extension`. **No** vault.

---

## 5. Twin HTTP (evidencia browser)

**URL:** `http://127.0.0.1:8765/tests/stellar/spp/harness/browser/mv3-csp-ro1-host.html`  
**UA:** Cursor Chromium (`Chrome/148` embebido)  
**Dump:** `window.__SPP_MV3_CSP_RO1__` · `ok: true`

### CSP efectiva (documento host)

Cabecera HTTP observada (`Invoke-WebRequest`):

```text
default-src 'none'; base-uri 'none'; script-src 'self' 'wasm-unsafe-eval';
style-src 'self'; connect-src 'self'; worker-src 'self' blob:; object-src 'self';
img-src 'none'; font-src 'none'; frame-src 'none'; form-action 'none'
```

(Alineada a propuesta MV3 + aislamiento harness; **no** es `chrome-extension://`.)

### CSP efectiva (scripts worker SDK_REAL — cabeceras de respuesta)

| Script | CSP |
|--------|-----|
| `storage-worker.js` | `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; worker-src 'self'; object-src 'none'` |
| `prover-worker.js` | idem |

### RPC

| Permitido | Bloqueado (mock `/rpc-ro1` + superficie RO-1) |
|-----------|-----------------------------------------------|
| `getLedgerEntries` (×2 observados en RO-1) | sync, ensure_synced, prove, simulateTransaction, send, mutators pool, métodos desconocidos |

`rpc.onlyGetLedgerEntries: true`.

### Documento — egress negativo `.invalid`

| Afirmación | Estado |
|------------|--------|
| `securitypolicyviolation` `connect-src` → `https://example.invalid/` | **PASS_CSP_CONFIRMED** |
| Egress CSP **dentro** worker SDK_REAL | **NOT DEMONSTRATED** |

### Workers

| Hecho | Evidencia |
|-------|-----------|
| Registrados SDK_REAL | `storage-worker.js`, `prover-worker.js` (2) |
| Tras `dispose()` siguen vivos | `stillLiveAfterDispose: 2` |
| `emergencyClose` → `terminate()` | `hostTerminatedNow: 2`, `allTerminated: true` |
| Close repetido | idempotente |
| Construct / dispatch tardíos | `HOST_CLOSED` / denied |
| Worker vía `OrigWorker` (fuera de registro) | host no lo ve (`registryCount: 0`) |
| Nested workers en otro DedicatedWorker | **NOT DEMONSTRATED** |

### Ciclo de vida (twin)

| Escenario | Veredicto |
|-----------|-----------|
| Close antes de init | **PASS** |
| Close después de RO-1 | **PASS** |
| Close con RO-1 pendiente (`Client.new`) | **PASS** |
| Close repetido + mensajes tardíos | **PASS** (en closeAfterRo1 + closeBeforeInit) |
| Fallo durante init + close | **PASS** |
| Worker no registrado | **PASS** (limitación documentada) |

Distinciones:

| Concepto | Estado |
|----------|--------|
| Broker cerrado | Observado (`HOST_CLOSED`) |
| Worker terminado por host | Observado (`terminateCalls ≥ 1`) |
| Worker terminado por SDK | **No** en dispose (2.33/2.35) |
| Ausencia de actividad posterior **observada** | terminate + deny constructs |
| Ausencia de actividad posterior **demostrada** | **NOT DEMONSTRATED** |

---

## 6. Host MV3 real (`chrome-extension://`)

| Chequeo | Resultado |
|---------|-----------|
| Chrome/Edge desktop en PATH / Program Files | **Ausente** |
| Load unpacked ejecutado | **No** |
| CSP efectiva extension_pages en unpack | **NOT DEMONSTRATED** |
| Port SW ↔ host en unpack | Código listo; runtime **NOT DEMONSTRATED** |

Manual (cuando haya Chrome): ver `mv3-spike/README.md`.

---

## 7. Limitaciones / falsos positivos

1. Twin HTTP ≠ unpack MV3 (origen, CSP extension, `chrome.*`, COOP/COEP vs extension pages).  
2. Cabecera CSP en worker ≠ prueba de violación **in-realm** (CDP Target denegado históricamente).  
3. `Failed to fetch` sin evento CSP **no** cuenta como bloqueo CSP; aquí sí hubo `securitypolicyviolation`.  
4. `terminate()` no prueba ausencia de sockets/tareas residuales en otros realms.  
5. Contención solo envuelve `window.Worker` de **este** realm.

---

## 8. Cambios de producción **propuestos** (NO realizados)

Separados del spike harness:

1. **Host documental dedicado** (o offscreen si producto lo exige) — único import del SDK.  
2. SW: broker tipado RO-1 únicamente.  
3. CSP `extension_pages`: mantener `script-src 'self' 'wasm-unsafe-eval'`; **añadir** `connect-src` pinneado (loopback mock → luego RPC allowlisted). Prod actual **omite** `connect-src` (menos restrictivo).  
4. **No** debilitar CSP para CDN; vendor/bundling local.  
5. `host_permissions` mínimos solo cuando exista destino RPC pinneado.  
6. Nunca pasar vault/seeds al host RO-1.

Ninguno de estos se aplicó a `packages/extension`.

---

## 9. Cambios realizados (harness only)

| Path | Cambio |
|------|--------|
| `harness/mv3-spike/**` | Spike unpack (manifest, SW, popup, host, prepare-vendor, README) |
| `harness/mv3-spike/vendor/**` | Copia local SDK (prepare; untracked) |
| `browser/mv3-csp-ro1-host.html/.mjs` | Twin CSP MV3 + RO-1 + lifecycle |
| `browser/serve.mjs` | CSP + log URL para twin 2.35 |
| `docs/FASE-2.35-…` | Este informe |

---

## 10. Comandos y códigos de salida

```text
git rev-parse HEAD
→ d872ac455f47ab8822aace0ba2f62e1574d6cf27  (exit 0)

node prepare-vendor.mjs
→ version 0.2.1, dist+js copied  (exit 0)

# kill listener :8765 si existía; luego:
node tests/stellar/spp/harness/browser/serve.mjs
→ listening 127.0.0.1:8765  (proceso en background)

Invoke-WebRequest mv3-csp-ro1-host.html
→ STATUS=200 + CSP header MV3-like  (exit 0)

Browser: open mv3-csp-ro1-host.html
→ __SPP_MV3_CSP_RO1__.ok === true

git diff --cached
→ vacío (staging count 0)
```

Sin contacto a Horizon/Testnet/públicos. Solo loopback + `.invalid`.

---

## 11. Estado final de Git

| Ítem | Valor |
|------|-------|
| HEAD | `d872ac455f47ab8822aace0ba2f62e1574d6cf27` |
| Staging | vacío |
| Commits nuevos | ninguno |
| Working tree | cambios preexistentes + untracked harness 2.35 |

---

## 12. Tabla final obligatoria

| Afirmación | Estado |
|---|---|
| Host MV3 real ejecutado | **NOT DEMONSTRATED** |
| Sesión RO-1 aislada del service worker | **PASS** |
| RPC limitado a la allowlist | **PASS** |
| Workers reales registrados y terminables | **PASS** |
| Egress externo bloqueado por CSP en workers reales | **NOT DEMONSTRATED** |
| No hay actividad posterior al cierre | **NOT DEMONSTRATED** |
| No hay acceso a claves o firma | **PASS** |

**G8 = FAIL · G9 = FAIL.**
