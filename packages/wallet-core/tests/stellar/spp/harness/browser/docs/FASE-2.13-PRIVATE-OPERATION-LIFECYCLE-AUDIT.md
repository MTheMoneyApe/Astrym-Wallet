# Fase 2.13 — Auditoría del ciclo de vida de operaciones privadas SPP

**Fecha:** 2026-10-26  
**Repositorio:** `C:\Users\M\Downloads\Stellar privacy project`  
**HEAD (antes y después):** `d872ac455f47ab8822aace0ba2f62e1574d6cf27`  
**Staging:** vacío (antes y después; solo se añade este informe untracked)  
**Backup / worktree aislado:** no modificados  
**SDK:** `stellar-private-payments@0.2.1` (npm local)  
**Fuente versionada usada:** commit `b79107cd24327198f8eb2dbaf4bdc65a8a1e8cf1` en  
`C:\Users\M\AppData\Local\Temp\spp-fase24-rpc-source-20261025-233039\upstream-src-b79107cd24327198f8eb2dbaf4bdc65a8a1e8cf1`  
(recuperada en Fase 2.4 vía SLSA / circuits NOTICE; **no** se re-fetchó `main` de GitHub en esta fase)

**Clasificación de evidencia**

| Etiqueta | Significado |
|----------|-------------|
| `CONFIRMADO_EN_FUENTE` | Call graph / símbolo verificado en fuente `b79107cd` o d.ts/WASM tipado de `0.2.1` |
| `IMPLEMENTADO_LOCALMENTE` | Código Solanym presente (adapter/gate/read clients) |
| `VALIDADO_EN_HARNESS` | Observado en harness browser/tests offline (fases 2.x) |
| `NO_VALIDADO` | Existe en fuente o local, no ejercido de forma segura aquí |
| `BLOQUEADO` | Política / dependencias / falta de wiring impiden validación |
| `NO_APLICA` | Fuera de alcance del paso |

**Advertencia:** este informe **no** declara Solanym listo para pagos privados reales. Las fixtures 2.9–2.12 son sintéticas.

---

## 1. Estado de Git

| Momento | HEAD | Staging | Notas |
|---------|------|---------|-------|
| Preflight | `d872ac4…` | vacío | Working tree con cambios preexistentes (extension, stellar `src/`, harness untracked) |
| Cierre | `d872ac4…` | vacío | Solo nuevo: este `.md` (untracked bajo harness docs) |

Comandos: `git status --short`, `git rev-parse HEAD`, `git diff --cached --stat`, `git diff --stat`. Sin `add`/`commit`/`reset`/`clean`/`checkout`/`restore`.

---

## 2. Versión de fuente y verificación

| Hecho | Evidencia |
|-------|-----------|
| Dependencia | `packages/wallet-core/package.json` → `"stellar-private-payments": "0.2.1"` |
| Paquete instalado | `node_modules/stellar-private-payments/package.json` → `"version": "0.2.1"` |
| Commit de trabajo | `b79107cd…` (NOTICE circuitos / Fase 2.3–2.4); árbol temporal intacto |
| Incertidumbre residual | Fase 2.3: el commit del **binario WASM npm** no se demuestra byte-a-byte dentro del `.wasm`; se usa el pin documentado + árbol `b79107cd` ya auditado |

---

## 3. Call graphs (fuente `b79107cd`)

### 3.1 Depósito

```text
PrivatePool.deposit(amount)                         [sdk/web/src/client/pool.rs ~71]
  → prepare_deposit(amount)                         [native pool.rs ~328 → core]
  → execute_plan(plan, "deposit")                   [sdk/web/src/client/execute/mod.rs ~23]
       loop while !plan.is_complete():
         prove_next(plan)                           [native pool.rs ~357–447]
           → ensure_synced()                        [sync.rs ensure_synced → catch_up / Indexer]
           → fetch_transact_chain_context()         [contract_state::transact_chain_context]
                → getLedgerEntries (+ possibly simulate for ASP non-membership find_key)
           → storage.build_transact_params
           → prover.prove_transact                  [ZK]
         simulate(prepared)                         [pool.rs ~273 → prepare_pool_transact]
           → get_account (sequence)
           → simulateTransaction
           → check_transact_auth (SDK-side auth tree limit)
         sign(prepared)                             [WalletSigner: signAuthEntry* + signTransaction]
         submit(signed)                             [submit.rs → sendTransaction]
         confirm(hash)                              [sync.rs confirm_tx → getTransaction poll ≤30s]
```

