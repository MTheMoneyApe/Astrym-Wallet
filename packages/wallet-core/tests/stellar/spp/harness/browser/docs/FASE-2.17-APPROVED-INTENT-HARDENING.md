# Fase 2.17 — Endurecimiento de ApprovedIntent offline

**Fecha:** 2026-10-26  
**HEAD (antes y después):** `d872ac455f47ab8822aace0ba2f62e1574d6cf27`  
**Staging:** vacío (antes y después)  
**Módulo:** `packages/wallet-core/tests/stellar/spp/harness/approvedIntent/`  
**Prior:** [FASE-2.16-APPROVED-INTENT-ADVERSARIAL-TESTS.md](./FASE-2.16-APPROVED-INTENT-ADVERSARIAL-TESTS.md)

Este informe **no** conecta `ApprovedIntent` al gate real ni declara autorización de pagos privados lista.

---

## 1. Estado de Git

| Momento | HEAD | Staging |
|---------|------|---------|
| Preflight | `d872ac455f47ab8822aace0ba2f62e1574d6cf27` | vacío |
| Cierre | `d872ac455f47ab8822aace0ba2f62e1574d6cf27` | vacío |

Sin `git add` / `commit` / `reset` / `clean` / `checkout` / `restore`.  
Sin cambios a producción, adapter, gate, StateCoordinator, manifests ni lockfiles.  
Cambios confinados al harness `approvedIntent/` + este documento.

---

## 2. Cambios concretos

| Archivo | Cambio |
|---------|--------|
| `stateMachine.ts` | Reescrito como `IntentStore` con celda autoritativa + `tryConsume` (check-and-set síncrono). Eliminada la API funcional que permitía dos `consume` desde el mismo snapshot. |
| `digestSecurity.ts` | `TrustedDigestFn`, `probeDigestFnNotConstant`, `assertTrustedDigestFn`, `wrapSha256AsTrusted`, `asDigestFn`. |
| `limits.ts` | `INTENT_LIMITS` documentados (ids, narrativas, arrays, fees). |
| `validate.ts` | Validación con límites; `assertAuthorizationId`; sin truncado silencioso de amount/dest/asset/digests. |
| `index.ts` | Barrel actualizado a `IntentStore` + límites + digest security. |
| `approvedIntent.stateMachine.test.ts` | Migrado a store; pruebas atómicas + límites. |
| `approvedIntent.adversarial.test.ts` | Casos 14–16 actualizados: concurrente = 1 éxito; constante rechazada; narrativas 100k rechazadas. Caso 7 permanece `LIMIT_ARCH`. |

---

## 3. A — Consumo concurrente (cerrado in-process)

### Modelo

- Estado autoritativo: `Map<intentId, IntentRecord>` dentro de un `IntentStore` compartido.
- Transición atómica: `transition()` / `tryConsume()` hacen read-modify-write síncrono sobre la celda (un solo hilo del event loop de JS ⇒ exclusión mutua natural en-proceso).
- Interfaz explícita: `tryConsume` → `{ ok: true, record } | { ok: false, error }`. Comparar dos snapshots inmutables **no** cuenta como consumo único.

### Garantías demostradas

| Escenario | Resultado |
|-----------|-----------|
| Dos `tryConsume` concurrentes (mismo store) | Exactamente un `ok: true` |
| Dos llamadas repetidas encadenadas | Segunda falla (`ALREADY_CONSUMED`) |
| Expiración + consume en el límite | Consume rechazado si `now >= expiresAtMs` |
| Cancelación + consume | Solo uno gana; el otro falla |

### Lo que **no** garantiza

- Replay entre procesos, pestañas, workers o reinicios.
- Persistencia durable de `authorizationId` / `intentId`.

**Integración futura:** el host necesitaría un store persistente con CAS (p. ej. IndexedDB/chrome.storage + lease, o un mutex de extensión) y el mismo contrato `tryConsume`. La atomicidad in-memory **no** sustituye eso.

---

## 4. B — Confianza del digest

### API

- `TrustedDigestFn`: `{ algorithm: 'sha256'; purpose: 'spp-approved-intent-v1'; digest(bytes) }`.
- `probeDigestFnNotConstant`: rechaza stubs constantes sobre un conjunto fijo de muestras.
- `assertTrustedDigestFn`: exige forma + algoritmo + purpose + probe.
- Create / approve / consume **requieren** `TrustedDigestFn` (error `DIGEST_UNTRUSTED` si falla).

### Qué garantiza `probeDigestFnNotConstant`

- Rechaza una función que produce el **mismo** hex para varias entradas distintas de prueba.
- Rechaza salidas no-hex / demasiado pocas muestras.

### Qué **no** garantiza

- Que la implementación sea SHA-256 real, libre de colisiones o no manipulada.
- Autenticidad de digests a través de un límite de confianza.
- Un tipo TypeScript **no** es garantía criptográfica.

El módulo permanece en **modo de prueba / harness**: no autentica la implementación en el trust boundary del host y **no** puede usarse para autorizar firmas reales. La integración debe inyectar un binding conocido (p. ej. `@noble/hashes` sha256) en el host — fuera de alcance 2.17.

No se añadió criptografía propia ni dependencias nuevas.

---

## 5. C — Límites de entrada (`INTENT_LIMITS`)

| Límite | Valor | Razón |
|--------|-------|-------|
| `intentIdMin` / `Max` | 8 / 128 | Id de wallet, no ensayo libre |
| `authorizationIdMin` / `Max` | 8 / 128 | Idem |
| `networkPassphraseMax` | 256 | Passphrases Stellar son cortas |
| `narrativeStringMax` | 2048 | DoS/memoria en UI bullets |
| `maxPublicEffects` / `maxPrivacyLimits` | 32 | Cap de listas |
| `maxFees` | 8 | Cap de líneas de fee |
| `feeNoteMax` | 2048 | Nota narrativa |
| `maxUnknownCritical` / reason | 16 / 512 | Cap de marcadores |
| `assetSymbolMax` / `assetCodeMax` | 32 / 12 | Campos display |

