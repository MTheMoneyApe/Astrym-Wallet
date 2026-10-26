# Fase 2.23 — Auditoría G1–G11 + camino SPP de solo lectura

**Fecha:** 2026-10-26  
**Repositorio:** `C:\Users\M\Downloads\Stellar privacy project`  
**HEAD (antes y después):** `d872ac455f47ab8822aace0ba2f62e1574d6cf27`  
**Staging:** vacío (antes y después)  
**SDK:** `stellar-private-payments@0.2.1` · commit documentado `b79107cd24327198f8eb2dbaf4bdc65a8a1e8cf1`  
**Snapshot 2.4:** presente en  
`C:\Users\M\AppData\Local\Temp\spp-fase24-rpc-source-20261025-233039\upstream-src-b79107cd24327198f8eb2dbaf4bdc65a8a1e8cf1`  
**Priors:** FASE-2.13 … FASE-2.22 (énfasis 2.13, 2.14, 2.22; evidencia de lectura 2.7–2.12)

**Alcance:** auditoría y diseño — **sin** código de producción, **sin** mutaciones, **sin** firmas, **sin** red externa, **sin** cambios de manifests/lockfiles.

**No se afirma** que SPP esté integrado ni que existan pagos privados funcionales.

---

## 1. Preflight

| Comprobación | Resultado |
|--------------|-----------|
| CWD | `C:\Users\M\Downloads\Stellar privacy project` |
| HEAD | `d872ac455f47ab8822aace0ba2f62e1574d6cf27` (**coincide** con esperado) |
| Staging | **Vacío** (`git diff --cached --name-only` sin salida) |
| Working tree | Cambios preexistentes preservados (extension, stellar, harness untracked, etc.) |
| Backup | Presente, **no tocado**: `…\Stellar privacy project BACKUP` |
| Worktree aislado | Presente, **no tocado**: `…\stellar-nym-cleanup-wt` |
| `.vscode/mcp.json` | No modificado |
| Git mutaciones | Ninguna |

Origen de G1–G11: **única definición original** en  
`FASE-2.22-ARCHITECTURE-DECISION.md` §7 (“Criterios objetivos para pasar a integración”).  
No aparecen como gates numerados en 2.13–2.21. No se inventó significado; la tabla §2 cita esa fuente literalmente.

---

## 2. Tabla completa G1–G11

**Leyenda de estado**

| Estado | Significado |
|--------|-------------|
| `PASS` | Cumplido con evidencia de producción/integración real |
| `PARTIAL` | Piezas existen (código local y/o harness) pero no el criterio completo |
| `FAIL` | Criterio no cumplido |
| `BLOCKED` | Impedido por dependencia externa o política |
| `NOT_ASSESSED` | Sin definición original / fuera de alcance de esta auditoría |

**Ámbito:** `RO` = previo para solo lectura · `MUT` = previo para mutaciones · `BOTH` = ambos.

Ningún gate se marca `PASS`: ninguno está demostrado en el **entorno real de extensión** como integración SPP. Resultados de harness **no** se convierten en garantías de producción.

