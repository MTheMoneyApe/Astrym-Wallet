# Fase 2.18 — Auditoría de concordancia semántica ApprovedIntent ↔ SPP Plan ↔ XDR

**Fecha:** 2026-10-26  
**Repositorio:** `C:\Users\M\Downloads\Stellar privacy project`  
**HEAD (antes y después):** `d872ac455f47ab8822aace0ba2f62e1574d6cf27`  
**Staging:** vacío (antes y después)  
**Alcance:** auditoría y diseño documental — **sin** conectar `ApprovedIntent`, `IntentStore`, `ContextualSignatureGate` ni `SppWalletSignerAdapter` al flujo de producción  
**Priors:** FASE-2.13 … FASE-2.17  

**Advertencia:** este informe **no** declara Solanym listo para pagos privados. Un digest correcto **no** prueba equivalencia semántica.

---

## 1. Estado de Git y preflight

| Momento | HEAD | Staging |
|---------|------|---------|
| Preflight | `d872ac455f47ab8822aace0ba2f62e1574d6cf27` | vacío |
| Cierre | mismo | vacío |

Working tree: cambios preexistentes (extension, `src/stellar/`, harness untracked, etc.). Backup / worktree aislado / `.vscode/mcp.json`: no tocados. Sin `git add` / `commit` / `reset` / `clean` / `checkout` / `restore`. Sin tráfico de red en esta fase.

Informes leídos: FASE-2.13 (lifecycle), 2.14 (integración), 2.15–2.17 (`approvedIntent`). Módulo inspeccionado: `packages/wallet-core/tests/stellar/spp/harness/approvedIntent/`.

---

## 2. Versiones y commits verificados

| Artefacto | Valor | Evidencia |
|-----------|-------|-----------|
| Dependencia workspace | `"stellar-private-payments": "0.2.1"` | `packages/wallet-core/package.json` |
| Paquete instalado | `0.2.1` | `node_modules/.pnpm/stellar-private-payments@0.2.1/.../package.json` |
| Lock integrity | `sha512-d4ABQKBB0DzLqM6v0sLpfGL7MdxnqXwhNIy5E3jtDgOI1S5jBhlJbkQxNl0g94MnGFyKZ1bl90thMTdSOOkhuQ==` | `pnpm-lock.yaml` |
| Circuit NOTICE commit | `b79107cd24327198f8eb2dbaf4bdc65a8a1e8cf1` | `dist/circuits/NOTICE.txt` (build UTC 2026-10-16) |
| Provenance npm↔git (Fase 2.4) | mismo commit vía SLSA `resolvedDependencies[0].digest.gitCommit` | `C:\Users\M\AppData\Local\Temp\spp-fase24-rpc-source-20261025-233039\FASE-2.4-VERSION-MATCHED-RPC-SOURCE.md` |
| Snapshot local | `…\upstream-src-b79107cd24327198f8eb2dbaf4bdc65a8a1e8cf1` | **Presente** en esta máquina; **no** se re-descargó |
| Re-hash offline (coincide 2.4) | `tx_prepare.rs` → `1A9F5C27…78931`; `soroban_encode.rs` → `0D561D57…0013CE` | `Get-FileHash` vs `SOURCE_FILE_HASHES.txt` |

**Incertidumbre residual (heredada 2.3/2.4):** equivalencia bit-a-bit del `.wasm` npm frente al árbol completo del commit no está demostrada por recompilación. El pin usado es el documentado por SLSA + NOTICE + snapshot aislado.

**Limitación del snapshot:** el árbol local es un **subconjunto** del commit. Existen `sdk/native/src/lib.rs` → `pub mod plan;` / `planner;` / `transact;` / `core;`, pero **`plan.rs` / `planner.rs` / `transact` no están en el directorio recuperado**. Conclusiones sobre `PreparedTransactionPlan` se basan en **call sites** (`pool.rs`, `execute/mod.rs`) y en APIs públicas npm, no en la definición completa del struct.

---

## 3. Flujo de firma reconstruido (fuente)

