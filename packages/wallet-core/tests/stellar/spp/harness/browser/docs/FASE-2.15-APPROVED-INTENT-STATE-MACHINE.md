# Fase 2.15 — ApprovedIntent y state machine offline

**Fecha:** 2026-10-26  
**HEAD (antes y después):** `d872ac455f47ab8822aace0ba2f62e1574d6cf27`  
**Staging:** vacío  
**Alcance:** modelo offline de intención + máquina de estados en harness/tests — **sin** integración producción, **sin** gate real, **sin** firmas/ops privadas

**Aviso:** este módulo es un **modelo de aprobación simulado**. No autoriza firmas reales ni sustituye `ContextualSignatureGate` / `SppWalletSignerAdapter`.

---

## 1. Estado de Git

| Momento | HEAD | Staging |
|---------|------|---------|
| Preflight | `d872ac4…` | vacío |
| Cierre | `d872ac4…` | vacío |

Cambios preexistentes preservados. Solo se añaden archivos untracked bajo `tests/stellar/spp/harness/`.

---

## 2. Archivos añadidos

| Archivo | Rol |
|---------|-----|
| `tests/stellar/spp/harness/approvedIntent/types.ts` | Tipos discriminados + errores |
| `tests/stellar/spp/harness/approvedIntent/amount.ts` | Validación de importes sin float |
| `tests/stellar/spp/harness/approvedIntent/planDigest.ts` | Encoding length-prefixed + digests inyectables |
| `tests/stellar/spp/harness/approvedIntent/validate.ts` | Validación estructural / concordancia |
| `tests/stellar/spp/harness/approvedIntent/stateMachine.ts` | Transiciones puras + registry de intentId |
| `tests/stellar/spp/harness/approvedIntent/index.ts` | Barrel **solo harness** |
| `tests/stellar/spp/harness/approvedIntent/approvedIntent.stateMachine.test.ts` | Pruebas Vitest offline |
| `tests/stellar/spp/harness/browser/docs/FASE-2.15-APPROVED-INTENT-STATE-MACHINE.md` | Este informe |

**No modificados:** `SppWalletSignerAdapter`, `signatureGate`, `StateCoordinator`, `src/index.ts`, manifests, lockfiles.

---

## 3. Modelo de datos

`ApprovedIntent` (`schemaVersion: 1`) incluye:

- `intentId` (host/wallet, no dApp)
- `op`: `deposit` | `private_transfer` | `withdraw`
- `account` (G…), `networkPassphrase`, `poolContractId` (C…)
- `asset`, `amount.units` (enteros string) + `decimals`
- `destination` discriminado por op
- `fees[]` con `certainty`: `confirmed` | `estimated` | `unknown`
- `publicEffects[]`, `privacyLimits[]`
- `digests.planDigestHex` + `digests.operationDigestHex` (64 hex)
- `createdAtMs` / `expiresAtMs`
- `unknownCritical[]` — si no vacío, **no** se puede aprobar

---

## 4. Reglas de validación

- Importes: solo strings enteros no negativos (`^(0|[1-9][0-9]*)$`), máx. 39 dígitos; **sin** `Number` float.
- Destino: deposit → `none`; transfer → `g_address` | `privacy_keys`; withdraw → `self` | `g_address`.
- Fees desconocidos sin `units`; confirmed/estimated exigen units enteros.
- Digests: hex minúscula 64 chars.
- `unknownCritical` no vacío → rechazo en `approveIntent`.
- Concordancia: recomputar plan digest desde campos; operation digest desde bytes presentados.

---

## 5. Transiciones permitidas

```text
created → prepared | cancelled | failed | expired
prepared → awaiting_approval | cancelled | failed | expired
awaiting_approval → approved | rejected | cancelled | failed | expired
approved → consumed | cancelled | failed | expired
consumed | rejected | expired | cancelled | failed → ∅
```

Reloj inyectado (`Clock`). Caducado no aprueba ni consume. `authorizationId` de un solo uso. Cambio de bytes/fingerprint tras approve → `DIGEST_MISMATCH` / `INTENT_MUTATED`. Registry en memoria impide reutilizar `intentId` en el mismo proceso.

**Limitación documentada:** el control offline **no** evita repetición entre procesos/reinicios; la integración futura necesitará coordinación persistente.

---

## 6. Estrategia de digest

- **No** `JSON.stringify` como canonicalización criptográfica del plan.
- Plan: encoding length-prefixed (`planDigest.ts`) → `DigestFn` inyectada.
- Operación/XDR: digest de bytes presentados vía la misma `DigestFn`.
- En tests: `@noble/hashes` sha256 (ya dependencia del paquete).
- El digest **no** prueba seguridad semántica; la validación estructural precede a approve.

---

## 7. Pruebas y resultados

```text
pnpm exec vitest run tests/stellar/spp/harness/approvedIntent/approvedIntent.stateMachine.test.ts
→ 1 file, 24 tests passed
```

Cubierto: tres ops; campos ausentes; importe inválido; cuenta/red; discrepancia digests; drift post-approve; caducidad pre/post; consumo único; cancel/reject; transiciones imposibles; reuso intentId; mutación externa; unknownCritical; fees estimated/confirmed/unknown; freeze.

---

## 8. Limitaciones

- Sin parseo semántico real de XDR Soroban (solo digest de bytes).
- Sin TTL en el gate real (solo `expiresAtMs` del intent offline).
- Sin persistencia cross-process.
- Sin UI / broker / Client / RPC / Nym.
- No es autorización de firma.

---

## 9. Riesgos que quedan para integración

- Cablear `approveIntent` → `ContextualSignatureGate.approve` sin TOCTOU.
- Extraer amount/dest fiables del XDR post-sim.
- Registry persistente de intentId/authorizationId.
- Host MV3 estable (offscreen) — Fase 2.14.

---

## 10. Criterio de aceptación

| Requisito | Estado |
|-----------|--------|
| Modelo + SM offline | Cumple |
| Pruebas de abuso principales | 24 passed |
| Sin ops/firmas reales / sin gate | Cumple |
| Staging vacío / sin prod exports | Cumple |