| ID | Definición exacta (fuente FASE-2.22 §7) | Amenaza que controla | Evidencia disponible | Prueba existente | Estado | Evidencia faltante para aprobar | Ámbito |
|----|----------------------------------------|----------------------|----------------------|------------------|--------|----------------------------------|--------|
| **G1** | Contrato de resultados intacto — firma solo tras capa `SigningAuthorization` que **prohíbe** `verifiable_complete` / `acceptSurfaceVerification` como grant | Firmar por alias legacy o surface-accept | Harness 2.21: `acceptByLegacyStatusAlone` siempre fail; `acceptSurfaceVerification.authorizesSigning === false`. **No** existe `SigningAuthorization` de producción | `semanticValidator.contract.test.ts` (offline) | `FAIL` | Capa prod `SigningAuthorization` + wiring a adapter; tests de integración | **MUT** (no RO) |
| **G2** | Evidence auténtica post-simulate — `OperationEvidence` del XDR pasado a `WalletSigner` (no fixtures sintéticas en prod) | Validar XDR sintético y creer que es material SDK | Fixtures sintéticas 2.19–2.21; adapter existe pero **no** cableado a Pool | Solo harness sintético | `FAIL` | Path prod que capture XDR real del `WalletSigner` post-simulate | **MUT** |
| **G3** | Single-tx enforced — `PoolEstimate.txCount === 1` **y** validador `planTxCount === 1`; si no, abort | Aprobar una op multi-tx con un solo approve | Validador rechaza `planTxCount ≠ 1`; `PoolEstimate.txCount` tipado en npm; **sin** UI/host que lo aplique | Harness semanticValidator multi-tx reject | `PARTIAL` | Enforce en host + estimate antes de mutar | **MUT** |
| **G4** | Ops permitidas — allowlist solo `deposit` y/o `withdraw`+G…; transfer* ausente de UI | Exponer transfer no verificable | Política documentada 2.22; UI SPP **inexistente** | N/A UI | `PARTIAL` | UI allowlist real + tests E2E de rechazo | **MUT** (RO usa allowlist distinta §5) |
| **G5** | Re-validación en sign — live `validateSemanticConcordance` + classification surface + binding; mismatch → no sign | Firmar XDR divergente del intent | Validador + `acceptSurfaceVerification` con re-validación (2.21); **no** en adapter prod | Harness contract tests | `FAIL` | Hook en path de firma producción | **MUT** |
| **G6** | Gate digest + lifecycle — `ContextualSignatureGate` require-prior-approval **y** `StateCoordinator` lifecycle; ninguno solo | Creer que lifecycle = semántica (o al revés) | Ambos `[LOC]` (2.13/2.14); **no** compuestos en flujo SPP | Tests offline adapter/gate; extension lifecycle tests no-SPP | `PARTIAL` | Composición SPP host + deny bind-on-authorize en prod | **MUT** (RO no firma) |
| **G7** | Persistencia single-use — IntentStore durable cross-restart (o blocker residual aceptado) | Replay de approvals tras restart | IntentStore **in-process** 2.15–2.17; brecha documentada | Harness approvedIntent | `FAIL` | Store durable o aceptación explícita de riesgo producto | **MUT** |
| **G8** | Host no-SW — documento estable OPFS/workers (diseño 2.14) implementado al menos stub Testnet | Correr Client en SW efímero / sin OPFS | Diseño `[PROP]` 2.14; harness browser **sí** usa OPFS+workers en loopback (2.7–2.12); extensión: **cero** wiring SPP | Browser harness OBS; extension: ausencia | `FAIL` | Stub host (offscreen/ventana) en extensión + smoke RO | **BOTH** (RO en extensión lo requiere; harness browser ya lo simula) |
| **G9** | Config Testnet real — `ContractConfig` + RPC allowlist; sin claim Nym-SPP | Apuntar a RPC arbitrario / fingir privacidad de red | Config **sintético** harness; Nym≠SPP documentado 2.13 | Fixtures `synthetic-contract-config.json` | `FAIL` (prod) / `PARTIAL` (harness offline) | Deployment Testnet pinneado + allowlist RPC en host | **BOTH** para RO “real”; offline mock no exige Testnet |
| **G10** | Plan representation path — WalletSigner intercept documentado **o** preview upstream; transfer requiere B/A completo | Mutar sin plan verificable | Decisión 2.22; API preview **ausente** en `0.2.1`; intercept no implementado | Docs 2.18/2.22 | `FAIL` | Preview upstream o diseño+código intercept | **MUT** |
| **G11** | Divulgación UI — `unverifiedFields` + `not_full_protocol_safety` visibles; sin copy “fully verified” | UX que afirme seguridad completa | Contrato harness 2.21; **sin** UI SPP | Contract tests | `FAIL` | Pantallas SPP con copy obligatorio | **MUT** (RO: divulgación distinta — valores sintéticos / no pagos) |

### Notas de trazabilidad

- **Documentado** ≠ **probado offline** ≠ **demostrado en extensión**.  
- G1–G7, G10–G11 son gates de **mutación/firma** según su texto 2.22; no bloquean un MVP de **solo lectura** si la allowlist §5 se respeta.  
- FASE-2.22 §8 dijo explícitamente: *“Read-only Client en host experimental | Demostrable tras G8–G9”*. Esta fase confirma: **G8 y G9 no están aprobados** para extensión → RO en extensión sigue **bloqueado**; RO en harness browser loopback ya fue observado (2.9/2.12).

