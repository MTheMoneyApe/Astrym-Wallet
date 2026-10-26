# Fase 2.14 — Diseño de integración SPP con la extensión MV3

**Fecha:** 2026-10-26  
**Repositorio:** `C:\Users\M\Downloads\Stellar privacy project`  
**HEAD (antes y después):** `d872ac455f47ab8822aace0ba2f62e1574d6cf27`  
**Staging:** vacío (antes y después)  
**Alcance:** diseño documental únicamente — **sin** implementación, sin ops privadas, sin firmas de red, sin cambios de producción  
**SDK:** `stellar-private-payments@0.2.1` · fuente de referencia `b79107cd24327198f8eb2dbaf4bdc65a8a1e8cf1`  
**Prior:** Fases 2.9–2.13

**Leyenda de afirmaciones**

| Marca | Significado |
|-------|-------------|
| `[SRC]` | Confirmado en fuente `b79107cd` / tipado npm `0.2.1` |
| `[LOC]` | Existe en código Solanym local |
| `[HAR]` | Demostrado en harness (fases 2.x) |
| `[PROP]` | Propuesta de diseño (no implementada) |

**No se declara** SPP ni Solanym listos para pagos privados reales.

---

## 1. Estado de Git

| Momento | HEAD | Staging | Notas |
|---------|------|---------|-------|
| Preflight | `d872ac4…` | vacío | Working tree con cambios preexistentes (extension, `src/stellar/spp`, harness untracked) |
| Cierre | `d872ac4…` | vacío | Solo este informe untracked |

Backup y worktree aislado: no tocados. Sin `git add`/`commit`/`reset`/`clean`/`checkout`/`restore`.

---

## 2. Archivos y símbolos verificados

### Existentes (`[LOC]` / `[SRC]` / `[HAR]`)

| Componente | Símbolos / rutas |
|------------|------------------|
| Adapter | `[LOC]` `SppWalletSignerAdapter`, `SppSignerError` — `packages/wallet-core/src/stellar/spp/SppWalletSignerAdapter.ts` |
| Gate | `[LOC]` `createContextualSignatureGate`, `SignatureAuthContext`, `approve`/`authorize`/`assertActive`/`end` — `signatureGate.ts` |
| SEP-53 | `[LOC]` `hashSep53Message` — `sep53.ts` |
| Export core | `[LOC]` `packages/wallet-core/src/index.ts` (“signature adapter only”) |
| Lifecycle extensión | `[LOC]` `StateCoordinator.authorizeSignature` / `endSignature` / `assertSignatureActive` — **sin** payload digest |
| MV3 | `[LOC]` `manifest.json`: SW `background.js`, CSP `wasm-unsafe-eval`; permisos: alarms/storage/notifications; **sin** `offscreen` |
| SPP Client API | `[SRC]` `Client.new`, `backgroundSync`/`sync`/`stopBackgroundSync`, `account`, `aspState`, `allContractsData`, `dispose` — `js/types/api-types.d.ts` |
| SPP Pool API | `[SRC]` `PrivatePool.deposit` / `transfer` / `transferToKeys` / `withdraw` / `transact` / `notes` / `balance` — web `pool.rs` |
| Execute loop | `[SRC]` `execute_plan`: prove → simulate → sign → submit → confirm — `sdk/web/src/client/execute/mod.rs` |
| Sync | `[SRC]` `ensure_synced` → catch-up / Indexer (`getEvents`, tip en fetch) — no eludir `[SRC]`/`[PROP]` |
| Lectura harness | `[HAR]` `aspState`, `allContractsData` → solo `getLedgerEntries` (2.9/2.12) |
| SDK auth check | `[SRC]` `check_transact_auth` en `prepare_pool_transact` — **no** sustituye UI wallet |

### No existentes (brechas)