### 3.1 Entrada JS → plan → execute loop

Rutas:  
`sdk/web/src/client/pool.rs` · `sdk/web/src/client/execute/mod.rs` · `sdk/native/src/pool.rs`

| Op API | Solicitud original | Plan | Loop |
|--------|-------------------|------|------|
| `deposit(amount: bigint)` | stroops | `prepare_deposit(NoteAmount)` | `execute_plan(..., "deposit")` |
| `transfer(recipientG, amount)` | G… + stroops | `spendable_notes` → `prepare_transfer` (resuelve G… → privacy keys vía registry) | `execute_plan(..., "transfer")` |
| `transferToKeys(notePk, encPk, amount)` | keys hex + stroops | `prepare_transfer(Keys{…})` | idem |
| `withdraw(amount, recipient?)` | stroops; recipient default = `user_address` | `prepare_withdraw` | `execute_plan(..., "withdraw")` |
| `transact(config)` | campos bajos nivel | `prepare_transact(Transact)` | `execute_plan(..., "transact")` |

`execute_plan_inner` (`execute/mod.rs`):

```text
while !plan.is_complete():
  prove_next(plan)     → PreparedTransaction (ZK + ExtData + public inputs)
  simulate(&mut prep)  → prepare_pool_transact → unsigned tx XDR + auth_entries
  sign(prepared)       → WalletSigner: signAuthEntry* + signTransaction
  submit(signed)       → sendTransaction
  confirm(hash)        → getTransaction poll
```

**Hecho crítico:** `plan.tx_count()` puede ser **> 1** (`PoolEstimate.txCount`). Una operación lógica puede exigir **varias** transacciones on-chain, cada una con su propio prove→simulate→sign→submit. No asumir 1 op = 1 firma = 1 envelope.

### 3.2 Simulate → XDR entregado al signer

Ruta: `sdk/native/src/chain/tx_prepare.rs` → `prepare_pool_transact`

1. Codifica proof (`pool_proof_to_scval` / GVK variant) + `pool_ext_data_to_scval(&ext_data)` + `Address(sender)`.
2. Construye envelope `invoke_contract(pool, "transact", [proof, ext, sender])`.
3. `simulateTransaction`.
4. `PreparedSorobanTx::from_simulation` → `{ tx_xdr, auth_entries, latest_ledger, … }` (`contract_state.rs`).
5. **`check_transact_auth`** (SDK-side, antes de devolver XDR al wallet).

### 3.3 Firmas solicitadas (`signer.rs` + npm `WalletSigner`)

Rutas: `sdk/native/src/chain/signer.rs` · `js/types/signer.d.ts` · Solanym `SppWalletSignerAdapter.ts`

Por cada `PreparedSorobanTx`:

1. **N × `signAuthEntry`** — preimages `HashIdPreimage` SorobanAuthorization (base64 XDR) para entradas que `needs_wallet_auth`.
2. Patch de firmas en auth entries → envelope aún sin firma de tx.
3. **1 × `signTransaction`** — XDR del envelope (source = signer address).

Además, flujos de **registro** (`prepare_register`) pueden exigir auth del **owner** distinta del **payer** (comentario en `tx_prepare.rs`) — otra firma lógica fuera de deposit/transfer/withdraw simples.

`signMessage` (SEP-53) existe en la interfaz; no forma parte del loop `execute_plan` de pool transact auditado aquí.

### 3.4 Qué hace Solanym hoy en el signer

`SppWalletSignerAdapter` (`packages/wallet-core/src/stellar/spp/SppWalletSignerAdapter.ts`):

- Fija red + G… + `accountIndex`.
- Rechaza fee-bump; rechaza envelopes ya firmados.
- Autoriza **solo** por `SignatureAuthContext` = `{kind, account, networkPassphrase, payloadDigestHex}` — **sin** inspección de ops/montos/destinos/árbol Soroban (cabecera L7–16).
- **No** está cableado a `PrivatePool` / UI (FASE-2.13/2.14).

---