**RPC típicos del camino de mutación:** `getLedgerEntries`, (condicional) `simulateTransaction` (non-membership), `getAccount`/`getLedgerEntries` para secuencia, `simulateTransaction` (tx), `sendTransaction`, `getTransaction`.  
**Sync path:** `ensure_synced` → `Indexer` → `getEvents` + en catch-up `getLatestLedger` (Fase 2.10).

### 3.2 Transferencia privada

```text
PrivatePool.transfer(recipientG, amount) | transferToKeys(notePk, encPk, amount)
  → spendable_notes()                     [ensure_synced + storage]
  → prepare_transfer(...)                 [resolve Address → registered_privacy_keys si G…]
  → execute_plan(..., "transfer")         [mismo prove→simulate→sign→submit→confirm]
```

Entrada pública on-chain (implementación): invocación `transact` con proof + `ext_data` + `sender` address; nullifiers/commitments/public_amount/ASP roots en el proof público; recipient G… o keys resueltas off-chain.  
Oculto (protocolo, según diseño SPP / no re-probado aquí): montos internos de notas, mapping note↔usuario salvo lo filtrado en `ext_data` / eventos.

### 3.3 Retirada

```text
PrivatePool.withdraw(amount, recipient?)
  → spendable_notes()                     [ensure_synced]
  → prepare_withdraw(wallet, amount, to)  [to default = user_address]
  → execute_plan(..., "withdraw")         [mismo loop]
```

Salida pública: dirección receptora y flujo de tokens fuera del pool vía `ext_amount` / transfer autorizado (ver `check_transact_auth` en `tx_prepare.rs` para depósitos; withdraw usa `ext_amount` negativo / recipient en ext_data — **CONFIRMADO_EN_FUENTE** a nivel de encode; semántica exacta de eventos **NO_VALIDADO** en harness).

---

## 4. Matriz de evidencia por paso (depósito como referencia)

| # | Paso | Símbolos / archivos | Clasificación |
|---|------|---------------------|---------------|
| 1 | Datos previos (cuenta, pool id, `ContractConfig`, privacy keys, OPFS notes) | `Client.new`, `Account`, `derivePrivacyKeys`, `Storage.open`; Solanym: vault HD + `SppWalletSignerAdapter` (sin wiring a `Client`) | CONFIRMADO_EN_FUENTE; IMPLEMENTADO_LOCALMENTE (signer only); **NO** wiring Client/Pool en extension |
| 2 | Lecturas de contratos | `StateFetcher::transact_chain_context` / `contracts_data_for_pool`; `allContractsData`/`aspState` | Lectura tip: VALIDADO_EN_HARNESS (2.9/2.12). Contexto transact: NO_VALIDADO |
| 3 | Construcción plan | `prepare_deposit` → `PreparedTransactionPlan` | CONFIRMADO_EN_FUENTE; NO_VALIDADO en runtime |
| 4 | Notas / commitments / nullifiers | `storage.build_transact_params`, prover outputs `output_commitments`, `input_nullifiers` | CONFIRMADO_EN_FUENTE; NO_VALIDADO |
| 5 | ZK / prover | `prover.prove_transact`; workers + `circuits/` en npm | CONFIRMADO_EN_FUENTE; BLOQUEADO en harness (no ops privadas) |
| 6 | Auth / firmas | `pool.sign` → auth preimages + envelope; Solanym `SppWalletSignerAdapter` | CONFIRMADO_EN_FUENTE; IMPLEMENTADO_LOCALMENTE + tests offline; **no** conectado a UI SPP |
| 7 | Simulate + send | `prepare_pool_transact` / `submit_tx` | Path simulate OBSERVADO solo vía `readTokenDecimals` error (2.7). Success + send: BLOQUEADO / NO_VALIDADO |
| 8 | Confirm + estado local | `confirm_tx` (30×1s `getTransaction`); indexer catch-up post-sync | CONFIRMADO_EN_FUENTE; NO_VALIDADO |
| 9 | Recuperación timeout/RPC fail | `ExecuteOutcome::plan(completed, error)`; confirm timeout 30s; sync retries | CONFIRMADO_EN_FUENTE; NO_VALIDADO |
| 10 | Privacidad / metadatos | Proof públicos + `sender` + RPC/IP + eventos indexer | CONFIRMADO_EN_FUENTE (campos públicos en `tx_prepare`); red: BLOQUEADO (Nym no inyectado en SPP) |