- Wiring extensión → `Client` / `PrivatePool` / UI SPP — **ausente** `[LOC]`  
- Transporte RPC inyectable en SPP — **no demostrado** `[SRC]` (Fase 2.13)  
- TTL en `ContextualSignatureGate` — **ausente** `[LOC]`  
- Offscreen document / host SPP — **ausente** `[LOC]` / `[PROP]`

---

## 3. Diagrama de componentes (propuesto)

```text
┌───────────────────── Popup / Approve UI ─────────────────────┐
│  SppOperationPresenter  [PROP]                                │
│  - muestra ApprovedIntent (semántica + digest)                │
│  - llama Session.approveIntent → gate.approve(context)        │
└───────────────┬──────────────────────────────▲────────────────┘
                │ IPC (intents / status)       │ status / errors
┌───────────────▼──────────────────────────────┴────────────────┐
│  Background SW (efímero)                                       │
│  StateCoordinator [LOC]  — lifecycle lock only                 │
│  SppSessionBroker [PROP] — no WASM/OPFS; proxy a host           │
└───────────────┬───────────────────────────────────────────────┘
                │ message port / chrome.runtime
┌───────────────▼───────────────────────────────────────────────┐
│  SPP Host document [PROP]  (offscreen o ventana dedicada)      │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │ SppSessionManager [PROP]                                 │  │
│  │  Client + Storage(OPFS) + workers + PrivatePool          │  │
│  │  SyncPolicy [PROP]                                       │  │
│  │  OperationPlanner [PROP] → plan + digests esperados      │  │
│  └───────────────┬─────────────────────┬───────────────────┘  │
│                  │                     │                       │
│  ┌───────────────▼──────┐   ┌──────────▼──────────────────┐  │
│  │ SppWalletSignerAdapter│   │ ContextualSignatureGate     │  │
│  │ [LOC] ← Vault/HD      │   │ [LOC] require-prior-approval │  │
│  └───────────────────────┘   └─────────────────────────────┘  │
│                  │                                             │
│  ┌───────────────▼─────────────────────────────────────────┐  │
│  │ RpcEndpoint [PROP]  — URL fija / allowlist; sin Nym SPP │  │
│  └─────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────┘
```

**Secuencia de una mutación (propuesta, no ejecutada):**

```text
UI: user selects deposit/transfer/withdraw
 → Host: ensure session READY + sync per policy (ensure_synced path)
 → Host: prepare plan (SDK prepare_*)  [no sign yet]
 → Host: prove_next + simulate → unsigned XDR + auth preimages
 → Host: build ApprovedIntent + expected SignatureAuthContext[]
 → UI: semantic review; user confirms
 → Host: gate.approve(each context)  [PROP+LOC]
 → Host: SW authorizeSignature() lifecycle wrap [LOC]
 → Adapter signAuthEntry* + signTransaction [LOC/SRC]
 → Host: submit + confirm [SRC]
 → Host: update local notes via sync; emit terminal status
 → Host: clear approvals/leases; optional session keep-alive
```

`[PROP]` El host **no** vive en el service worker: OPFS + DedicatedWorkers + WASM requieren un documento estable; MV3 SW se suspende (`[LOC]` alarmas/docs UI ya asumen reinicios SW).

---

## 4. Tarea A — Contratos entre componentes