---

## 3. Rutas SPP 0.2.1 — solo lectura

### 3.1 Fuentes verificadas (locales)

| Artefacto | Ubicación |
|-----------|-----------|
| npm `0.2.1` | `node_modules/.pnpm/stellar-private-payments@0.2.1/...` |
| NOTICE commit | `dist/circuits/NOTICE.txt` → `b79107cd24327198f8eb2dbaf4bdc65a8a1e8cf1` |
| Snapshot fuente | Temp Fase 2.4 `upstream-src-b79107cd…` (parcial; incluye `client.rs`, `contract_state.rs`, `rpc.rs`, `sync.rs`, `web/src/client/mod.rs`) |
| Tipado JS | `js/types/api-types.d.ts`, `js/index.js` |

**No** se re-descargó upstream ni se asumió que `main` actual ≡ `0.2.1`.

### 3.2 Inicialización (`Client.new`)

```text
js/index.js Client.new(options)
  → Storage.open (OPFS + storage-worker)   [si no se pasa storage]
  → ProverBridge.spawn + configureCircuitsBase + ping   [salvo options.prover]
  → WasmClient.new(rpcUrl, storageHandle, proverHandle, contractConfig, bootnode?)
       → NativeClient::init(rpc, storage, prover, config, bootnode)
```

| Aspecto | Hecho |
|---------|-------|
| OPFS / storage worker | **Requerido** para `Client` browser |
| Prover / circuitos | **Cargados** en `Client.new` JS (ping); nativo tiene `init_readonly`+`NoopProver` pero **WASM JS no lo expone** |
| ¿Genera ZK al init? | **No demostrado** — configure/ping ≠ prove |
| ¿Inicia sync al init? | **No** — `background_sync_stop: None`; sync solo si se llama `sync`/`backgroundSync` |
| RPC al init | Depende de workers; harness apunta a loopback |

**Hipótesis residual:** el worker prover permanece vivo tras init; la política debe **prohibir** APIs que lo usen (`verifySelectiveDisclosure`, mutaciones), no afirmar “cero prover en proceso”.

### 3.3 Métodos candidatos — grafo y clasificación

#### A. `Client.aspState()` — **ALLOW (RO)**

```text
Client.aspState (web client/mod.rs ~196)
  → state_fetcher()
  → StateFetcher::asp_state (contract_state.rs ~254)
      → contracts_data([], asp_membership, asp_non_membership)
          → get_contract_data_bulk (enum Admin/NextIndex + Admin)
              → RpcClient::get_ledger_entries   // ÚNICO RPC
```

| Pregunta | Respuesta | Evidencia |
|----------|-----------|-----------|
| Sync / catch-up | **No** | Sin `ensure_synced` (2.8/2.11 SRC) |
| Prover / ZK gen | **No** en este path | Solo StateFetcher |
| Firma / send | **No** | — |
| RPC | Solo `getLedgerEntries` | 2.9 OBS |
| Bootnode / indexer | **No** | — |
| WASM aceptó respuesta | **Sí** (fixture aspMinimal) | FASE-2.9 |
| Demostrado vs hipótesis | Demostrado en browser harness; **no** en extensión MV3 | |

#### B. `Client.allContractsData()` — **ALLOW (RO)**

```text
Client.allContractsData
  → StateFetcher::all_contracts_data
      → contracts_data(enabled_pools, asp_mem, asp_non)
          → get_contract_data_bulk → get_ledger_entries
```

Misma matriz que A; pool keys `Admin`/`State` + instancia. WASM OK con fixture allContractsMinimal — **FASE-2.12**.

#### C. `Client.contractConfig()` — **ALLOW (RO local)**

Sin RPC; devuelve config parseada en memoria. Irrelevante para deser on-chain; útil para mostrar IDs allowlisted.

#### D. `deriveAspUserLeaf(notePk, blinding)` — **ALLOW (local puro)**

Sin RPC / storage / Client. Crypto local.

#### E. `Storage.open` / `Client.dispose` / `stopBackgroundSync` — **ALLOW (infra)**

Necesarios para ciclo de vida. `stopBackgroundSync` es no-op si no se arrancó sync.

#### F. `Client.sync` / `backgroundSync` — **DENY**

