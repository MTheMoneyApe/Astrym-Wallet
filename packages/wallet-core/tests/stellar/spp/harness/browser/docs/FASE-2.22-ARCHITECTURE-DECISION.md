# Fase 2.22 — Decisión de arquitectura para integración SPP

**Fecha:** 2026-10-26  
**HEAD (antes y después):** `d872ac455f47ab8822aace0ba2f62e1574d6cf27`  
**Staging:** vacío (antes y después)  
**SDK instalado:** `stellar-private-payments@0.2.1` (npm) · commit de trabajo documentado `b79107cd…` (Fases 2.3–2.4 / NOTICE)  
**Priors leídos:** FASE-2.13 … FASE-2.21  
**Alcance:** decisión documental únicamente — **sin** implementar integración de producción, **sin** contactar upstream, **sin** firmas / simulate / submit, **sin** cambios de manifests/lockfiles/código de producción.

**No se declara** Solanym listo para pagos privados reales.

---

## 1. Preflight

| Ítem | Valor |
|------|--------|
| Raíz | `C:/Users/M/Downloads/Stellar privacy project` |
| HEAD | `d872ac455f47ab8822aace0ba2f62e1574d6cf27` |
| Staging | vacío |
| Working tree | Cambios preexistentes (extension, `src/stellar/`, harness untracked, etc.) — **preservados** |
| Backup / worktree aislado / `.vscode/mcp.json` | No tocados |
| Git mutaciones | Ninguna |

Comandos: `git rev-parse --show-toplevel`, `git rev-parse HEAD`, `git status --short`, `git diff --cached --name-only`.

---

## 2. Evidencia disponible y limitaciones

### 2.1 Qué está demostrado (2.13–2.21)

| Capa | Evidencia | Clasificación |
|------|-----------|---------------|
| Lifecycle SPP (prove→sim→sign→submit→confirm) | Fuente `b79107cd` + tipado npm `0.2.1` | CONFIRMADO_EN_FUENTE |
| API JS pública | `Client`, `PrivatePool.deposit\|transfer\|transferToKeys\|withdraw\|estimate\|transact`, `WalletSigner`, lecturas `aspState`/`allContractsData` | CONFIRMADO en `js/types/*` instalado |
| Adapter + gate digest-bound | `SppWalletSignerAdapter`, `ContextualSignatureGate` | IMPLEMENTADO_LOCALMENTE; **no** cableados a UI/Pool |
| ApprovedIntent SM | Harness 2.15–2.17 | VALIDADO_EN_HARNESS (offline) |
| Concordancia ExtData+auth ↔ intent (deposit/withdraw, 1 tx) | `semanticValidator` 2.19–2.21 | VALIDADO_EN_HARNESS; `classification` autoritativo; `safetyClaim: not_full_protocol_safety` |
| Auth↔tx binding | `AUTH_TX_MISMATCH` (2.20) | VALIDADO_EN_HARNESS |
| Contrato de resultados | `acceptSurfaceVerification` ≠ firma; `verifiable_complete` no autoritativo (2.21) | VALIDADO_EN_HARNESS |
| Lecturas ledger (ASP / all contracts) | Harness 2.9–2.12 | VALIDADO_EN_HARNESS (fixtures / mock RPC) |

### 2.2 Qué **no** está demostrado / no existe en `0.2.1` JS

| Hueco | Evidencia |
|-------|-----------|
| Preview / snapshot tipado de `PreparedTransactionPlan` entre prepare y sign | FASE-2.18: no exportado; snapshot parcial sin `plan.rs`/`planner.rs` |
| `PrivatePool.deposit` etc. son fire-and-forget → `PoolExecuteResult` | `js/types/crates/…d.ts`: solo resultado terminal + `estimate().txCount` |
| Semántica transfer-to-keys (amount/dest) desde solo XDR | FASE-2.18/2.19 **BLOCKED** |
| Proof ZK / ciphertext | Siempre `unverified` en éxito de superficie |
| Multi-tx (`planTxCount > 1`) | Reject cerrado en validador; `PoolEstimate.txCount` solo anticipa cardinalidad |
| Wiring Client/Pool/UI/gate/IPC | FASE-2.13/2.14: ausente |
| Transporte RPC inyectable / Nym→SPP | No demostrado |
| Equivalencia bit-a-bit WASM npm ↔ árbol fuente completo | Incertidumbre residual 2.3/2.4 |

