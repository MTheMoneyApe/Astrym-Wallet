# Fase 2.19 — Prototipo offline de validación semántica parcial SPP

**Fecha:** 2026-10-26  
**HEAD (antes y después):** `d872ac455f47ab8822aace0ba2f62e1574d6cf27`  
**Staging:** vacío (antes y después)  
**SDK:** `stellar-private-payments@0.2.1` · commit `b79107cd24327198f8eb2dbaf4bdc65a8a1e8cf1`  
**Prior:** [FASE-2.18-PLAN-XDR-SEMANTIC-BOUNDARY.md](./FASE-2.18-PLAN-XDR-SEMANTIC-BOUNDARY.md)

**Alcance:** harness only — **no** conexión a `SppWalletSignerAdapter`, `ContextualSignatureGate`, `IntentStore`, IPC, UI ni exports de producción.

---

## 1. Estado de Git

| Momento | HEAD | Staging |
|---------|------|---------|
| Preflight | `d872ac4…` | vacío |
| Cierre | `d872ac4…` | vacío |

Snapshot Fase 2.4: presente; `tx_prepare.rs` / `soroban_encode.rs` re-hash OK (`1A9F5C27…` / `0D561D57…`). Sin `git add`/`commit`/`reset`/`clean`/`checkout`/`restore`. Sin tráfico externo ni firmas.

---

## 2. Archivos añadidos

| Ruta | Rol |
|------|-----|
| `tests/stellar/spp/harness/semanticValidator/types.ts` | Intent esperado, evidencia, resultado estructurado |
| `tests/stellar/spp/harness/semanticValidator/extract.ts` | Extracción vía `@stellar/stellar-sdk` Transaction + auth entry |
| `tests/stellar/spp/harness/semanticValidator/validate.ts` | Concordancia deposit/withdraw + bloqueos |
| `tests/stellar/spp/harness/semanticValidator/fixtures.ts` | Envelopes **sintéticos** (no respuestas SPP reales) |
| `tests/stellar/spp/harness/semanticValidator/index.ts` | Barrel harness |
| `tests/stellar/spp/harness/semanticValidator/semanticValidator.test.ts` | Pruebas adversariales offline |
| `…/docs/FASE-2.19-PARTIAL-SEMANTIC-VALIDATOR.md` | Este informe |

---

## 3. Fuentes y estructuras verificadas

| Fuente | Uso |
|--------|-----|
| `soroban_encode.rs` `pool_ext_data_to_scval` @ `b79107cd` | Keys ExtData: `encrypted_output0`, `encrypted_output1`, `ext_amount` (i256), `recipient` |
| `tx_prepare.rs` `prepare_pool_transact` / `check_transact_auth` | Args invoke `[proof, ext, sender]`; fn `transact`; deposit → 1 sub `token.transfer(sender,pool,amount)`; withdraw/transfer → 0 subs |
| `@stellar/stellar-sdk` ^17.3 | `TransactionBuilder` / `Operation.invokeContractFunction` / `xdr.SorobanAuthorizationEntry` / `nativeToScVal` / `scValToNative` / `StrKey` |
| FASE-2.18 matriz | VERIFIED/PARTIAL extractable vs BLOCKED |

No se inventaron nombres de campos ni parsers XDR artesanales.

---

## 4. Campos que **sí** se validan

### Deposit (`op: deposit`, `planTxCount === 1`)

| Campo | Cómo |
|-------|------|
| Network passphrase | Parse del envelope bajo passphrase esperada + igualdad intent/evidence |
| `tx.source` / invoke `sender` | == `expected.account` |
| Pool contract + fn `transact` | Invoke + auth root |
| `ext_amount` | `> 0` y `=== amountUnits` |
| Auth tree | Exactamente 1 sub = `token.transfer(from=account, to=pool, amount=amountUnits)` |
| `tokenContractId` | De auth sub |

### Withdraw (`op: withdraw`, `planTxCount === 1`)

| Campo | Cómo |
|-------|------|
| Igual binding red/cuenta/pool/`transact` | Como deposit |
| `ext_amount` | `< 0` y `\|ext_amount\| === amountUnits` |
| Auth tree | 0 sub-invocations |
| `ExtData.recipient` | == `self`→account o `g_address` |

### Resultado de éxito

`status: verifiable_complete` = **completo solo respecto a la superficie verificable 2.19**.  
Siempre lista `unverifiedFields` (`proof`, `encrypted_output*`, `opaqueDigest`).  
El resumen niega explícitamente “full private-payment safety”.

`claimFullOperationSafety: true` → **rejected** (no promover parcial a completo).

---

## 5. Campos / modos que **siguen sin verificarse** (BLOCKED / unverified)

| Ítem | Clasificación |
|------|----------------|
| `private_transfer` / `transfer_to_keys` / `privacy_keys` | **BLOCKED** — reject |
| `planTxCount !== 1` (multi-tx) | **BLOCKED** — reject |
| Contenido ZK proof | **unverified** |
| Ciphertext `encrypted_output*` | **unverified** |
| Digests opacos como prueba semántica | **rechazados** (no usados) |
| Asset decimals / symbol UI | No comprobados desde XDR |
| Fees / efectos narrativos | No |
| Integración gate / signer / IntentStore | **No cableada** |

---

## 6. Casos adversariales y resultados

| Caso | Resultado |
|------|----------|
| Deposit / withdraw happy path | `verifiable_complete` + unverified opacos |
| Recipient withdraw distinto | `rejected` |
| Cuenta origen distinta | `rejected` |
| Network mismatch | `rejected` |
| Amount mismatch | `rejected` |
| ExtData sin `recipient` | `rejected` (BAD_EXT_DATA) |
| XDR malformado | `rejected` |
| Envelope con 2 ops | `rejected` (BAD_OP_COUNT) |
| Deposit sin `token.transfer` auth | `rejected` |
| transfer-to-keys / private_transfer | `rejected` + `blocked` |
| privacy_keys destination | `rejected` |
| planTxCount=2 | `rejected` |
| claimFullOperationSafety | `rejected` |
| 2 auth entries | `rejected` |

---

## 7. Comandos y resultados

```text
cd packages/wallet-core
pnpm exec vitest run tests/stellar/spp/harness/semanticValidator/
→ Test Files  1 passed (1)
→ Tests       17 passed (17)
```

Sin Horizon/RPC/Friendbot/bootnodes. Sin firmas ni simulate/submit reales. Fixtures etiquetadas como sintéticas.

---

## 8. Condiciones antes de integrar con el gate real

1. Host debe materializar `OperationEvidence` **post-simulate / pre-sign** (hoy `PrivatePool.deposit` no expone plan/XDR al JS — FASE-2.18).  
2. Revalidar auth tree en el host (no confiar solo en `check_transact_auth` del SDK).  
3. Una `ApprovedIntent` / lease **por tx** del plan; multi-tx sigue BLOCKED aquí.  
4. Transfer-to-keys: requiere API de plan o `unknownCritical` permanente.  
5. Nunca mapear `verifiable_complete` → “pago privado autorizado”.  
6. Persistir single-use de approvals (2.17) cross-process.  
7. Cablear UI → `ContextualSignatureGate.approve` con digests **y** resultado de este validador.

---

## 9. Criterio de cierre

| Requisito | Estado |
|-----------|--------|
| Distingue complete (verifiable) / partial claim refusal / reject | Sí |
| Unsupported fail-closed | Sí |
| Producción intacta / no cableada | Sí |
| Staging vacío | Sí |
