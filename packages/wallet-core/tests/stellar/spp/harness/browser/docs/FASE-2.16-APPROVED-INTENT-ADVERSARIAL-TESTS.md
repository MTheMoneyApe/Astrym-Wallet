# Fase 2.16 — Pruebas adversariales de ApprovedIntent

**Fecha:** 2026-10-26  
**HEAD (antes y después):** `d872ac455f47ab8822aace0ba2f62e1574d6cf27`  
**Staging:** vacío  
**Módulo:** `packages/wallet-core/tests/stellar/spp/harness/approvedIntent/`  
**Prior:** FASE-2.15

**Clasificación de hallazgos**

| Código | Significado |
|--------|-------------|
| `REJECT_OK` | Ataque / abuso rechazado correctamente |
| `ACCEPT_OK` | Comportamiento válido aceptado |
| `GAP` | Brecha de seguridad del modelo offline confirmada por prueba |
| `LIMIT_ARCH` | Límite arquitectónico explícito (no es bug de transición; falta capacidad) |

Este informe **no** conecta el modelo al gate real ni declara autorización de pagos privados lista.

---

## 1. Estado de Git

| Momento | HEAD | Staging |
|---------|------|---------|
| Preflight | `d872ac4…` | vacío |
| Cierre | `d872ac4…` | vacío |

Sin `git add`/`commit`/`reset`/`clean`/`checkout`/`restore`. Producción / adapter / gate / StateCoordinator / manifests / lockfiles no modificados.

---

## 2. Código inspeccionado (auditoría)

| Archivo | Hallazgos relevantes |
|---------|----------------------|
| `validate.ts` | Validación estructural; `assertPlanDigestConcordance` recomputa plan; operation digest = hash(bytes) vs claim; `freezeIntent`; fingerprint incluye amount/account/network/dest/asset/digests |
| `planDigest.ts` | Encoding length-prefixed (u32be + UTF-8); evita colisión de concatenación ingenua entre campos consecutivos; **no** es MAC |
| `stateMachine.ts` | Estado autoritativo = `IntentRecord.status` + intent congelado; expiración `now >= expiresAtMs`; consume one-shot **si** se encadena el record retornado; API pura sin lock |
| `types.ts` | `DigestFn` sin marca de algoritmo/confianza |
| `amount.ts` | Enteros string; rechazo float / leading zeros / >39 dígitos |

### Garantías vs no-garantías

| Garantía offline | ¿Sí? |
|------------------|------|
| Transiciones ilegales rechazadas | Sí |
| Intent congelado en record | Sí (Object.freeze anidado) |
| Plan fields ↔ `planDigestHex` vía DigestFn | Sí (recompute) |
| Operation bytes ↔ `operationDigestHex` | Sí (recompute) |
| Comparación semántica plan ↔ contenido XDR | **No** — solo digests opacos |
| DigestFn criptográficamente seguro | **No** — delegado al llamador |
| Single-use bajo consumo concurrente del mismo snapshot | **No** |
| Límites max de strings narrativos | **No** |
| Persistencia cross-process de intentId | **No** |

---

## 3. Pruebas añadidas

| Archivo | Rol |
|---------|-----|
| `approvedIntent.adversarial.test.ts` | Casos 1–16 adversariales |
| `digestSecurity.ts` | Propuesta `TrustedDigestFn` + `probeDigestFnNotConstant` (sin conectar signer) |

También: exports en `index.ts` del harness.

---

## 4. Resultados por caso

```text
pnpm exec vitest run tests/stellar/spp/harness/approvedIntent/
→ 2 files, 44 tests passed (24 de 2.15 + 20 adversariales)
```