Transfer / withdraw: mismos pasos 5–10; paso 1–4 añaden `spendable_notes` + resolución de recipient (**CONFIRMADO_EN_FUENTE**; dependen de sync → **BLOQUEADO** bajo política 2.13 para ejecución).

---

## 5. Auditoría del adaptador y gate de firma

**Archivos:**  
`packages/wallet-core/src/stellar/spp/SppWalletSignerAdapter.ts`  
`packages/wallet-core/src/stellar/spp/signatureGate.ts`  
`packages/wallet-core/src/stellar/spp/sep53.ts`  
`packages/extension/src/background/StateCoordinator.ts` (`authorizeSignature`, ~173)

| Pregunta | Hallazgo | Clasificación |
|----------|----------|---------------|
| 1. Tipo / cuenta / red | Context `{kind, account, networkPassphrase, payloadDigestHex}`; adapter fija red + G… + `accountIndex` | IMPLEMENTADO_LOCALMENTE |
| 2. Digest exacto | Gate congela digest hex; `assertActive` exige igualdad | IMPLEMENTADO_LOCALMENTE; tests offline |
| 3. Un solo uso / expira | Lease one-shot (`end` en `finally`); **sin TTL temporal** | IMPLEMENTADO_LOCALMENTE (one-shot); TTL: **NO_APLICA / brecha** |
| 4. Cuenta / red incorrectas | Rechazo explícito address/network/source/preimage | IMPLEMENTADO_LOCALMENTE + tests |
| 5. XDR malformado / firmas previas / fee-bump | Errores dedicados; fee-bump no soportado; firmas preexistentes rechazadas | IMPLEMENTADO_LOCALMENTE + tests |
| 6. Límites auth Soroban | Allowlist `envelopeTypeSorobanAuthorization(|WithAddress)`; WithAddress debe ser G… bound; **no** inspecciona invocation tree | IMPLEMENTADO_LOCALMENTE (límite documentado en cabecera adapter) |
| 7. ¿Wallet revisa significado o solo hash? | **Solo digest / bindings estructurales**. Comentario L7–16 adapter | Brecha semántica |
| 8. Revisión semántica deposit/transfer/withdraw | **No existe** en Solanym. SDK sí hace `check_transact_auth` en simulate (`tx_prepare.rs`) **antes** de devolver XDR al signer — eso es del SDK, no UI Solanym | CONFIRMADO_EN_FUENTE (SDK); brecha Solanym |
| 9. Conexión UI extensión | `ContextualSignatureGate.approve` **no** cableado a popup. `StateCoordinator.authorizeSignature` es **lifecycle-only** (epoch/AbortController), **sin** payload digest | Brecha de integración |
| 10. ¿Se puede omitir el gate? | Constructor **exige** `authorizationGate`. Modo test `bind-on-authorize` autoriza al vuelo sin `approve` (documentado no-prod). `createRejectingSignatureGate` niega todo. No hay path adapter sin gate | IMPLEMENTADO_LOCALMENTE |
| 11. Repetición / error / cancel | Reuse lease falla; `end` en finally; prior-approval consume FIFO match | IMPLEMENTADO_LOCALMENTE + tests |

**Extension wiring SPP:** grep en `packages/extension/src` — **cero** referencias a `SppWalletSigner`, `PrivatePool`, `allContractsData`, `Client.new`. Export wallet-core: “signature adapter only (no deposit/transfer UI yet)” (`src/index.ts` ~37).

---

## 6. Requisitos y bloqueos de entorno