→ catch-up / Indexer → `getEvents` + `getLatestLedger` (2.10). Política 2.11/2.22: sin auditoría independiente de efectos → **BLOCKED**.

#### G. `operationalFeed` / `recipientLookup` — **DENY**

```text
→ ensure_synced() → catch_up  (client.rs ~117–131)
```

#### H. `bootnodeRequired` — **DENY** (para este hito)

Solo `getEvents` (2.8); sin fixture de éxito autorizado; no es path de entries.

#### I. `readTokenDecimals` — **DENY**

Solo `simulateTransaction` (2.7); success no autorizado; no es ledger-entries RO.

#### J. `verifySelectiveDisclosure` — **DENY**

Usa `StateFetcher` **+ prover** (web client/mod.rs ~217–237).

#### K. `Client.account` / `PrivatePool.*` / `deposit|transfer|withdraw|transact|estimate` — **DENY**

Mutación / `execute_plan` / sync vía notes. `estimate` no firma pero lee estado de spend y puede acoplar sync — **no** incluir sin auditoría dedicada → **DENY** en hito 1.

#### L. `sendTransaction` / cualquier `sign*` — **DENY** permanente en RO.

### 3.4 Resumen: ruta mínima sin sync, prover-gen ni escritura

```text
Storage.open (local worker)
  → Client.new(rpcUrl=loopback|allowlisted, storage, proverHandle para init, synthetic|pinned config)
      → contractConfig()          // opcional, local
      → aspState()                // getLedgerEntries
      → allContractsData()        // getLedgerEntries
  → dispose()
```

**No** llamar: sync, backgroundSync, operationalFeed, recipientLookup, account/pool mutators, verifySelectiveDisclosure, bootnodeRequired, readTokenDecimals, send/sign.

**Matices honestos**

1. Init **carga** prover/circuits (API JS); no hay `init_readonly` en superficie WASM publicada.  
2. Valores de fixtures = **sintéticos**, no Testnet.  
3. Extensión MV3: path **no** reproducible aún (G8/G9).

---

## 4. Política de solo lectura (allowlist propuesta)

### 4.1 Allowlist explícita (hito RO-1)

| Símbolo | Notas |
|---------|-------|
| `Storage.open` / `storage.fork` | OPFS local |
| `Client.new` | rpcUrl must be harness loopback **or** future allowlist; config pinned |
| `Client.contractConfig` | Local |
| `Client.aspState` | Único RPC: `getLedgerEntries` |
| `Client.allContractsData` | Único RPC: `getLedgerEntries` |
| `Client.dispose` | Cleanup |
| `Client.stopBackgroundSync` | Solo si se hubiera arrancado por error; no llamar `backgroundSync` |
| `deriveAspUserLeaf` | Local |
| Harness: mock RPC `getLedgerEntries` únicamente para estas llamadas | Fail-closed resto |

### 4.2 Denylist (no exhaustiva — **default deny**)

Todo lo no listado en §4.1, incluyendo:

- `sync`, `backgroundSync`
- `operationalFeed`, `recipientLookup`, `bootnodeRequired`
- `account`, `PrivatePool.*`, `deposit`, `transfer`, `transferToKeys`, `withdraw`, `transact`, `estimate`, `notes`, `balance`
- `verifySelectiveDisclosure`, `readTokenDecimals`
- `sendTransaction`, `signTransaction`, `signAuthEntry`, `signMessage` (en contexto SPP RO)
- Cualquier fallback que degrade a escritura o sync

### 4.3 Reglas de política

1. **Fail-closed:** método no allowlisted → rechazo + log harness (`blockedAttempt: { api, reason }`) **sin** secretos.  
2. **RPC allowlist:** solo `getLedgerEntries` durante RO-1; mock debe rechazar `sendTransaction` y desconocidos (ya 2.1/2.7).  
3. **Sin sync/ZK-gen/firma/envío** en este hito.  
4. **Sin eludir SDK** si una lectura interna exigiera sync — marcar `BLOCKED`, no forzar.  
5. **Sin cambio silencioso** RO→RW: flags de sesión `mode: 'read_only'` inmutables tras create.  
6. **Prover en init:** permitido cargar; **prohibido** invocar prove/verify disclosure.  
7. **Copy UX:** nunca “pagos privados listos”; si se muestran datos: “lectura de estado de contrato / sintético o Testnet según config”.

