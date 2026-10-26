# Fase 2.20 — Auditoría adversarial de Semantic Validator

**Fecha:** 2026-10-26  
**HEAD (antes y después):** `d872ac455f47ab8822aace0ba2f62e1574d6cf27`  
**Staging:** vacío (antes y después)  
**Módulo:** `packages/wallet-core/tests/stellar/spp/harness/semanticValidator/`  
**Priors:** FASE-2.18, FASE-2.19  

**Alcance:** auditoría + endurecimiento harness only. **Sin** integrar signer, gate, IPC ni UI.

---

## 1. Estado de Git

| Momento | HEAD | Staging |
|---------|------|---------|
| Preflight | `d872ac4…` | vacío |
| Cierre | `d872ac4…` | vacío |

Working tree con cambios preexistentes (extension, stellar, etc.). Sin `git add`/`commit`/`reset`/`clean`/`checkout`/`restore`. Sin tráfico externo ni firmas.

---

## 2. Hallazgo principal (falso positivo)

### Antes (2.19)

`transactionXdr` y `authEntryXdrs` se aceptaban **por separado**. El extractor leía ExtData del TX y el árbol auth del entry, pero **no** exigía que los args del auth root (`proof`, `ext_data`, `sender`) fueran XDR-idénticos a los del invoke.

**Ataque representable:** dos depósitos sintéticos con el mismo `amount` / pool / sender pero distinto ciphertext ExtData (o distinto proof). TX de A + auth de B → `verifiable_complete` (**falso positivo**).

Evidencia: reproducido en prueba 2.20 §3 caso 1; tras el endurecimiento → `rejected` / `AUTH_TX_MISMATCH`.

### Después (2.20 harden)

En `extract.ts`:

1. Comparación byte-a-byte (`ScVal.toXDR('base64')`) de cada arg auth root ↔ invoke.  
2. Auth root contract/function debe coincidir con el invoke.  
3. Si hay `token.transfer`, su amount debe igualar `ExtData.ext_amount` del **mismo** TX.  
4. Keys ExtData duplicadas → `BAD_EXT_DATA`.  
5. `authBoundToInvoke: true` en hechos extraídos; campo verificado `authTxBinding`.

---

## 3. Vinculación entre componentes

| Componente | ¿Derivado del XDR validado? | ¿Suministrable por separado? | ¿Vinculado ahora? |
|------------|----------------------------|------------------------------|-------------------|
| Intent esperado | No (caller) | Sí | Comparado campo a campo; `bindingId` amarra intent+evidence |
| Transaction XDR | Sí | Sí (entrada) | Fuente de ExtData / sender / pool |
| ExtData | Del arg[1] del invoke | Podría fabricarse en auth distinto | **Bound** a auth arg[1] vía XDR equality |
| Auth tree | De `authEntryXdrs[0]` | Sí (entrada separada) | **Bound** a invoke args |
| Cuenta origen | `tx.source` + sender arg | — | Ambos vs intent |
| Network | Passphrase de parse + equality intent/evidence | Passphrase en evidence es caller-supplied | Parse falla si XDR≠passphrase; mismatch intent→reject |
| Destinatario (withdraw) | ExtData.recipient | — | Vs intent |
| Proof / ciphertext | Presentes | Alterables | **Unverified** semánticamente; si auth/TX proof difieren → mismatch de binding |

**Conclusión:** tras 2.20, TX y auth deben ser la misma invocación. El intent sigue siendo un objeto caller-side; `bindingId` + `assertResultBoundTo` evitan reutilizar un resultado OK para otro intent/evidence.

---

## 4. Semántica de resultados

| Valor | Cuándo |
|-------|--------|
| `status: rejected` + `classification: rejected` | Fallo / bloqueo / mismatch / unusable evidence |
| `status: verifiable_complete` + `classification: surface_verified_with_opaque_remainder` | Superficie 2.19/2.20 OK **y** auth↔tx bound; proof/ciphertext en `unverifiedFields` |
| `safetyClaim: not_full_protocol_safety` | **Siempre** (éxito y rechazo) |
| `claimFullOperationSafety: true` | Siempre `rejected` |

**Advertencia de contrato:** el nombre `verifiable_complete` es **engañoso** si se lee como seguridad total. Los consumidores **deben** usar `classification` + `safetyClaim`. No se eliminó el status legacy para no ocultar la auditoría; se documentó y se añadió clasificación precisa.