## 4. Diferencia plan / XDR / efectos SPP

| Capa | Qué contiene | Visibilidad wallet |
|------|--------------|-------------------|
| **Solicitud usuario** | op, amount, recipient G…/keys | UI (aún no existe en Solanym) |
| **PreparedTransactionPlan** | Secuencia de pasos / deposit_amount / Transact steps (módulo `plan` **ausente** del snapshot parcial) | **No** expuesto en JS público npm (`PrivatePool.deposit` etc. son fire-and-forget hasta `PoolExecuteResult`) |
| **PreparedTransaction** (post-prove) | proof bytes, ExtData, public inputs (nullifiers, commitments, `public_amount`, `ext_data_hash`, ASP roots) | Interno SDK |
| **XDR tx** | Una op `invokeHostFunction` → `transact(proof, ext_data, sender)` | Bytes opacos al adapter; parseables con `@stellar/stellar-sdk` |
| **Auth entry XDR** | Árbol de invocación autorizado (deposit: + `token.transfer`) | Bytes opacos; parcialmente parseables |
| **Efectos SPP off-chain** | Notas cifradas, mapping recipient keys, montos internos de notes | **No** en claro en XDR para transfer |
| **ApprovedIntent (harness)** | Documento semántico Solanym + digests opacos | Modelo offline 2.15–2.17; **no** producido por SPP |

Todas las ops de valor llaman al **mismo** método on-chain `transact`. La distinción deposit / transfer / withdraw es semántica de `ExtData.ext_amount` (+ contexto de notes), no de nombre de función distinto.

---

## 5. Matriz de concordancia semántica

Leyenda: **VERIFIED** (evidencia fuente + extraíble) · **PARTIAL** · **UNVERIFIED** · **BLOCKED**

