# Fase 2.21 — Semantic Validator Result Contract Hardening

**Fecha:** 2026-10-26  
**HEAD (antes y después):** `d872ac455f47ab8822aace0ba2f62e1574d6cf27`  
**Staging:** vacío (antes y después)  
**Módulo:** `packages/wallet-core/tests/stellar/spp/harness/semanticValidator/`  
**Priors leídos:** FASE-2.18-PLAN-XDR-SEMANTIC-BOUNDARY, FASE-2.19-PARTIAL-SEMANTIC-VALIDATOR, FASE-2.20-ADVERSARIAL-VALIDATOR-AUDIT  

**Alcance:** endurecimiento del contrato de resultados + pruebas adversariales offline. **Sin** conectar prototipo a producción, signer, gate, `StateCoordinator`, IPC ni UI.

---

## 1. Preflight

| Ítem | Valor |
|------|--------|
| Raíz | `C:/Users/M/Downloads/Stellar privacy project` |
| HEAD | `d872ac455f47ab8822aace0ba2f62e1574d6cf27` |
| Staging | vacío (`git diff --cached` sin archivos) |
| Working tree | Cambios preexistentes (extension, stellar, patches, untracked harness/docs). **No** se tocaron fuera de `semanticValidator/` + este informe |
| Git mutaciones | Ninguna (`add`/`commit`/`reset`/`clean`/`checkout`/`restore` no ejecutados) |
| Backup / worktree aislado / `.vscode/mcp.json` | No modificados |

Estado del repositorio: coincide con el esperado (staging vacío; working tree sucio por trabajo previo). Documentado; no se intentó “limpiar” automáticamente.

---

## 2. Auditoría del contrato (consumidores)

### Campos auditados

| Campo / API | Rol |
|-------------|-----|
| `classification` | **Autoritativo** — alcance de lo verificado (`rejected` \| `surface_verified_with_opaque_remainder`) |
| `safetyClaim` | Siempre `not_full_protocol_safety`; ausencia ≠ garantía positiva |
| `bindingId` | Obligatorio en todo resultado de `validateSemanticConcordance` |
| `assertResultBoundTo` | Compara `bindingId` vs `computeBindingId(intent, evidence)` |
| `status` / `verifiable_complete` | Legacy; **no** condición de autorización |
| `AUTH_TX_MISMATCH` | Código de extract (2.20); rechazo cerrado si auth≠invoke |
| Rechazos | `classification/status: rejected` + `rejectionReasons` |

### Consumidores dentro del harness

| Ubicación | Uso de resultados |
|-----------|-------------------|
| `semanticValidator.test.ts` | Asserts directos + (2.21) `acceptSurfaceVerification` en happy path deposit |
| `semanticValidator.adversarial.binding.test.ts` | `assertResultBoundTo`, classification, safetyClaim |
| `semanticValidator.contract.test.ts` (**nuevo**) | Contrato 2.21 — únicos caminos de “aceptación” documentados |
| `contract.ts` | `parseValidationResult`, `acceptSurfaceVerification`, anti-patrones |
| Producción / signer / gate / IPC / UI | **Ningún** consumidor (módulo no re-exportado desde `src/`) |

### ¿`verifiable_complete` autoriza algo?

**No.** Ningún consumidor del harness lo usa como condición suficiente para firmar u operar. Las pruebas 2.21 demuestran que `acceptByLegacyStatusAlone` **siempre** falla, y que la única vía de aceptación de superficie es `acceptSurfaceVerification` (classification + safetyClaim + binding + re-validación en vivo), con `authorizesSigning: false` y `fullProtocolSafety: false`.

Riesgos buscados y mitigados:

- Comparación aislada `status === 'verifiable_complete'` → `acceptByLegacyStatusAlone` falla cerrado.
- Campos opcionales ausentes (`classification`, `safetyClaim`, `bindingId`) → `parseValidationResult` falla (ausencia ≠ pass).
- Superficie parcial tratada como total → `acceptAsFullProtocolSafety` siempre falla; `unverifiedFields` debe ser no vacío en éxito de superficie.
- Resultado de rechazo disfrazado / mutado → freeze + re-validación en vivo dentro de `acceptSurfaceVerification`.

---

## 3. Contrato anterior vs final

### Anterior (2.19 / 2.20)

- Éxito: `status: verifiable_complete` + `classification: surface_verified_with_opaque_remainder` + `safetyClaim: not_full_protocol_safety` + `bindingId`.
- Documentación ya advertía que `verifiable_complete` es engañoso, pero **no** había un helper de aceptación único ni parse fail-closed del objeto resultado.
- Un consumidor ingenuo podía escribir `if (result.status === 'verifiable_complete') …` sin mirar `classification` / `safetyClaim`.

### Final (2.21)

| Aspecto | Decisión |
|---------|----------|
| Campo autoritativo de alcance | `classification` |
| Seguridad completa del protocolo | Nunca afirmada; `safetyClaim` fijo + `acceptAsFullProtocolSafety` → fail |
| Éxito de superficie | Solo vía `acceptSurfaceVerification` |
| `verifiable_complete` | **Alias legacy deprecado**, no autoritativo; se **conserva** por compatibilidad con suites 2.19/2.20 |
| `bindingId` / `assertResultBoundTo` | Obligatorios; accept recomprueba binding + re-ejecuta `validateSemanticConcordance` |
| Resultados congelados | `Object.freeze` (incl. arrays anidados / `tokenTransfer`) |
| Campos ausentes | Fail cerrado en `parseValidationResult` |