### 2.3 Invariantes de seguridad que esta decisión **no** puede debilitar

1. `classification` sigue siendo el descriptor autoritativo de alcance.  
2. `status === 'verifiable_complete'` **nunca** autoriza firma.  
3. `acceptSurfaceVerification` es aceptación de superficie **offline / harness**; **no** es grant de firma de producción.  
4. Campos ausentes ≠ garantías positivas.  
5. Ops BLOCKED siguen fail-closed hasta que exista representación verificable del plan (o metadata SDK).

---

## 3. Opción A — Ampliar la API del SDK

### 3.1 Qué hace falta (sin inventar módulos ausentes)

La API JS publicada **no** expone el plan intermedio. Lo que el wallet recibe hoy es:

```text
PrivatePool.deposit|…  →  (interno: plan → prove → simulate)  →  WalletSigner.signAuthEntry* + signTransaction(xdr)
                       →  PoolExecuteResult
```

Para vincular **intención de usuario ↔ plan ↔ cada firma** hace falta una representación tipada **pre-firma** que el host pueda congelar y revalidar. Forma mínima coherente con evidencia 2.18–2.21 (propuesta de **requisito**, no API inventada como si ya existiera):

```text
PlanStepView (requerido upstream o equivalente interceptable) = {
  stepIndex, stepCount,                 // multi-tx explícito
  flow: 'deposit'|'transfer'|'withdraw'|…,
  networkPassphrase, poolContractId, tokenContractId?,
  senderAccount,
  extAmount,                            // i128 cleartext from ExtData (post-encode)
  recipientAddress?,                    // G… / C… when present in ExtData
  recipientKeysCommitment?,             // for transfer-to-keys — MUST come from plan, not XDR alone
  logicalAmountUnits,                   // intent amount; must match flow rules
  authTreeShape: 'deposit-transfer' | 'transact-only' | …,
  transactionXdr, authEntryXdrs[],      // post-simulate material
  envelopeDigestHex, authDigestHex[],   // exact payloads to sign
  planFingerprintHex                    // stable hash of plan fields pre-approve
}
```

### 3.2 Datos / invariantes / plan inmutable

| Requisito | Detalle |
|-----------|---------|
| Datos | Por cada paso: op lógica, montos cleartext verificables, destinos cleartext o commitment de keys, pool/token/red/cuenta, XDR+auth, digests de firma, `stepIndex/stepCount` |
| Invariantes | Auth root args ≡ invoke args; árbol auth alineado a `check_transact_auth`; un solo invoke `transact` por envelope; no fee-bump; `planFingerprint` no cambia tras approve |
| Plan no muda tras approve | Congelar `planFingerprint` + digests; en cada `sign*` recomputar y exigir igualdad; mismatch → abort (modelo ya ensayado en ApprovedIntent 2.15–2.17) |
| Multi-op / multi-tx | Enumerar N pasos; **una** ApprovedIntent lease **por paso** (o batch explícito de digests); nunca “una approve = plan completo” |
| Compatibilidad `0.2.1` | Hoy **no** hay estos tipos. Ampliar implica **nueva versión** semver del SDK (p.ej. `0.3.x`) o API experimental opt-in. Solanym pinneado a `0.2.1` no puede asumir exports futuros |

### 3.3 Camino Solanym **sin** nueva versión SDK (parcial)

Punto de interceptación **ya existente** en `0.2.1`: `WalletSigner`.

- Tras `simulate`, el SDK llama `signAuthEntry` / `signTransaction` con XDR.  
- El host puede parsear ExtData+auth (misma superficie que el harness 2.19–2.21), comparar con un `ExpectedSemanticIntent` aprobado en UI, y solo entonces `gate.approve` + firmar.  
- **No** sustituye un `PlanStepView` tipado: no hay preview pre-prove, no hay amount/keys de transfer en claro, no hay fingerprint oficial del plan interno.  
- **No** inventa que `prepare_*` JS exista: no está en los `.d.ts` públicos.

### 3.4 Dependencias y riesgos (A)

| + | − |
|---|---|
| Desbloquea representación verificable del plan de forma limpia | Requiere cambio versionado upstream o fork |
| Permite transfer metadata + multi-tx honestos | Tiempo de adopción; pin `0.2.1` queda corto |
| Alineable a `classification` / bindingId | Riesgo de “preview” incompleto que se venda como seguridad total |
| Interceptación WalletSigner viable ya para deposit/withdraw superficie | Interceptación no es API estable de plan; UX atada al momento de firma |

