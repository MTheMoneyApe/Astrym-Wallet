# Fase 2.12 — Validación de lectura de contratos del pool mediante `allContractsData()`

**Fecha:** 2026-10-26  
**Repositorio:** `C:\Users\M\Downloads\Stellar privacy project`  
**Branch / HEAD:** `master` / `d872ac455f47ab8822aace0ba2f62e1574d6cf27`  
**Staging:** vacío (confirmado al cierre)  
**Upstream SPP:** `stellar-private-payments@0.2.1` ↔ commit `b79107cd24327198f8eb2dbaf4bdc65a8a1e8cf1`  
**Prior:** Fases 2.8–2.11 (`aspState` demostrado; tip vía sync bloqueado)

## Veredicto

`Client.allContractsData()` es una ruta de **solo lectura** (`getLedgerEntries` únicamente). Con un fixture sintético de pool (`Admin` + `State` + claves de instancia) más ASP, el **WASM real aceptó** la respuesta y **decodificó** el pool habilitado y los ASP.

Valores **sintéticos** — no representan Testnet ni un despliegue real. No se afirma que SPP esté listo para pagos privados reales.

---

## 1. Call graph verificado (fuente `b79107cd`)

```text
Client.allContractsData (wasm / sdk/web client/mod.rs)
  → state_fetcher()                         // sin ensure_synced
  → StateFetcher::all_contracts_data
      → enabled pools from ContractConfig
      → contracts_data(pools, asp_membership, asp_non_membership)
          → pool_request: enum_keys ["Admin", "State"]  (+ instance key)
          → ASP membership: ["Admin", "NextIndex"] (+ instance)
          → ASP non-membership: ["Admin"] (+ instance)
          → Client::get_contract_data_bulk
              → get_ledger_entries only
```

| Operación | ¿Alcanzada? |
|-----------|-------------|
| `getLedgerEntries` | **Sí** |
| `getLatestLedger` / `getEvents` | **No** |
| `simulateTransaction` / `sendTransaction` | **No** |
| `ensure_synced` / `Client.sync` / `backgroundSync` | **No** |
| Prover / firma / envío / escrituras de pool | **No** |

**Puerta de seguridad:** PASS — se invocó `allContractsData` en el harness.

---

## 2. Contratos y esquemas confirmados por fuente

IDs del harness: `synthetic-contract-config.json` (pool habilitado + ASP + token + verifier).

| Contrato | Claves enum (ledger) | Claves instancia (storage, Vec([Symbol])) | Tipos de valor (fuente) |
|----------|----------------------|---------------------------------------------|-------------------------|
| Pool `…LC2U` | `Admin`, `State` | `Levels`, `MaximumDepositAmount`, `Token`, `Verifier`, `ASPMembership`, `ASPNonMembership`, `PolicyFlags` | Admin→Address; State→TreeState Map; Levels→U32; MaxDeposit→U256; Token/Verifier/ASP*→Address; PolicyFlags→U32 |
| ASP membership | `Admin`, `NextIndex` | `Levels`, `Root` | (igual Fase 2.9) |
| ASP non-membership | `Admin` | `Root` | (igual Fase 2.9) |

**TreeState** (`conversions.rs` `scval_to_tree_state` + test unitario):

- `ScVal::Map` con claves **Symbol** (no Vec): `next_index` (U64), `roots` (Vec\<U256\>)
- `filled_subtrees` opcional (ignorado por el decoder); incluido en el fixture por fidelidad al comentario de fuente
- `root_slot(0, ring_len) = 0` → se requiere ≥1 root

**GVK:** sin `AdminViewKey`/`GvkMode` en instancia ⇒ modo Off; coincide con config sin `gvkMode` (Fase 2.9 ya cargó este config).  
**DepositsPaused:** omitido ⇒ `false` (`deposits_paused_from_state`).

No se inventaron nombres de clave: todos aparecen en `contract_state.rs` / `conversions.rs` del commit citado.