| Rol | Responsabilidad | Existente vs propuesto |
|-----|-----------------|------------------------|
| **UI SPP** | Presentar `ApprovedIntent`; nunca firmar; nunca construir XDR; enviar approve/cancel | `[PROP]` (popup pages nuevas). Send/Dashboard actuales = Stellar **público** `[LOC]` |
| **SppSessionBroker** | IPC tipado SW↔Host; cola de un intent; no guarda secretos | `[PROP]` |
| **SppSessionManager** | Ciclo de vida Client/Pool; orquesta prepare→prove→sim→sign→send | `[PROP]` usa `[SRC]` `Client`/`PrivatePool` |
| **Client / Pool / workers** | API npm; storage-worker + prover-worker URLs | `[SRC]` |
| **OPFS Storage** | Persistencia notes/index vía `Storage.open` | `[SRC]` / `[HAR]` |
| **SyncPolicy** | Cuándo llamar `Client.sync` / `backgroundSync` / dejar `ensure_synced` inline; **sin bypass** | `[PROP]` sobre `[SRC]` |
| **Adapter + Gate** | Firma digest-bound; `approve` antes de `authorize` | `[LOC]` |
| **StateCoordinator** | Bloqueo lifecycle (lock/reset); **no** semántica | `[LOC]` — se **compone** con gate, no se fusiona `[PROP]` |
| **RpcEndpoint** | `rpcUrl` en `Client.new`; allowlist Testnet; registrar metadatos de red | `[PROP]`; transporte custom SPP **no** disponible `[SRC]` |
| **ErrorRecovery** | Estados terminales: sync fail, prove fail, sim reject, sign deny, send fail, confirm timeout/ambiguous | `[PROP]` alineado a `[SRC]` `ExecuteOutcome` / confirm 30s |

**Interfaces SDK usadas (no inventadas):**  
`Client.new`, `Client.account(options, WalletSigner)`, `account.pool({ poolContract })`, `pool.deposit|transfer|transferToKeys|withdraw`, `Client.aspState|allContractsData|sync|backgroundSync|dispose`, `Storage.open`, `WalletSigner.{getPublicKey,signMessage,signTransaction,signAuthEntry}` `[SRC]`.

**Interfaces propuestas (Solanym):**  
`ApprovedIntent`, `SppSessionState`, `SppSessionManager`, `SyncPolicy`, `OperationPlanner`, `SppHost`, `SppSessionBroker` — **no** son exports del SDK.

---

## 5. Tarea B — Modelo de aprobación semántica

### 5.1 `ApprovedIntent` `[PROP]`

```ts
type SppOpKind = 'deposit' | 'private_transfer' | 'withdraw';

type ApprovedIntent = {
  intentId: string;                 // uuid; single-use
  sessionId: string;
  expiresAtMs: number;              // UI/session TTL (gate itself has no TTL [LOC])
  op: SppOpKind;
  networkPassphrase: string;
  account: string;                  // G… bound
  poolContractId: string;
  asset: { kind: 'native' | 'classic' | 'contract'; symbol?: string; contractId?: string };
  amountStroops: string;            // decimal string / bigint serializado
  destination?: {                   // transfer / withdraw
    mode: 'g_address' | 'privacy_keys' | 'self';
    gAddress?: string;
    notePublicKeyHex?: string;      // solo si mode=privacy_keys; UI puede mostrar truncado
  };
  fees: {
    networkFeeKnown: boolean;
    baseFeeHint?: string;           // si conocido post-sim
    note: string;                   // e.g. "SDK BASE_FEE; final fee from simulation"
  };
  publicEffects: string[];          // human bullets: sender visible, nullifiers/commitments on-chain, …
  privacyLimits: string[];          // "RPC/IP not private"; "Nym not wired to SPP"; …
  planFingerprint: string;          // hash of planner fields (op, amount, dest, pool, network, account)
  signingRequests: Array<{          // exactamente lo que el adapter firmará
    kind: 'auth_entry' | 'transaction';
    payloadDigestHex: string;       // 64 hex
    label: string;                  // "Soroban auth #0" | "Transaction envelope"
  }>;
  sdkCheckTransactAuth: 'expected' | 'observed_pass' | 'not_applicable';
};
```

### 5.2 Origen de campos