| Área | Estado |
|------|--------|
| WASM `0.2.1` | Empaquetado en npm `dist/`; harness 2.7–2.12 lo carga | VALIDADO_EN_HARNESS (init) |
| Workers (storage / prover) | URLs bajo `dist/workers/`; MV3 extension **no** validada con SPP Client | CONFIRMADO_EN_FUENTE; extension: NO_VALIDADO |
| OPFS | Requerido por `Storage.open` en browser | VALIDADO_EN_HARNESS (2.7+) |
| Prover + circuitos | `dist/circuits/` + lock; ops ZK no ejecutadas aquí | CONFIRMADO_EN_FUENTE; BLOQUEADO |
| ContractConfig / red | Synthetic harness OK; **deployment Testnet real** no configurado en Solanym | Harness: VALIDADO; prod config: BLOQUEADO |
| Indexer / sync | `ensure_synced` → eventos; tip acoplado (2.10) | CONFIRMADO_EN_FUENTE; BLOQUEADO por política |
| RPC | `reqwest` / fetch a `rpcUrl` — **sin** hook de transporte custom verificado en fuente auditada | CONFIRMADO_EN_FUENTE |
| Bootnode | Opcional en `SyncHandle`; `bootnodeRequired` = getEvents (2.8/2.10) | CONFIRMADO_EN_FUENTE |
| Extensión MV3 | Service worker ≠ página OPFS plena; integración SPP **ausente** | BLOQUEADO |
| Nym | UI `nym-status` en Dashboard es estado RPC genérico; **no** hay inyección Nym en `stellar-private-payments` ni wrapper SPP | Ver §6.1 |

### 6.1 Nym — capas separadas

| Capa | ¿Cubierta por Nym hoy? | Evidencia |
|------|------------------------|-----------|
| 1. HTTP/RPC SPP | **No** demostrado | SPP usa cliente HTTP propio (`reqwest`/fetch); sin API de transporte inyectable encontrada en el árbol auditado |
| 2. Sync / indexación | **No** | Misma RPC; catch-up/events en SDK |
| 3. Prover | **No aplica a red** | Local WASM/worker; Nym no sustituye circuitos |
| 4. Firma / secretos | **Local only** | Vault + adapter; Nym no debe ver seeds |

No asumir que Nym cubre automaticamente privacidad de red para SPP.

---

## 7. Separación hechos fuente / local / observado

| Hecho | Origen |
|-------|--------|
| `deposit`/`transfer`/`withdraw` → `execute_plan` → prove→simulate→sign→submit→confirm | Fuente `b79107cd` |
| Mutaciones llaman `ensure_synced` (directa o vía `spendable_notes`/`prove_next`) | Fuente |
| `allContractsData`/`aspState` solo `getLedgerEntries` | Fuente + VALIDADO_EN_HARNESS 2.9/2.12 |
| `SppWalletSignerAdapter` + gate contextual | IMPLEMENTADO_LOCALMENTE + 36 tests offline esta fase |
| Ningún flujo privado E2E / Testnet | Observación de proyecto + política |
| `check_transact_auth` limita auth tree en SDK | Fuente `tx_prepare.rs` |

---

## 8. Riesgos de seguridad y privacidad

1. **Brecha semántica Solanym:** firmar digest sin UI que muestre pool/`transact`/montos/recipient.  
2. **Dos gates incompatibles:** `StateCoordinator` (lifecycle) ≠ `ContextualSignatureGate` (payload); riesgo de cablear el primero y creer que basta.  
3. **Sync obligatorio** para notes/transfer: fuerza `getEvents`/`getLatestLedger` y metadatos de red.  
4. **Metadatos on-chain:** `sender`, nullifiers, commitments, `public_amount`/`ext_data`, timing RPC — privacidad criptográfica ≠ anonimato de red.  
5. **`bind-on-authorize`:** si se usa en producción, elimina la aprobación previa.  
6. **Confirmación 30s:** timeout deja estado ambiguo (parcial `ExecuteOutcome`).  
7. **Extension + OPFS/workers:** no demostrado; riesgo de asumir portabilidad MV3.

---

## 9. Requisitos priorizados para un primer flujo Testnet