| # | Caso | Resultado | Clase |
|---|------|-----------|-------|
| 1 | Cambiar importe post-approve | Rechazo (`presentedIntent`) | `REJECT_OK` |
| 2 | Cambiar activo post-approve | Rechazo | `REJECT_OK` |
| 3 | Cambiar destino post-approve | Rechazo | `REJECT_OK` |
| 4 | Cambiar cuenta / red post-approve | Rechazo | `REJECT_OK` |
| 5 | Cambiar digest del plan | Rechazo | `REJECT_OK` |
| 6 | Cambiar digest/bytes XDR | Rechazo | `REJECT_OK` |
| 7 | Plan semántico incompatible con “XDR” (bytes opacos) | **Acepta** createIntent | `LIMIT_ARCH` / `GAP` |
| 8 | Omitir publicEffects/privacyLimits | Rechazo estructural | `REJECT_OK` |
| 9 | Precisión / límites de importe | Rechazo | `REJECT_OK` |
| 10 | Mutar objetos tras freeze | Throw en asignación | `REJECT_OK` |
| 11 | Reutilizar aprobación (2º consume encadenado) | Rechazo | `REJECT_OK` |
| 12 | Repetir transiciones terminales | Rechazo | `REJECT_OK` |
| 13 | Consumo en `expiresAtMs` exacto | Rechazo; `expiresAtMs-1` OK | `REJECT_OK` / `ACCEPT_OK` |
| 14 | Dos consumos concurrentes mismo snapshot | **Ambos succeed** | `GAP` |
| 15 | DigestFn constante | Probe falla; SM **acepta** y trata bytes distintos como iguales | `GAP` |
| 15b | sha256 + `TrustedDigestFn` sketch | Probe OK; wrapper tipado | `ACCEPT_OK` (propuesta) |
| 16 | intentId corto / network vacía | Rechazo | `REJECT_OK` |
| 16 | Strings narrativos 100k chars | **Acepta** estructuralmente | `GAP` |
| 16b | Length-prefix boundaries `ab|c` vs `a|bc` | Encodings distintos | `ACCEPT_OK` |

Las pruebas que demuestran `GAP` / `LIMIT_ARCH` **pasan en verde a propósito** cuando documentan aceptación insegura o límite: no se debilitaron asserts de rechazo para “hacer verde” un ataque que debería fallar.

---

## 5. Brechas confirmadas

1. **Sin verificación semántica XDR** (`LIMIT_ARCH`/`GAP`): el modelo no parsea Soroban; solo exige autocoherencia digest(plan) y digest(bytes). Un plan “deposit” puede acompañar bytes de otra operación.
2. **`DigestFn` no tipada como confiable** (`GAP`): una función constante rompe la separación plan/bytes; `createIntent` no ejecuta `probeDigestFnNotConstant`.
3. **Consume no es single-use bajo concurrencia de snapshot** (`GAP`): dos llamadas con el mismo `IntentRecord` approved producen dos `consumed`.
4. **Sin max-length en textos** (`GAP`): `fees.note` / `publicEffects` / `privacyLimits` admiten 100k+ caracteres.
5. **Records fabricables** (inferido): no hay sello criptográfico del `IntentRecord`; un llamador malicioso puede construir un record “approved” a mano — fuera del modelo honest-caller de unit tests.

---

## 6. Limitaciones del modelo (reafirmadas)

- Offline / harness only; no es autorización de firma.
- Length-prefixing ≠ integridad criptográfica.
- Digest suministrado/recomputado con DigestFn arbitraria ≠ autenticidad.
- Sin coordinación persistente entre procesos (Fase 2.15).

---

## 7. Recomendaciones antes de integración real

1. **Exigir `TrustedDigestFn`** (`algorithm: 'sha256'`, purpose fijado) en cualquier path que llame `gate.approve` / signer; rechazar `DigestFn` desnuda en producción.  
2. **Añadir capa semántica XDR↔plan** (parse post-sim) o marcar `unknownCritical` hasta que exista.  
3. **Single-flight consume**: mutex / atomizar `authorizationId` en store del host (no solo threading funcional).  
4. **Max lengths** para strings narrativos e `intentId`.  
5. **No** tratar el modelo 2.15/2.16 como listo para pagos privados.

Propuesta tipada ya en harness: `digestSecurity.ts` (`TrustedDigestFn`, `probeDigestFnNotConstant`, `wrapSha256AsTrusted`) — **no** cableada al state machine ni al adapter.

---

## 8. Criterio de aceptación

| Requisito | Estado |
|-----------|--------|
| Evidencia reproducible de límites | Sí (§4–5) |
| Brechas clasificadas sin falsear asserts | Sí |
| Sin conexión a gate / ops reales | Sí |
| Staging vacío | Sí |