| Campo | Origen | Transformación | ¿En XDR? | ¿Extraíble c/ herramientas existentes? | ¿Requiere semántica SPP? | ¿Comprobable antes de firmar? | Si falta / contradice | Clase |
|-------|--------|----------------|----------|----------------------------------------|---------------------------|-------------------------------|------------------------|-------|
| Op deposit/transfer/withdraw | API `PrivatePool.*` | Plan → Transact step → siempre `transact` | Solo implícito | Inferible **parcialmente** de `ext_amount` sign + presencia de sub-auth `transfer` | Sí (signo/contexto) | Parcial si se parsea ExtData+auth | Marcar `unknownCritical` / rechazar approve | **PARTIAL** |
| Cuenta origen / sender | `signerAddress` / Account | Envelope source + arg `sender` | Sí | Sí (`Transaction.source`, ScVal Address) | No | Sí | Rechazo (adapter ya exige match) | **VERIFIED** (structural) |
| Destinatario G… (withdraw / visible) | `withdraw(to)` / default user | `ExtData.recipient` | Sí (Address en ext map) | Sí vía decode ScVal ExtData | Parcial | Sí si decode | Rechazar si ≠ intent | **PARTIAL** |
| Destinatario privacy keys (transfer) | keys o registry lookup | Cifrado en `encrypted_output*` | No en claro | No (solo ciphertext) | Sí | **No** desde XDR solo | `unknownCritical` obligatorio sin plan metadata | **BLOCKED** |
| Pool contract | PoolOptions / config | Invoke contract id | Sí | Sí | No | Sí | Rechazar | **VERIFIED** |
| Token / asset | `ContractConfig.pools[].token` + asset | Auth subcall deposit; hash domain | Token en auth tree (deposit); asset kind **no** en invoke args | Token: sí en auth; asset metadata: config | Config SPP | Deposit: sí; transfer: N/A token move | Rechazar deposit si transfer ≠ expected | **PARTIAL** |
| Cantidad lógica (stroops) | API `amount` | Deposit → `ext_amount` > 0; withdraw → `ext_amount` < 0; transfer puro → a menudo 0 on-chain | `ext_amount` + `public_amount` en proof | `ext_amount` sí; `public_amount` en proof map (complejo) | Sí | Deposit/withdraw: **PARTIAL**; transfer amount: **BLOCKED** desde XDR | Rechazar o unknownCritical | **PARTIAL** / **BLOCKED** |
| Unidades / decimals | Token config / UI | No en XDR | No | No desde XDR | Config | Solo vía config confiable | No truncar; fail-closed | **UNVERIFIED** en XDR |
| Network passphrase | AccountOptions / adapter | network_id en auth preimage; tx hash | Implícito | Adapter fija + verifica opts; preimage network check | No | Sí (adapter) | Rechazo | **VERIFIED** (binding) |
| Fees | simulate / BASE_FEE | Envelope fee | Sí | Sí | No | Sí (valor); “estimado vs confirmed” es política UI | Fee-bump: adapter rechaza | **PARTIAL** |
| Efectos públicos / privacyLimits | Narrativa UI / ApprovedIntent | No on-chain | No | N/A | Política producto | Solo como texto; no equivalencia | No usar como prueba | **UNVERIFIED** (no on-chain) |
| Función invocada | SDK hardcode `"transact"` | — | Sí | Sí | No | Sí == `transact` | Rechazar otra | **VERIFIED** |
| Args invoke | proof, ext_data, sender | encode | Sí | ExtData fields sí; proof opaco | Sí para interpretar proof | ExtData: parcial; proof: no semántica wallet | Rechazar args count/shape wrong | **PARTIAL** |
| Ops adicionales en auth tree | Simulation | `check_transact_auth` limita | En auth entries | Sí (stellar-sdk XDR) | SDK ya restringe | Sí si reimplementamos check | SDK aborta prepare; wallet debe **re**validar | **PARTIAL** (SDK VERIFIED; wallet UNVERIFIED) |
| Ops adicionales en envelope | tx_assemble | Una invoke | Ops del tx | Sí | No | Exigir exactamente 1 op invoke | Rechazar multi-op | **VERIFIED** (si se implementa check) |
| Digests plan / intent (ApprovedIntent) | Harness Solanym | `planDigest` / `operationDigest` | N/A | Autocoherencia solo | N/A | No equivalencia plan↔XDR | Caso adv. #7 | **BLOCKED** como prueba semántica |
| Digest XDR / auth (gate) | `tx.hash()` / `hash(preimage)` | ContextualSignatureGate | N/A | Binding digest | No | One-shot digest ≠ meaning | Cubre replay de digest, no semántica | **VERIFIED** (digest only) |
| Multi-tx plan | `estimate` / plan.tx_count | N firmas | N envelopes | Progress events `txCount` | Sí | Requiere N approvals | Una approve ≠ plan completo | **PARTIAL** |
| Fee-bump wrapper | — | No usado en prepare auditado | — | Adapter rechaza | — | Cubierto localmente | Rechazo | **VERIFIED** (policy) |
| Datos que afectan privacidad (nullifiers, timing RPC) | Prove + red | Públicos on-chain / metadatos | Parcial en proof | Limitado | Protocolo | No “ocultos” por firma | Disclosure de política UI | **PARTIAL** |

---

## 6. Amenazas analizadas