| Campo | Plan SDK / sesión | XDR / preimage | Concordancia `[PROP]` |
|-------|-------------------|----------------|------------------------|
| op, amount, dest, pool | Plan (`prepare_*` + intent UI) | Parcial: invoke `transact` args / ext_data / auth tree | Re-parse post-sim; mismatch → **reject** |
| account, network | Adapter binding + intent | tx.source; auth `networkId` | Debe coincidir byte-a-byte con adapter |
| digests | Calculados tras sim (auth preimages + tx.hash) | Derivados del XDR a firmar | `signingRequests[].payloadDigestHex` ≡ digest del payload pasado a `sign*` |
| fees | Sim / BASE_FEE `[SRC]` | Fee en envelope | Si fee envelope ≠ hint aprobado → reject o re-aprobar |
| publicEffects | Plantilla por `op` | Refuerzo con `check_transact_auth` resultado | UI debe listarlos **antes** de approve |

**Insuficiente:** mostrar solo hash / “Sign XDR” `[PROP]` (explícitamente prohibido por requisitos 2.14).

### 5.3 Rechazos obligatorios `[PROP]`

| Condición | Acción |
|-----------|--------|
| `op` desconocido / plan incompleto | Reject; no `gate.approve` |
| Importe o destino ambiguo / vacío cuando requerido | Reject |
| Red o cuenta ≠ binding adapter | Reject |
| `expiresAtMs` pasado | Reject; invalidar intentId |
| Reuso `intentId` o reuso digest approval | Reject (gate one-shot `[LOC]` + intent store) |
| Cambio plan/XDR entre approve y sign (digest drift) | `assertActive` / recompute fail → abort |
| `check_transact_auth` fallaría / sim error | No pedir firma |
| Más auth entries de las previstas / fee-bump | Reject (adapter ya rechaza fee-bump `[LOC]`) |

**Flujo approve → sign:**  
1) UI confirma `ApprovedIntent`  
2) Host llama `gate.approve` por cada `signingRequests[]` context  
3) Solo entonces SDK `sign` → adapter `authorize` consume approval  
4) `StateCoordinator.authorizeSignature` envuelve el tramo de firma (lifecycle) **además**, no en lugar del gate `[PROP]`

---

## 6. Tarea C — Modelo de sesión y workers

### 6.1 Estados `[PROP]`

```text
UNINITIALIZED → CREATING → INITIALIZING → STORAGE_READY → CONFIG_VERIFIED
  → SYNCING → READY → PREPARING → AWAITING_APPROVAL → PROVING → SIMULATING
  → SIGNING → SUBMITTING → CONFIRMING → SUCCEEDED | FAILED | AMBIGUOUS
  → CANCELLING → DESTROYED
```

Transiciones ilegales (p.ej. SIGNING sin AWAITING_APPROVAL consumida) → fail-closed.

### 6.2 Ciclo de vida vs fallos MV3

| Evento | Comportamiento propuesto `[PROP]` |
|--------|-----------------------------------|
| SW suspend / restart | Broker pierde solo proxy; Host debe sobrevivir en offscreen/ventana. Si Host muere → sesión `DESTROYED`; UI muestra “sesión caducada” |
| Popup cerrado en AWAITING_APPROVAL | Intent permanece hasta `expiresAtMs` o cancel explícito; **no** auto-firmar |
| Reinicio navegador | OPFS puede persistir notes `[SRC]`; sesión en memoria **no**. Requiere `CREATING` de nuevo; no reutilizar approvals |
| OPFS corrupto | `STORAGE_READY` fail; no mutar; opción wipe controlado (fuera de esta fase) |
| Timeout sync / prove | `FAILED`; no sign |
| Send OK, confirm timeout (30s `[SRC]`) | `AMBIGUOUS` — no re-firmar mismo intent; UI: “consultar hash / re-sync”; recovery = sync + notes, no re-submit ciego |
| Claves | Solo vault HD vía adapter; **nunca** persistir seed/secret en OPFS chrome.storage local sin vault `[LOC]`/`[PROP]` |

### 6.3 Workers `[SRC]` + host `[PROP]`

- `storageWorkerUrl`, `proverWorkerUrl`, `circuitsBaseUrl`, `circuitLock` en `Client.new` `[SRC]`  
- Host document carga WASM (`wasm-unsafe-eval` ya en CSP `[LOC]`)  
- Investigación pendiente: permiso `offscreen` + lifetime Chrome (ver §9)