### Decisión sobre el alias `verifiable_complete`

**Mantener como alias legacy deprecado** (no eliminar, no renombrar el string).

Motivos:

1. Eliminarlo rompería silenciosamente asserts existentes de 2.19/2.20 que documentan el hallazgo histórico del nombre engañoso.
2. Renombrarlo cambiaría el significado aparente de evidencia ya publicada en FASE-2.19/2.20.
3. Endurecer el **consumo** (helpers + tests adversariales) cierra el riesgo real sin reescribir historia.

Queda documentado en `types.ts`, `validate.ts`, `contract.ts` y `legacyVerifiableCompleteMeaning()`: `authoritative: false`, `authorizesSigning: false`, `fullProtocolSafety: false`, `aliasOf: surface_verified_with_opaque_remainder`.

---

## 4. Pruebas añadidas y resultados

Archivo: `semanticValidator.contract.test.ts`

| # | Caso | Resultado |
|---|------|-----------|
| 1 | Aceptar solo por `verifiable_complete` | `acceptByLegacyStatusAlone` → fail; accept correcto → ok con flags false |
| 2 | Sin `classification` | `parseValidationResult` / accept → fail |
| 3 | `safetyClaim` ausente o incorrecto | fail |
| 4 | Clasificación parcial inconsistente / opaque vacío | fail |
| 5 | `bindingId` de otra intención | fail |
| 6 | Mutación post-validación (freeze + clone inconsistente) | throw / parse fail |
| 7 | Rechazo presentado como éxito (forge) | live re-validation → fail |
| 8 | Estado desconocido / malformado / sin bindingId | fail |
| 9 | Deposit result vs withdraw intent (y viceversa) | fail cruzado; ok mismo op |
| 10 | Prototipo como prueba de seguridad completa | `acceptAsFullProtocolSafety` → fail |

Plus: rechazo con `bindingId` + freeze + accept falla.

**Vitest:**

```text
pnpm exec vitest run tests/stellar/spp/harness/semanticValidator/
Test Files  3 passed (3)
Tests       41 passed (41)
```

---

## 5. Limitaciones que permanecen

- No valida proof ZK, contenido de ciphertext, transfer-to-keys, ni planes multi-tx.
- No autoriza firma en producción; `authorizesSigning` es siempre `false`.
- No conecta `ApprovedIntent` / `IntentStore` al flujo de producción.
- `bindingId` identifica el par intent+evidence; la integridad del **outcome** ante forja se cubre con re-validación en `acceptSurfaceVerification`, no con un MAC criptográfico del resultado.
- Este endurecimiento **no** es evidencia de seguridad completa del protocolo SPP.

---

## 6. Archivos modificados / creados

Solo bajo harness `semanticValidator/` + este doc:

| Archivo | Cambio |
|---------|--------|
| `semanticValidator/contract.ts` | **Nuevo** — parse, accept, anti-patrones, re-validación |
| `semanticValidator/types.ts` | Docs de autoridad / deprecación |
| `semanticValidator/validate.ts` | Freeze profundo; comentarios 2.21 |
| `semanticValidator/binding.ts` | Comentario: binding ≠ signing grant |
| `semanticValidator/index.ts` | Re-exports de contrato |
| `semanticValidator/semanticValidator.contract.test.ts` | **Nuevo** — 10 casos + reject binding |
| `semanticValidator/semanticValidator.test.ts` | Assert freeze + `acceptSurfaceVerification` en deposit happy path |
| `browser/docs/FASE-2.21-RESULT-CONTRACT-HARDENING.md` | Este informe |

Sin cambios a manifests, lockfiles, signer, gate, `StateCoordinator`, IPC, UI, ni exports de producción.

---

## 7. Comandos ejecutados

```text
git rev-parse --show-toplevel
git rev-parse HEAD
git status --short
git diff --cached --stat
git diff --cached --name-only
pnpm exec vitest run tests/stellar/spp/harness/semanticValidator/
```

(Post-informe:) `git status --short` / `git diff --cached --name-only` para confirmar staging intacto.

---

## 8. Estado final de Git

| Ítem | Valor |
|------|--------|
| HEAD | `d872ac455f47ab8822aace0ba2f62e1574d6cf27` (sin commit) |
| Staging | **vacío** (intact) |
| Nuevos untracked / mods | Solo bajo `tests/stellar/spp/harness/semanticValidator/` y este `.md` (más working tree preexistente) |

---

## 9. Confirmaciones de seguridad operativa

- **Sin tráfico externo** (vitest offline; sin RPC).
- **Sin operaciones de firma** ni simulación/envío de transacciones.
- **Sin** integración a producción.
- Criterio de cierre: ningún consumidor del harness puede interpretar un resultado parcial como prueba de seguridad completa mediante comparación aislada con `verifiable_complete`. Limitaciones visibles; casos no soportados siguen fallando cerrados.