| Amenaza | ¿Cubierta hoy? | ¿Requiere cambios? | ¿Irresoluble con info disponible? |
|---------|----------------|--------------------|-----------------------------------|
| Plan cambia tras aprobación UI | ApprovedIntent freeze + fingerprint (harness); SPP no expone plan a UI | Host debe congelar plan/XDR **antes** de approve y revalidar en cada sign | No, si hay hook pre-sign |
| XDR firmado ≠ plan aprobado | Gate solo digests; adapter no compara semántica | Extractor ExtData+auth + IntentStore.consume | Transfer keys amount: sí bloqueado |
| Tx con ops adicionales | SDK `check_transact_auth` en prepare; wallet **no** revalida | Replicar check en host/wallet antes de `sign*` | No (árbol auth es XDR) |
| Destino/activo/cantidad ≠ UI | Sin UI SPP; XDR no muestra keys/amount transfer | Ver matriz | Destino keys + amount transfer: **sí** sin metadata de plan |
| Passphrase / source incorrectos | Adapter VERIFIED | Mantener | No |
| Fee-bump no contemplado | Adapter rechaza | Mantener | No |
| Plan con datos no reflejados en tx final | Multi-step; encrypted notes | Aprobar por **paso** o exigir metadata SDK | Montos internos notes: inherentemente off-chain |
| Varias firmas / una op lógica | execute_plan N×(auth*+tx) | ApprovedIntent multi-lease / batch contexts | No, pero diseño de approve debe ser multi-digest |
| Replay / concurrencia / restart | IntentStore in-process (2.17); gate one-shot; sin persistencia | Store durable | Cross-process: sí hasta persistencia |
| Datos opacos (proof, ciphertext) | Limitación protocolaria | unknownCritical / no claim | **Sí** para “ver effects reales” del transfer privado |

---

## 7. Opciones técnicas (sin implementar)

### A. Decodificación con `@stellar/stellar-sdk`

**Viable para:** source, passphrase binding, single `invokeHostFunction`, contract id, symbol `transact`, decode ExtData map (`ext_amount`, `recipient`, encrypted byte lengths), parse auth root/subinvocations, detectar fee-bump / multi-op.

**No viable para:** plaintext de `encrypted_output*`, equivalencia amount de transfer privado, validar proof ZK, demostrar que el plan multi-tx completo coincide sin metadatos de plan.

**No** crear parser XDR artesanal: usar `TransactionBuilder.fromXDR`, `xdr.*`, ScVal helpers ya en dependencia.

### B. APIs oficiales SPP

**Hallazgo:** la superficie JS pública (`PrivatePool.deposit|transfer|withdraw`, `WalletSigner`) **no** exporta `PreparedTransactionPlan` ni un “preview” semántico pre-firma. El wallet solo recibe strings XDR en `signTransaction` / `signAuthEntry`.

`check_transact_auth` es **interno** Rust (`tx_prepare.rs`) — protección del SDK, no API de wallet review.

**Limitación:** sin nueva API upstream o instrumentación del host que intercepte post-simulate, B solo no cierra ApprovedIntent↔plan.

### C. Representación semántica canónica

Derivar de datos **verificados** (ExtData decodificado + auth tree + config pool/token + op API conocida), **no** del texto de UI.

Propuesta lógica:

```text
CanonicalStep = {
  flow: 'deposit'|'transfer'|'withdraw',
  pool, token, sender, networkPassphrase,
  extAmount: i128,
  recipientAddress: G|C|…,   // from ExtData
  authTree: 'deposit-transfer' | 'transact-only',
  txIndex / txCount,
  envelopeDigest, authDigests[]
}
```

Comparar `CanonicalStep` ↔ `ApprovedIntent` campo a campo; cualquier hueco → `unknownCritical` → no approve.

Para **transfer**, amount/destination keys deben venir de un **plan snapshot** del SDK (hoy no expuesto) o quedar BLOCKED.

### D. Arquitectura alternativa

Si SPP no expone plan verificable:

1. **Host wrapper** que no llame `deposit()` monolítico; en su lugar orquestar `prepare_*` / `prove_next` / `simulate` vía API nativa (hoy mayormente no exportada a JS) — **BLOCKED** en 0.2.1 browser API.
2. **Upstream feature request:** `preview` / `PreparedPlanView` con ExtData + amounts + recipient keys commitment.
3. **Fail-closed policy:** solo permitir approve automático de campos VERIFIED (deposit ext_amount + token transfer auth); transfer/withdraw con keys → revisión humana + unknownCritical hasta preview.

---

## 8. Bloqueos que impiden la integración (honestos)