---

## 7. Tarea D — Sincronización y privacidad (capas)

| # | Capa | Metadatos expuestos | A quién | Nym |
|---|------|---------------------|---------|-----|
| 1 | Ledger / events | Contratos, ledgers, topics/events, tip | RPC + quien observe chain | **No** oculta grafo público `[SRC]`/`[PROP]` |
| 2 | Estado local / notes | Commitments, amounts en OPFS local | Dispositivo usuario | N/A |
| 3 | Prover | CPU/memoria local; timing | Dispositivo; side-channels locales | **No** aplica red |
| 4 | Firma | Digests firmados; no seed | Adapter local | N/A |
| 5 | Envío tx | Hash, envelope, sender, timing | RPC / mempool / explorers | Sin transporte SPP inyectable `[SRC]` |
| 6 | Red | IP, SNI, patrones RPC | ISP / RPC operator | Solanym Nym UI ≠ SPP `[LOC]`; **no** asumir cobertura |

### Sync — precondiciones `[SRC]`

- `spendable_notes` / `notes` / `prove_next` / resolve recipient G… llaman `ensure_synced`.  
- Sin sync completa: no notes fiables → no transfer/withdraw seguros; deposit prove también sync.  
- **No bypass** `[PROP]`: si sync falla, sesión → `FAILED` / reintentar política; nunca “force prepare without sync”.

### Política de sync propuesta `[PROP]`

| Modo | Uso |
|------|-----|
| `inline-before-mutate` | Antes de PREPARING, `Client.sync()` una vez; mutaciones aún pueden `ensure_synced` |
| `background-while-ready` | `backgroundSync` solo en Host READY; stop al DESTROY / lock vault |
| `read-only-no-sync` | Solo `aspState`/`allContractsData` (ya seguros sin sync `[HAR]`) — **nunca** para deposit/transfer/withdraw |

---

## 8. Tarea E — Threat model

| Amenaza | Impacto | Mitigación propuesta | Evidencia pendiente |
|---------|---------|----------------------|---------------------|
| dApp/content malicioso | Pedir firmas / engañar UI | SPP solo UI extensión; no exponer Pool a page; gate + intent | Wiring IPC allowlist |
| Plan/XDR manipulado | Firmar op distinta | Concordancia plan↔XDR; digest bind; SDK `check_transact_auth` | Parser post-sim robusto |
| Confusión red/cuenta | Fondos red incorrecta | Adapter lock + intent fields | Tests multi-network |
| Reuso aprobación | Doble firma | Gate one-shot + intentId | TTL adicional en intent store |
| Cambio post-approve | TOCTOU | Digests fijos; drift → abort | Harness adversarial |
| SW suspend / sesión huérfana | Estado inconsistente | Host ≠ SW; expire intents | Offscreen lifetime |
| OPFS corrupto/obsoleto | Notes wrong → prove fail / loss UX | Fail sync; no blind submit | Recovery UX |
| RPC malicioso | Mentir sim/tip/events | Allowlist; pin config; desconfiar resultados | No transporte Nym SPP aún |
| Prover comprometido | Proof inválido/malicioso | Circuit lock `[SRC]`; sim on-chain reject | Supply-chain circuits |
| Send sin confirm | Doble spend attempt / UX | `AMBIGUOUS`; no auto-resubmit | Runbook hash |
| Metadatos deposit/withdraw | Correlación sender/amount/timing | UI privacyLimits; sync mínimo necesario | Análisis eventos on-chain |

---

## 9. Decisiones que requieren investigación adicional