1. **Deployment real** `ContractConfig` + RPC Testnet + pool/ASP/token/verifier conocidos.  
2. **Política de sync** explícita (inline vs background) y fixtures/ops permitidas para `getEvents`/`getLatestLedger`.  
3. **Wiring** `Client.new` + `Account` + `derivePrivacyKeys` + `PrivatePool` en contexto con OPFS (página extendida o offscreen document — **por diseñar**).  
4. **UI de aprobación** que calcule `SignatureAuthContext` (incl. digest) y llame `gate.approve` **antes** de `sign*`; mostrar semántica deposit/transfer/withdraw.  
5. **Conectar** `SppWalletSignerAdapter` (modo `require-prior-approval`) al `WalletSigner` de SPP.  
6. **Prover/circuits** cargados y verificados (lock).  
7. **Registro ASP / privacy keys** si el pool lo exige (`AspNotReady` path).  
8. **Plan de red:** RPC directo vs futuro transporte (Nym **no** listo para SPP).  
9. **Observabilidad** de fallos confirm/sync sin firmar de más.  
10. **Harness E2E offline** con mock de simulate/send **solo** tras schemas autorizados (hoy fail-closed).

---

## 10. Recomendación de siguiente fase (sin implementarla)

**Fase 2.14 (propuesta):** diseño de integración extensión — mapa MV3 (offscreen/OPFS), contrato UI↔`ContextualSignatureGate.approve`, y checklist de sync/RPC Testnet — **sin** enviar transacciones ni ampliar fixtures de escritura.

Alternativa: auditoría profunda de `check_transact_auth` + superficie de eventos on-chain (privacidad de metadatos) como documento de amenaza.

---

## 11. Respuestas al criterio de aceptación

| Pregunta | Respuesta breve con evidencia |
|----------|-------------------------------|
| ¿Qué pasos necesita un depósito real? | Config + keys + (sync) + prepare + prove ZK + simulate + sign auth/tx + send + confirm + index notes (§3.1, §4) |
| ¿Qué hay en SDK vs Solanym? | SDK: ciclo completo. Solanym: vault Stellar + read/send públicos + **adapter/gate** sin `PrivatePool`/UI |
| ¿Qué falta para transfer/withdraw? | Sync+notes, recipient resolution, mismo execute loop, UI semántica, Testnet config |
| ¿Revisión semántica antes de firmar? | **No** en wallet Solanym; parcial en SDK (`check_transact_auth`) post-simulate |
| ¿Qué bloquea el primer Testnet? | Wiring Client/Pool, sync policy, UI approve+semántica, deployment, workers/OPFS en extensión, send/simulate no validados |
| ¿Qué implementar primero? | Cableado UI→`approve(context)` + sesión SPP read-only real (config+sync policy) **antes** de deposit |

---

## 12. Pruebas ejecutadas (esta fase)

```text
cd packages/wallet-core
pnpm exec vitest run \
  tests/stellar/spp/SppWalletSignerAdapter.test.ts \
  tests/stellar/spp/harness/browser/mockRpc.security.test.ts \
  tests/stellar/spp/harness/browser/rpcFixtureSchema.test.ts \
  tests/stellar/spp/harness/browser/browserHarness.availability.test.ts \
  tests/stellar/spp/harness/sppSignerHarness.feasibility.test.ts
→ 5 files, 36 tests passed
```

Sin live RPC, sin ops privadas, sin firmas de producción hacia red, sin instalar deps, sin cambiar producción.

**No ejecutado (razón):** `stellarTestnetLive.smoke.test.ts` (live); cualquier path `deposit`/`sync`/`sendTransaction` success.

---

## 13. Archivos examinados (principales)

**Fuente `b79107cd`:** `sdk/web/src/client/pool.rs`, `execute/mod.rs`, `client/mod.rs`; `sdk/native/src/pool.rs`, `sync.rs`, `chain/{submit,tx_prepare,signer,contract_state,rpc}.rs`  
**Local:** `SppWalletSignerAdapter.ts`, `signatureGate.ts`, `sep53.ts`, `index.ts`; `StateCoordinator.ts`; informes FASE-2.9–2.12; `package.json` SPP 0.2.1  
**Informe:** este archivo únicamente (harness docs).

---

## 14. Incertidumbres

- Equivalencia bit-a-bit npm WASM ↔ commit `b79107cd` (Fase 2.3).  
- Forma exacta de eventos/indexer post-confirm (no leído exhaustivamente).  
- Viabilidad OPFS dentro de MV3 service worker (no probada).  
- Campos públicos exactos de withdraw vs transfer en eventos (inferido de encode; no OBS).