---

## 5. Diseño del harness (sin implementar en esta fase)

### 5.1 Base existente

| Pieza | Rol |
|-------|-----|
| `harness/browser/harness.mjs` + `index.html` + `serve.mjs` | Browser OPFS + Client + Stage E `allContractsData` / histórico `aspState` |
| `mock-rpc.mjs` | Loopback `127.0.0.1`; reject `sendTransaction`; fixtures entries |
| `installNetworkGuard` (harness) | `blockedExternal` / `externalSentCount` |
| Vitest | `mockRpc.security.test.ts`, `rpcFixtureSchema.test.ts`, `browserHarness.availability.test.ts` |

### 5.2 Pruebas de aceptación propuestas (RO policy harness — Fase 2.24+)

| # | Caso | Expectativa |
|---|------|-------------|
| 1 | Init con Storage+Client locales / mock RPC | OK; solo deps locales |
| 2 | `aspState` + fixture válido | Decode OK; RPC log ⊆ `{getLedgerEntries}` |
| 3 | `allContractsData` + fixture válido | Idem |
| 4 | `getLedgerEntries` malformado / keys missing | Error SDK; sin send/sync |
| 5 | RPC method no permitido (`sendTransaction`, `getEvents`, …) | Mock reject; policy fail si Client lo intentara |
| 6 | Invocar allowlist-deny (`sync`, `deposit`, …) vía wrapper de política | Rechazo + log `blockedAttempt` |
| 7 | Ausencia de firmas / `execute_plan` | No llamadas; recorder vacío |
| 8 | Fallos OPFS/worker | Error controlado; no fallback RW |
| 9 | Respuesta incompleta / contrato desconocido | Error decode; no mutación |
| 10 | Cero tráfico externo | Ver §5.3 |

### 5.3 Cómo verificar “cero tráfico externo” (sin mentir)

**No basta** “no vi una línea en el log”. Mecanismos ya usados / a exigir:

1. **Harness `installNetworkGuard`:** instrumenta `fetch`/XHR; cuenta `externalSent` y `blocked` (FASE-2.7/2.9 reportaron `externalSentCount: 0`).  
2. **Serve bind `127.0.0.1` + Host allowlist** (`serve.mjs`).  
3. **Mock RPC solo loopback**; Vitest que el server `address === 127.0.0.1`.  
4. **Assert post-run:** `externalSentCount === 0` ∧ `blockedExternal` vacío o solo intentos bloqueados documentados ∧ log RPC sin hosts no locales.  
5. **Opcional 2.24:** test que falle si `rpcUrl` no es origin loopback.

Afirmación permitida tras run instrumentado: “bajo guard+mock, `externalSentCount===0`”.  
Afirmación **prohibida** sin guard: “no hubo red porque no apareció en un log parcial”.

---

## 6. Decisiones de salida (respuestas explícitas)

### 1. ¿Qué gates G1–G11 están realmente aprobados?

**Ninguno en `PASS`.**  
Varios `PARTIAL` (G3, G4, G6) o evidencia harness sin integración. G8/G9 **FAIL** para extensión.

### 2. ¿Qué gates son obligatorios para el primer camino de solo lectura?

- **En extensión MV3:** **G8** (host OPFS) y **G9** (config/RPC allowlist) — tal como FASE-2.22.  
- **En harness browser offline:** G8/G9 “prod” no aplican; bastan mock+OPFS ya demostrados (2.7–2.12) + política §4.  
- **G1–G7, G10–G11:** **no** son prerequisitos de RO-1 (son de mutación/firma).

### 3. ¿Ruta mínima del SDK sin sync, prover-gen ni escritura?

`Storage.open` → `Client.new` → `aspState` y/o `allContractsData` (+ `contractConfig` / `deriveAspUserLeaf` / `dispose`). RPC: **solo** `getLedgerEntries`.

### 4. ¿Qué pruebas existentes demuestran esa ruta?