1. **No hay API JS de plan semántico** en `stellar-private-payments@0.2.1` entre prepare y sign.  
2. **Snapshot parcial:** módulos `plan` / `planner` / `transact` no disponibles localmente para tipar `PreparedTransactionPlan` al 100%.  
3. **Transfer privado:** cantidad y destinatario efectivo **no** están en claro en el XDR.  
4. **ApprovedIntent digests** (harness) **no** demuestran concordancia con ExtData/proof.  
5. **Multi-tx:** una aprobación de “operación” no equivale a una firma.  
6. **Wiring producción** Client/Pool/UI/gate: ausente (2.13–2.14); fuera de alcance 2.18.  
7. **Revalidación wallet** de `check_transact_auth`: aún no implementada en Solanym (solo en SDK).

**Camino verificable (sí existe, acotado):** para **deposit** (y withdraw con recipient G… visible), un extractor offline basado en stellar-sdk + layout `pool_ext_data_to_scval` / `check_transact_auth` puede demostrar concordancia de pool, sender, `ext_amount`, recipient Address, y árbol auth — **sin** confiar en digests opacos. Eso **no** generaliza a transfer-to-keys.

---

## 9. Propuesta del siguiente incremento mínimo y verificable

**Fase 2.19 (propuesta, no ejecutada):** harness offline *SemanticConcordance* (solo tests):

1. Fixtures XDR **sintéticas** construidas con `@stellar/stellar-sdk` imitando `pool_ext_data_to_scval` + invoke `transact` + auth tree deposit (sin red, sin ZK real).  
2. Función pura `extractCanonicalStepFromTxAndAuth(xdr, authEntries, network)` → campos VERIFIED.  
3. Comparador `assertConcordance(ApprovedIntent, CanonicalStep)` con tablas de rechazo.  
4. Casos: deposit OK; ext_amount mismatch; extra sub-invocation; transfer fixture → `unknownCritical` / BLOCKED amount.  
5. **Sin** cablear gate, adapter producción, ni PrivatePool.

Criterio de éxito 2.19: pruebas rojas/verdes que documenten VERIFIED vs BLOCKED — no “integración segura”.

---

## 10. Lista explícita de lo **no** demostrado

- Equivalencia WASM npm ↔ árbol fuente completo por rebuild.  
- Estructura completa de `PreparedTransactionPlan` (módulo ausente del snapshot).  
- Que el usuario pueda inspeccionar el plan SPP en JS antes de firmar (API 0.2.1).  
- Concordancia amount/destination de **private transfer** desde solo XDR.  
- Que `operationDigest` / `planDigest` del harness equivalgan a semántica SPP.  
- Revalidación Solanym del auth tree en producción.  
- Single-use durable cross-process de approvals.  
- E2E deposit/transfer/withdraw real o Testnet.  
- Cobertura Nym del transporte RPC SPP.  
- Seguridad de integración “porque compila”.

---

## 11. Criterio de cierre de esta fase

| Pregunta | Respuesta |
|----------|-----------|
| ¿Existe camino verificable para cerrar la brecha? | **Sí, parcial:** deposit (y withdraw con recipient en claro) vía decode ExtData+auth con stellar-sdk + reglas alineadas a `check_transact_auth`. |
| ¿Qué garantías siguen imposibles? | Semántica completa de **transfer-to-keys** (amount/dest) solo con XDR; preview de plan multi-step sin API SDK; digests opacos como prueba de equivalencia. |
| ¿Se conectó producción? | **No.** |
| ¿Tráfico externo / firmas reales? | **No.** |

---

## 12. Archivos de esta fase

| Acción | Ruta |
|--------|------|
| Creado | `packages/wallet-core/tests/stellar/spp/harness/browser/docs/FASE-2.18-PLAN-XDR-SEMANTIC-BOUNDARY.md` |
| Producción / manifests / lockfiles / tests de comportamiento | **No modificados** |

**Validación:** relectura offline de fuentes + `Get-FileHash` de `tx_prepare.rs` / `soroban_encode.rs` (match Fase 2.4). No se ejecutó vitest adicional (fase documental; harness 2.17 intacto).

**Git al cierre:** HEAD `d872ac4…`; staging vacío; solo nuevo untracked este `.md` (bajo el árbol harness ya untracked).