`proof` y `encrypted_output*` permanecen explícitamente sin verificar en el camino de éxito.

---

## 5. Casos adversariales (pruebas)

Archivo nuevo: `semanticValidator.adversarial.binding.test.ts` (+ asserts en suite 2.19).

| # | Caso | Resultado |
|---|------|-----------|
| 1 | ExtData/auth de otro depósito (mismo amount) | `rejected` AUTH_TX_MISMATCH |
| 2 | Proof distinto en auth vs TX | `rejected` |
| 3 | Auth withdraw + TX deposit | `rejected` |
| 4 | Destinatario intent ≠ ExtData | `rejected` |
| 5 | Fee-bump wrapper | `rejected` FEE_BUMP |
| 6 | Args de contrato ≠ 3 | `rejected` BAD_ARGS |
| 7 | Keys ExtData duplicadas | `rejected` |
| 8 | Apariencia OK, binding incompleto (cross-pair recipient) | `rejected` |
| 9 | Promover a seguridad completa | `rejected` / classification surface-only en éxito |
| 10 | Ciphertext alterado en auth | `rejected` binding |
| 11 | Reutilizar resultado en otra intent/evidence | `assertResultBoundTo` → ok:false |
| 12 | Happy path bound | `authBoundToInvoke`, `bindingId`, classification |

También cubiertos en 2.19: red/cuenta, ops extra, malformado, transfer-to-keys, multi-tx.

### BLOCKED / no fabricado

| Caso | Motivo |
|------|--------|
| Fee-bump *alrededor de* invokeHostFunction SPP real | `buildFeeBumpTransaction` falla encode functionName en sdk 17.3 con este shape; se prueba FEE_BUMP con inner payment |
| Auth entries embebidos solo en op.auth del envelope (sin array separado) | API del prototipo toma `authEntryXdrs` estilo SPP `PreparedSorobanTx`; path embebido no modelado |
| Semántica del proof ZK | Sin API verificable offline |

---

## 6. Qué garantiza / no garantiza `verifiable_complete`

### Garantiza (superficie)

- Intent deposit/withdraw single-tx vs ExtData+auth **de la misma** invocación.  
- Pool `transact`, sender/source, amount sign/magnitude, auth tree deposit/withdraw shape.  
- Auth root args ≡ invoke args (XDR).  
- Resultado no portable sin `bindingId` match.

### No garantiza

- Seguridad completa del protocolo / ZK / ciphertext.  
- Multi-tx plans / transfer-to-keys.  
- Que el evidence sea una respuesta auténtica del SDK SPP (fixtures sintéticas).  
- Integración con gate/signer.

---

## 7. Archivos modificados / añadidos

| Archivo | Cambio |
|---------|--------|
| `extract.ts` | AUTH_TX_MISMATCH, duplicate keys, auth↔tx bind |
| `validate.ts` | `classification`, `safetyClaim`, `authTxBinding`, `bindingId` |
| `types.ts` | Nuevos campos de resultado / `authBoundToInvoke` |
| `binding.ts` | **Nuevo** — `computeBindingId`, `assertResultBoundTo` |
| `index.ts` | Exports |
| `semanticValidator.test.ts` | Expect classification + authTxBinding |
| `semanticValidator.adversarial.binding.test.ts` | **Nuevo** — 13 casos 2.20 |
| `FASE-2.20-ADVERSARIAL-VALIDATOR-AUDIT.md` | Este informe |

Producción / manifests / lockfiles: **no** tocados en esta fase.

---

## 8. Comandos y resultados

```text
cd packages/wallet-core
pnpm exec vitest run tests/stellar/spp/harness/semanticValidator/
→ Test Files  2 passed (2)
→ Tests       30 passed (30)
```

Sin red, sin firmas, sin simulate/submit reales.

---

## 9. Criterio de cierre

| Requisito | Estado |
|-----------|--------|
| Casos adversariales representables con resultados reproducibles | Sí |
| Falso positivo cross-pair cerrado con prueba | Sí |
| Casos no verificables explícitamente BLOCKED/documentados | Sí |
| No presentar limitaciones SDK como garantías | Sí |
| Staging vacío; sin integración producción | Sí |