1. **Host concreto:** Chrome `offscreen` vs ventana `chrome.windows` vs panel lateral — lifetime OPFS/workers bajo cada opción.  
2. **Permisos manifest:** `offscreen`, posiblemente host permissions RPC Testnet.  
3. **Extracción fiable amount/dest desde XDR Soroban** post-`simulate` (depende de encoding `ext_data` / auth) — prototipo offline.  
4. **TTL del intent store** (minutos) vs UX popup.  
5. **Multi-step plans** (`tx_count` > 1 `[SRC]`): una `ApprovedIntent` por paso vs intent compuesto.  
6. **ASP register / AspNotReady** path antes del primer depósito.  
7. **ContractConfig Testnet real** (no synthetic harness).  
8. Futuro transporte privado RPC — **fuera** hasta API inyectable o proxy externo documentado.

---

## 10. Tarea F — Plan incremental (sin implementar ahora)

| Inc | Contenido | Pruebas / aceptación | Firmas / ops privadas |
|-----|-----------|----------------------|------------------------|
| **2.14.1** (primero) | Tipos `ApprovedIntent` + pure functions: build intent from fixture plan, expire, reject drift; **no** Client | Vitest offline unit; fixtures JSON sintéticas | **No** |
| **2.14.2** | Document + stub `SppSessionState` machine (transiciones ilegales) | Unit state-machine tests | **No** |
| **2.14.3** | Host harness page (loopback) reusing 2.12 read paths: session INIT→READY read-only `allContractsData` | Browser harness OBS; mock RPC only | **No** sync mutate / **No** sign |
| **2.14.4** | UI mock Approve screen rendering `ApprovedIntent` (fixture digests) + `gate.approve` wiring unit | Adapter tests + UI snapshot | Sign only in unit w/ `bind-on-authorize` test mode; **no** red |
| **2.14.5** | Offscreen/host spike (research build, feature-flagged) | Manual + automated availability | **No** send |
| **2.14.6+** | Sync policy + simulate dry-run against mock (still fail-closed send) | Schema-backed simulate fixture **solo si** autorizado explícitamente | send sigue bloqueado hasta fase dedicada |

**Criterio del primer incremento:** testeable 100% offline; cero red; cero `deposit`/`transfer`/`withdraw`; cero firmas hacia RPC.

---

## 11. Interfaces existentes vs propuestas (resumen)

| Existente | Uso en diseño |
|-----------|---------------|
| `SppWalletSignerAdapter` + `ContextualSignatureGate` `[LOC]` | Único path de firma; `require-prior-approval` |
| `StateCoordinator.authorizeSignature` `[LOC]` | Lifecycle concurrente; **complementa** gate |
| `Client` / `PrivatePool` / `Storage` `[SRC]` | Solo dentro de Host `[PROP]` |
| `aspState` / `allContractsData` `[HAR]` | Incremento read-only / health |
| Harness mock RPC `[HAR]` | Validación offline continua |

| Propuesto `[PROP]` | No confundir con SDK |
|--------------------|----------------------|
| `ApprovedIntent`, `SppSessionManager`, `SyncPolicy`, `SppHost`, `SppSessionBroker`, `OperationPlanner` | Capas Solanym |

---

## 12. Primer incremento seguro recomendado

Implementar **solo** (en una fase futura de código):

1. Módulo de tipos + validadores `ApprovedIntent` / concordancia digest en `wallet-core` (tests Vitest).  
2. Máquina de estados de sesión **sin** I/O de red.  
3. Extender docs/harness con fixture de intent sintético alineado a digests de unit tests del adapter.

**No** en el primer incremento: `Client.new` en extensión, sync, prove, simulate success, send, UI producción, Nym, cambios al gate.

---

## 13. Cierre

| Entregable | Estado |
|------------|--------|
| Contratos componentes | §3–4 |
| Modelo aprobación semántica | §5 |
| Sesión / workers / MV3 | §6 |
| Sync / privacidad / Nym | §7 |
| Threat model | §8 |
| Plan incremental | §10 |
| Git staging vacío | Sí |

**Siguiente fase de código sugerida:** 2.14.1 tipos + tests offline de `ApprovedIntent` (según §10), sin ops privadas.