---

## 4. Opción B — Colaborar con upstream

**No contactado en esta fase** (requisito). Lo siguiente es la propuesta técnica lista para enviar después.

### 4.1 Bloqueo actual

`stellar-private-payments@0.2.1` ejecuta el plan de forma opaca al wallet: no hay vista tipada pre-firma del plan; el wallet solo ve XDR en `WalletSigner`. Sin metadata de plan, **transfer-to-keys** y la equivalencia plan↔intent no son demostrables solo desde XDR (FASE-2.18). El validador Solanym solo cubre superficie deposit/withdraw single-tx con `safetyClaim: not_full_protocol_safety`.

### 4.2 API / interfaz solicitada (borrador)

1. **`preview` / `prepareVisiblePlan` (nombre a convenir)** que, tras prepare (+ opcionalmente tras prove/sim del primer paso o de todos), devuelva `PlanStepView[]` serializable (campos §3.1) **sin** firmar.  
2. Alternativa mínima: callback / hook **`onPreparedForSign(step: PlanStepView): Promise<'proceed'|'abort'>`** invocado dentro de `execute_plan` **antes** de cada `WalletSigner.sign*`.  
3. Exponer `planFingerprint` estable y `stepCount`/`stepIndex` (hoy solo `estimate().txCount` anticipa cardinalidad).  
4. Para transfer: incluir en la vista `logicalAmountUnits` + `recipientKeys` (o commitment canónico) **desde el plan**, no desde ciphertext.

### 4.3 Garantías mínimas necesarias

- Fingerprint del plan inmutable entre preview/approve y cada sign.  
- Auth↔tx binding equivalente a lo endurecido en 2.20 (o documentar que el wallet debe revalidar).  
- Enumeración completa de pasos de firma (auth + tx) por step.  
- Tipado estable en `js/types` de la versión publicada (no solo Rust interno).  
- Semver claro; changelog de breaking changes respecto a `0.2.1`.

### 4.4 Pruebas de aceptación propuestas (para upstream / Solanym)

| # | Aceptación |
|---|------------|
| 1 | Deposit single-tx: preview ExtData+auth coincide con intent; mutar amount en XDR → wallet abort |
| 2 | Withdraw a G…: recipient ExtData ≡ preview |
| 3 | Cross-pair TX/auth → rechazo (AUTH_TX_MISMATCH semantics) |
| 4 | `estimate.txCount === N` ⇒ exactamente N `PlanStepView` y N ciclos de approve |
| 5 | Transfer-to-keys: amount/keys visibles en plan view; XDR-only path sigue insuficiente |
| 6 | Tras approve, cambiar planFingerprint → sign denied |
| 7 | Documentación: preview ≠ proof ZK validity |

### 4.5 Dependencias y riesgos (B)

| + | − |
|---|---|
| Desbloquea el hueco real (plan verificable) | Latencia / prioridad upstream desconocida |
| Evita fork de WASM/SDK | Solanym no controla el calendario |
| Alineado a wallets (Freighter-style) | Mientras tanto, MVP debe vivir sin transfer |

---

## 5. Opción C — Reducir el alcance del MVP

### 5.1 Distinción explícita

| Categoría | Contenido |
|-----------|-----------|
| **Funcionalidad real (candidata a producto, con límites)** | Lecturas tipadas `aspState` / `allContractsData` (ya ejercidas en harness); Stellar **público** Send/Dashboard existentes; adapter+gate digest-bound como **capa cripto**, no como semántica SPP |
| **Prototipos offline (no producto)** | `approvedIntent/*`, `semanticValidator/*`, fixtures sintéticas, informes 2.13–2.21 |
| **Funcionalidad bloqueada hasta plan verificable / criterios §7** | UI de `deposit` / `withdraw` / `transfer` / `transferToKeys` como “pago privado listo”; cablear `acceptSurfaceVerification` → firma; multi-tx; claim de seguridad completa |
| **No exponer al usuario todavía** | Ops privadas mutadoras; cualquier CTA que implique “verificado / privado / seguro” por `verifiable_complete`; transfer-to-keys; planes con `txCount > 1` sin approve por paso |

### 5.2 Deposit / withdraw **no** están listos para producción

Aunque el validador verifica **parte** de su superficie:

- Proof y ciphertext siguen opacos (`classification: surface_verified_with_opaque_remainder`).  
- Fixtures son sintéticas, no material auténtico post-simulate del SDK.  
- No hay host MV3 + Client + sync + UI approve cableados.  
- `acceptSurfaceVerification.authorizesSigning === false` por contrato (2.21).  

Por tanto: **superficie verificable ≠ autorización de producción**.

### 5.3 MVP demostrable **sin** fingir garantías

**MVP-0 (ahora, ya casi cubierto):** documentación + harness offline + contrato de resultados endurecido. Demostrable en CI sin red.

**MVP-1 (siguiente incremento de *integración*, aún no “pagos privados productizados”):**

Solo si se cumplen criterios §7:

- Host documento (offscreen/ventana) con `Client` + OPFS — **read-only** primero (`aspState` / `allContractsData` / notes si aplica) en Testnet allowlisted.  
- **Sin** botones de mutación SPP en UI, o detrás de flag “experimental / no safety claim”.  

**MVP-2 (primera mutación acotada — *después* de §7 + path de firma):**

- **Únicamente** `deposit` **o** `withdraw` a `G…` / self, con `estimate().txCount === 1` (si `>1` → abort UI).  
- Flujo: intent UI → (SDK execute) → en `WalletSigner`, construir `OperationEvidence` → `validateSemanticConcordance` → exigir `classification === surface_verified_with_opaque_remainder'` + `safetyClaim` correcto + binding → **capa distinta** `SigningAuthorization` (gate digests + approve de usuario) → firmar.  
- UI lista `unverifiedFields` / `privacyLimits` / “no full protocol safety”.  
- **Prohibido:** usar `verifiable_complete` o `acceptSurfaceVerification` como única condición de firma.

**Fuera de MVP-2:** `transfer`, `transferToKeys`, `transact` raw, multi-tx, Nym-over-SPP, promoción a “completo”.

### 5.4 Dependencias y riesgos (C)

| + | − |
|---|---|
| No depende de garantías inexistentes | No entrega transfer privado pronto |
| Respeta 2.18–2.21 | Presión de producto puede empujar a “activar deposit” prematuro |
| Camino WalletSigner usable en `0.2.1` para superficie | Sin B/A completo, transfer sigue imposible de verificar |

---

## 6. Comparación de las tres opciones

| Criterio | A Ampliar API SDK | B Upstream | C Reducir MVP |
|----------|-------------------|------------|---------------|
| Desbloquea plan verificable | Sí (si se implementa) | Sí (si se acepta) | No por sí sola; mitiga no fingiendo |
| Viable con pin `0.2.1` | Parcial vía WalletSigner only | N/A (pide versión nueva) | Sí para demo offline + read-only |
| Transfer-to-keys verificable | Solo con metadata de plan | Requiere esa metadata | Explicitamente excluido |
| Riesgo de debilitar 2.21 | Alto si preview se trata como safety | Bajo si aceptación exige classification | Bajo si se disciplina el scope |
| Tiempo hasta “algo integrable” | Medio/alto | Incierto | Corto para MVP-0/1; MVP-2 condicionado |
| Dependencia externa | Fork o release | Proyecto SPP | Solanym + (luego) A/B |

---

## 7. Criterios objetivos para pasar a integración (gate)

Todos deben cumplirse **antes** de cablear mutaciones SPP a UI/IPC/`StateCoordinator` de producción:

| # | Criterio | Medida objetiva |
|---|----------|-----------------|
| G1 | Contrato de resultados intacto | Firma solo tras capa `SigningAuthorization` que **prohíbe** `verifiable_complete` / `acceptSurfaceVerification` como grant |
| G2 | Evidence auténtica post-simulate | `OperationEvidence` proviene del XDR pasado a `WalletSigner` (no fixtures sintéticas en prod path) |
| G3 | Single-tx enforced | `PoolEstimate.txCount === 1` **y** validador `planTxCount === 1`; si no, abort |
| G4 | Ops permitidas | Allowlist: solo `deposit` y/o `withdraw`+G…; transfer* ausente de UI |
| G5 | Re-validación en sign | Live `validateSemanticConcordance` + `classification` surface + binding; mismatch → no sign |
| G6 | Gate digest + lifecycle | `ContextualSignatureGate` require-prior-approval **y** `StateCoordinator` lifecycle; ninguno solo |
| G7 | Persistencia single-use | IntentStore durable cross-restart (brecha 2.17 cerrada o documentada como blocker residual aceptado por producto) |
| G8 | Host no-SW | Documento estable OPFS/workers (diseño 2.14) implementado al menos en stub Testnet |
| G9 | Config Testnet real | `ContractConfig` + RPC allowlist; sin claim Nym-SPP |
| G10 | Plan representation path | **O bien** interceptación WalletSigner documentada para MVP-2 **o bien** API preview upstream (A/B) adoptada; transfer requiere B/A completo |
| G11 | Divulgación UI | `unverifiedFields` + `not_full_protocol_safety` visibles; sin copy “fully verified private payment” |