- Rechazo **antes** de procesamiento semántico profundo (en `validateApprovedIntentStructure`).
- Arrays, anidados e ids validados.
- **Sin** truncado silencioso de amount, destination, asset ni digests (fail-closed).
- Pruebas: exacto, max+1, vacías, Unicode (`.length` UTF-16 de JS documentado).

---

## 6. D — Brecha plan ↔ XDR (abierta)

### Investigación (sin parser improvisado)

Dependencias ya disponibles:

- `@stellar/stellar-sdk` (^17.3): `Transaction` / `FeeBumpTransaction.fromXDR`, `xdr.*`, `Operation`, `Address`, `nativeToScVal` / ScVal helpers.
- `stellar-private-payments` 0.2.1: API de firma; no expone un decoder semántico SPP del envelope firmado.
- Adapter de producción (`SppWalletSignerAdapter`): parsea XDR para red + source + firma; **documenta explícitamente** que no inspecciona ops, amounts, destinos ni árboles Soroban.

### Qué se puede extraer del XDR con herramientas existentes

| Campo | Fiable con SDK | Notas |
|-------|----------------|-------|
| Network passphrase (vía envelope firmado + hash) | Parcial | El adapter fija passphrase; no “lee” la semántica SPP |
| Source account | Sí | `Transaction.source` |
| Fee / seq / timebounds | Sí | Campos de envelope |
| Tipo de operación de alto nivel | Sí | p. ej. `invokeHostFunction` vs `payment` |
| Contract id + símbolo de función (ScVal symbol) | Parcial | Si el invoke es plano y args son ScVal legibles |
| Args numéricos / Address | Parcial | Depende del encoding ScVal y del ABI del contrato |

### Semántica SPP **no** representada directamente en el XDR

- Importe “lógico” del plan (stroops de depósito/retiro/transfer) vs commitments / notes cifrados.
- Destino `privacy_keys` (note PK / encryption PK) — no aparece como G-address clásico.
- Narrativas `publicEffects` / `privacyLimits`.
- Distinción deposit / private_transfer / withdraw cuando el invoke es un árbol Soroban opaco o usa args que no son enteros en claro.
- Concordancia plan ↔ bytes solo vía digests opacos **no** cierra esta brecha.

### Información que requiere el plan del SDK / host

Para cerrar la brecha de forma verificable haría falta, como mínimo:

1. Un **plan de simulación** post-`simulateTransaction` (o equivalente SPP) que materialice amount/dest/op.
2. Un extractor determinista del envelope/auth preimage que reconstruya los mismos campos.
3. Comparación campo a campo + rechazo si algún crítico queda `unknownCritical`.

Eso **amplía el alcance** más allá del modelo offline 2.17 (depende de RPC/sim, ABI SPP, y posiblemente del SDK privado).

### Qué rechazar si no se puede reconstruir el significado

Hasta que exista esa capa:

- Cualquier approve/consume con `unknownCritical.length > 0` (ya enforced).
- **No** afirmar que `planDigest` + `operationDigest` prueban semántica.
- En integración futura: rechazar ops cuyo árbol Soroban no se pueda mapear a `(op, amount, asset, destination)`.

### Estado

**Brecha abierta (`LIMIT_ARCH`).** Caso adversarial #7 sigue aceptando plan deposit + bytes opacos auto-consistentes. Digests opacos **no** solucionan la discrepancia.

---

## 7. E — Resultados de pruebas

```text
pnpm exec vitest run tests/stellar/spp/harness/approvedIntent/
→ Test Files  2 passed (2)
→ Tests       54 passed (54)
```

Incluye suite 2.15 migrada + adversariales 2.16 endurecidas + atómicas/límites 2.17.

La prueba #14 **falla** si dos consumidores consumen la misma aprobación (assert `okCount === 1`).  
No se debilitaron expectativas para ocultar brechas; el único `LIMIT_ARCH` restante (#7 plan↔XDR) permanece documentado como aceptación consciente.

Sin firmas válidas, sin ops privadas, sin red, sin tocar el signer real.

---

## 8. Garantías demostradas vs riesgos pendientes

### Cerrado honestamente (offline / in-process)

1. Consumo single-success bajo store compartido.
2. Rechazo de `TrustedDigestFn` constante / forma incorrecta.
3. Límites de entrada narrativos e ids (fail-closed).
4. Mutación post-approve / digest drift / expiry / terminales (heredado 2.15–2.16).

### Bloqueado / abierto

| Riesgo | Estado |
|--------|--------|
| Plan ↔ semántica XDR/Soroban/SPP | **Abierto** |
| Binding criptográfico real del digest en trust boundary | **Bloqueado** (modo prueba) |
| Single-use cross-process / post-restart | **Bloqueado** (requiere store persistente) |
| Records fabricables fuera del store | Persistente (honest-caller harness) |
| Cableado a `ContextualSignatureGate` / pagos privados | **Fuera de alcance — no hecho** |

---

## 9. Criterio de aceptación

| Requisito | Estado |
|-----------|--------|
| Brechas resolubles offline cerradas con pruebas | Sí (A, B, C) |
| Brechas que requieren integración dejadas explícitas | Sí (D + cross-process) |
| Sin conexión a gate / claim de pagos privados | Sí |
| Staging vacío; HEAD intacto | Sí |