| Evidencia | Fase |
|-----------|------|
| WASM acepta `aspState` + aspMinimal | 2.9 |
| WASM acepta `allContractsData` + allContractsMinimal | 2.12 |
| Call graph sin ensure_synced | 2.8/2.11/2.12 + fuente `b79107cd` |
| Mock reject send / unknown; schema fixtures | Vitest mock/security (esta fase: **16 passed**) |
| Network guard 0 external (runs documentados 2.7/2.9/2.12) | Informes previos (no re-ejecutado browser E2E en 2.23) |

### 5. ¿Qué falta para reproducirlo en la extensión?

1. Host documento estable (G8) — offscreen/ventana; no SW.  
2. Empaquetado workers/WASM/circuits en extensión.  
3. Config + RPC allowlist (G9); o modo **solo mock** de desarrollo.  
4. Wrapper de política RO (§4) delante de cualquier IPC.  
5. UI/IPC de solo estado (sin CTAs de mutación).

### 6. ¿Qué impide pasar a implementación de producción ahora?

- G8/G9 no cumplidos en extensión.  
- Riesgo de cablear `Client` sin allowlist y exponer `sync`/pool por accidente.  
- `Client.new` arrastra prover — requiere disciplina de API.  
- Esta fase **prohíbe** implementar producción; el diseño debe aterrizar primero en harness.

### 7. ¿Incremento mínimo recomendado — Fase 2.24?

**Implementar en harness (no producción):**

1. Módulo `readOnlyPolicy` (allow/deny + logger `blockedAttempt`).  
2. Tests Vitest de denegación (sync/deposit/send) y allow (`aspState`/`allContractsData` vía mocks o re-uso de Stage E).  
3. Checklist de asserts de red (`externalSentCount`, RPC method set).  
4. Doc de aceptación RO-1; **sin** wiring extension/`StateCoordinator`/signer.

Si 2.24 pasa: **entonces** diseñar stub host extensión (aún sin mutaciones) como 2.25.

**Si no hay camino seguro demostrable en extensión hoy:** **mantener bloqueo de integración producción** — correct; el camino seguro **sí** existe en harness offline y debe codificarse ahí primero.

---

## 7. Riesgos y bloqueos

| Riesgo | Mitigación |
|--------|------------|
| Tratar harness OBS como prod PASS | Tabla G* sin `PASS`; copy explícito |
| `Client.new` carga prover → “ya hay ZK” | Política: load≠prove; deny verify/mutate |
| Llamar `operationalFeed` creyendo “read” | Denylist; SRC `ensure_synced` |
| Extensión SW + OPFS | G8 fail-closed hasta host |
| Fixtures ≠ cadena real | Etiquetar sintético; G9 para Testnet |
| Debilitar 2.21 al cablear RO | RO no usa semantic validator para autorizar firma |

---

## 8. Archivos modificados y comandos

| Acción | Ruta |
|--------|------|
| **Creado** | `…/docs/FASE-2.23-READ-ONLY-GATE-AUDIT.md` |
| Producción / manifests / lockfiles / harness código | **No modificados** |

**Comandos**

```text
git rev-parse HEAD
git status --short
git diff --cached --name-only
Test-Path backup / worktree
# lectura local npm + snapshot b79107cd (Select-String en .rs / js)
pnpm exec vitest run \
  tests/stellar/spp/harness/browser/mockRpc.security.test.ts \
  tests/stellar/spp/harness/browser/rpcFixtureSchema.test.ts \
  tests/stellar/spp/harness/browser/browserHarness.availability.test.ts
→ 3 files, 16 tests passed
```

**Post-cierre Git:** HEAD `d872ac4…`; staging vacío; solo untracked nuevo este `.md` (bajo `tests/stellar/…` ya untracked).  
**Tráfico externo esta fase:** ninguno (Vitest Node local; sin browser E2E re-run).  
**Firmas / simulate success / submit:** ninguno.

---

## 9. Criterio de cierre

| Requisito | Estado |
|-----------|--------|
| Definiciones trazables G1–G11 | **Sí** — origen FASE-2.22 §7 |
| Diseño RO con frontera explícita | **Sí** — allowlist §4 + grafo §3 |
| ¿Producción implementada / mutaciones? | **No** |
| ¿Gates “aprobados”? | **Ningún PASS**; RO extensión bloqueado por G8/G9; RO harness demostrado históricamente |
| Siguiente incremento | **2.24:** policy harness + tests deny/allow — sin producción |