**Criterio explícito de desbloqueo del plan:**  
Hasta que exista `PlanStepView` (upstream) **o** un diseño revisado de interceptación WalletSigner + fingerprint de intent que cubra multi-tx y transfer metadata, **no** se ampliará el allowlist más allá de deposit/withdraw single-tx superficie.

---

## 8. Recomendación final

### Decisión

**Adoptar C como alcance de producto inmediato, con A-parcial (interceptación `WalletSigner` en `0.2.1`) como único camino de mutación acotada futura, y B (upstream `PlanStepView` / hook pre-sign) como dependencia dura para transfer / multi-tx / representación completa del plan.**

Orden:

1. **Ahora:** congelar narrativa de producto = MVP-0 (harness + docs). No UI de ops privadas.  
2. **Desbloqueo del plan:**  
   - Corto plazo: especificar `SigningAuthorization` Solanym sobre evidence capturada en `WalletSigner` (sin tratar surface accept como firma).  
   - Medio plazo: enviar propuesta §4 a upstream (fuera de esta fase) y pinnear una versión ≥ que exporte preview tipado.  
3. **No** ampliar la API inventando módulos `plan`/`planner` locales a partir del snapshot parcial.  
4. **No** promover deposit/withdraw a producción solo porque el validador parcial pasa.

### Por qué

- La evidencia 2.18–2.21 muestra un **bloqueo estructural** (plan no visible en JS) y un **camino parcial real** (ExtData+auth para deposit/withdraw).  
- Ampliar SDK (A) sin upstream es un fork costoso; pedir upstream (B) es correcto pero no desbloquea el calendario.  
- Reducir MVP (C) es el único modo de no depender de garantías inexistentes **hoy**.  
- Mezclar C + interceptación WalletSigner preserva el pin `0.2.1` sin debilitar `classification` / 2.21.  
- Transfer y multi-tx quedan honestamente fuera hasta B/A completo.

### Alcance mínimo de MVP que puede demostrarse (sin garantías fantasma)

| Entregable | Estado objetivo |
|------------|-----------------|
| Informes + harness ApprovedIntent + semanticValidator + contrato 2.21 | **Demostrable ahora** (CI offline) |
| Read-only Client en host experimental | Demostrable tras G8–G9; sin mutación |
| Deposit o withdraw single-tx experimental con disclosure de opacos | Solo tras G1–G11; aún `not_full_protocol_safety` |
| Transfer / “pagos privados completos” | **No** en MVP |

---

## 9. Archivos modificados, pruebas, Git

| Acción | Ruta |
|--------|------|
| **Creado** | `packages/wallet-core/tests/stellar/spp/harness/browser/docs/FASE-2.22-ARCHITECTURE-DECISION.md` |
| Código producción / harness ejecutable / manifests / lockfiles | **No modificados** |

**Pruebas ejecutadas:** ninguna (fase documental; sin cambios de código). Suites 2.19–2.21 permanecen como evidencia previa (41 tests en cierre 2.21).

**Estado Git al cierre**

| Ítem | Valor |
|------|--------|
| HEAD | `d872ac455f47ab8822aace0ba2f62e1574d6cf27` |
| Staging | vacío |
| Tráfico externo | ninguno |
| Firmas / simulate / submit | ninguno |
| Contacto upstream / issues | ninguno |

---

## 10. Criterio de cierre de esta fase

| Pregunta | Respuesta |
|----------|-----------|
| ¿Decisión explícita sobre desbloquear el plan? | **Sí:** preview tipado upstream (B/A) para cobertura completa; interim WalletSigner intercept para superficie deposit/withdraw only |
| ¿MVP sin garantías inexistentes? | **Sí:** MVP-0 ahora; mutación solo post-gates §7; transfer excluido |
| ¿Se debilitó 2.18–2.21? | **No** — classification autoritativa; verifiable_complete / acceptSurfaceVerification no autorizan firma |
| ¿Integración de producción implementada? | **No** |