---

## 3. Respuestas aceptadas por el WASM (OBS)

| Check | Resultado |
|-------|-----------|
| Fixture servido | `getLedgerEntries.allContractsMinimal.result.json` (8 entradas) |
| RPC en Stage E | **solo** `getLedgerEntries` (`synthetic_getLedgerEntries_allContractsMinimal`) |
| Forbidden RPC | ninguno |
| External network | `blockedExternal: []`, `externalSentCount: 0` |
| WASM aceptó success body | **true** |
| `callCompletedOk` | **true** |
| Pool decode | admin G…, token/verifier/ASP ids, `merkleLevels=1`, `merkleNextIndex="0"`, root cero, `maximumDepositAmount="1000000000"`, `depositsPaused=false` |
| ASP decode | igual evidencia 2.9 (admin, nextIndex, levels, root) |
| Stage status | **OBSERVADO** |
| Harness `ok` / phase | `true` / `2.12` |

---

## 4. Respuestas sintéticas no validadas como estado real

- Todo el cuerpo de `getLedgerEntries` es **sintético** (XDR offline con `@stellar/stellar-sdk`).
- No se consultó Horizon, RPC público ni bootnodes.
- `aspMinimal` / `empty` / `getLatestLedger` no se revalidan aquí como “nodo real”.
- Success de `getEvents` / `getTransaction` / `simulateTransaction` siguen **sin** demostrar.
- `sendTransaction` permanece fail-closed.

---

## 5. Llamadas RPC observadas

Durante `allContractsData()` (log mock tras clear):

```json
[{ "method": "getLedgerEntries", "outcome": "synthetic_getLedgerEntries_allContractsMinimal", "synthetic": true }]
```

`Client.new` y `readTokenDecimals` (Stage D) pueden generar otras llamadas en la sesión completa; el Stage E aisla solo entries.

---

## 6. Resultados de pruebas

```text
pnpm exec vitest run …/mockRpc.security.test.ts …/rpcFixtureSchema.test.ts …/browserHarness.availability.test.ts
→ 3 files, 16 tests passed

node …/fixtures/buildAspLedgerFixture.mjs
→ aspMinimal entries=5; allContractsMinimal entries=8

node …/serve.mjs (127.0.0.1:8765) + Cursor browser harness
→ allContractsData=OBSERVADO (detalle arriba)
```

---

## 7. Limitaciones y siguiente paso recomendado

**Limitaciones**

- Loopback + fixtures sintéticos únicamente.
- Un solo pool habilitado modelado; no se cubren pools GVK (`AdminViewKey`/`GvkMode`).
- Tip / events / simulate success / sync siguen fuera de política o no demostrados.
- Staging vacío; harness untracked; sin cambios de producción en esta fase.

**Siguiente paso**

1. Tratar `allContractsData` + `allContractsMinimal` como lectura de pool **demostrada** junto a `aspState` (2.9).  
2. No forzar `getLatestLedger` vía sync.  
3. Opcional: fixture GVK acotado, o `contracts_data_for_pool` si se exporta de forma segura.  
4. No declarar readiness de pagos privados reales.

---

## Archivos de esta fase (solo harness)

| Archivo | Acción |
|---------|--------|
| `fixtures/buildAspLedgerFixture.mjs` | Extendido (ASP + pool TreeState) |
| `fixtures/getLedgerEntries.allContractsMinimal.result.json` | **Creado** |
| `fixtures/getLedgerEntries.aspMinimal.result.json` | Regenerado (archivo) |
| `fixtures/FIXTURES_NOTES.txt` | Actualizado |
| `mock-rpc.mjs` | Sirve `allContractsMinimal` |
| `harness.mjs` / `index.html` | Stage E → `allContractsData`, phase 2.12 |
| `rpcFixtureSchema.test.ts` | Test estructural del nuevo fixture |
| `docs/FASE-2.12-ALL-CONTRACTS-DATA.md` | **Este informe** |
