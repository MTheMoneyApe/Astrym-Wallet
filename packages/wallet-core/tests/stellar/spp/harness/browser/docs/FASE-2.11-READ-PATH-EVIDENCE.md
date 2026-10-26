# Fase 2.11 — Consolidación del harness SPP y auditoría de rutas de lectura seguras

**Fecha:** 2026-10-26  
**Repositorio:** `C:\Users\M\Downloads\Stellar privacy project`  
**Branch / HEAD:** `master` / `d872ac455f47ab8822aace0ba2f62e1574d6cf27` (coincide con la referencia)  
**Staging:** vacío  
**Upstream SPP:** `stellar-private-payments@0.2.1` ↔ commit `b79107cd24327198f8eb2dbaf4bdc65a8a1e8cf1`

## A. Auditoría de integridad

| Comprobación | Resultado |
|--------------|-----------|
| HEAD | `d872ac455f47ab8822aace0ba2f62e1574d6cf27` |
| Staging | Vacío (`git diff --cached` sin salida) |
| Working tree | Muchos cambios **preexistentes** (extension, vault, Solana, Stellar `src/`, lockfile, etc.) — **preservados**, no tocados en esta fase |
| Harness SPP | Todo bajo `packages/wallet-core/tests/stellar/spp/harness/` (**untracked** junto con `tests/stellar/`) |
| ¿Fases 2.2–2.10 alteraron producción? | **No en el sentido de esta fase:** la evidencia 2.x vive en `tests/.../harness/` + docs. `packages/wallet-core/src/stellar/` es trabajo **previo/paralelo** (adapter SPP, etc.), untracked, no modificado por 2.11 |
| Fixtures | No borrados ni reorganizados en 2.11 |

Comandos de inspección (esta fase): `git status --short`, `git diff --cached --stat`, `git diff --stat`, filtros por harness y `src`.

---

## B. Matriz de evidencia (RPC / lectura)

Leyenda de confianza: **OBS** = observado en browser WASM · **SRC** = call graph / tipos en fuente · **STRUCT** = validación estructural TS · **POL** = política del mock · **NO** = no demostrado.

| Ruta | API que la invoca | Endpoint RPC | Fixture | WASM aceptó success? | Decodificación app completa? | Riesgos / prerrequisitos | Evidencia | Confianza |
|------|-------------------|--------------|---------|----------------------|------------------------------|--------------------------|-----------|-----------|
| **`getLedgerEntries`** | `Client.aspState()` → `StateFetcher::asp_state` → `get_contract_data_bulk` | `getLedgerEntries` | `getLedgerEntries.aspMinimal.result.json` (sintético) | **Sí** | **Sí** (admin, nextIndex, levels, root observados) | Solo loopback; valores **sintéticos**, no nodo real; `allContractsData` aún necesita pool `State` | FASE-2.8, **2.9** | **OBS** alta |
| **`getLedgerEntries`** (vacío) | `allContractsData` / bulk (2.8) | `getLedgerEntries` | `getLedgerEntries.empty.result.json` | **Sí** (deser RPC) | **No** — `MissingRequiredContractKeys` | Demuestra deser del envelope, no parsing ASP | FASE-2.8 | **OBS** media |
| **`getLatestLedger`** | Solo `Indexer::fetch_contract_events` → sync/catch-up / `Client.sync` / `backgroundSync` | `getLatestLedger` | `getLatestLedger.result.json` | **No demostrado** | N/A | Cualquier tip path arrastra **`getEvents` + sync** | FASE-2.5 STRUCT, **2.10** bloqueo | STRUCT + SRC; **WASM tip: NO** |
| **`getEvents`** | `Indexer::init` / `fetch_contract_events` / `bootnodeRequired` | `getEvents` | Ninguno de éxito (mock `-32601`) | **No** | N/A | Mock fail-closed; sync fuera de política | FASE-2.2/2.5/2.8 | **NO** / POL |
| **`getTransaction`** | Submit/confirm paths | `getTransaction` | Ninguno de éxito | **No** | N/A | Forma SPP 2 campos en fuente; no fixture de éxito | FASE-2.4/2.5 | SRC schema; **WASM: NO** |
| **`simulateTransaction`** | `readTokenDecimals` → `read_contract` | `simulateTransaction` | Ninguno de éxito (mock reject) | **No** (solo error JSON-RPC) | N/A | Path OBSERVADO pero success bloqueado a propósito | FASE-2.7 | **OBS** path; success **NO** |
| **`sendTransaction`** | Submit / pool writes | `sendTransaction` | N/A — siempre error | N/A | N/A | **Fail-closed permanente** | mock + tests seguridad | **POL** |

No se afirma que los fixtures sintéticos representen comportamiento de un nodo Stellar real.

---

## C. Revisión de oportunidades de lectura segura (sin ampliar alcance)

Fuente: commit `b79107cd` + exports WASM `0.2.1`.

| API pública | ¿Lectura “segura” sin sync/ZK/firma/envío? | Conclusión |
|-------------|--------------------------------------------|------------|
| `aspState` / `allContractsData` | Sí (solo `getLedgerEntries`) | **Ya validada** (aspState 2.9); allContractsData incompleta de fixtures de pool |
| `contractConfig` | Local, sin RPC | Irrelevante para deser RPC |
| `operationalFeed` / `recipientLookup` | Llaman `ensure_synced` → **catch-up** (Inline) | **No segura** bajo reglas 2.11 |
| `Client.sync` / `backgroundSync` | Sync explícito | **Prohibidas** |
| `bootnodeRequired` | Solo `getEvents` (init), sin tip | No tip; eventos sin fixture de éxito; **no re-probar** |
| `readTokenDecimals` | Solo `simulateTransaction` | Path leído; success no autorizado |
| `verifySelectiveDisclosure` | Usa `StateFetcher` **+ prover** | Implica **ZK/prover**; fuera de “lectura sin pruebas” |
| `deriveAspUserLeaf` | Puro local | Sin RPC |
| Export tip-only `getLatestLedger` | **No existe** | FASE-2.10 |

**Resultado negativo explícito:** no hay una **nueva** ruta de lectura segura adicional a las ya documentadas (`aspState` / entries). La exploración se detiene aquí.

---

## D. Validación mínima (offline)

```text
cd packages/wallet-core
pnpm exec vitest run \
  tests/stellar/spp/harness/browser/mockRpc.security.test.ts \
  tests/stellar/spp/harness/browser/rpcFixtureSchema.test.ts \
  tests/stellar/spp/harness/browser/browserHarness.availability.test.ts
→ 3 files, 15 tests passed (exit 0)
```

Sin live RPC, sin servidor externo (solo tests Node del mock/fixtures/disponibilidad).

---

## E. Informe final

### 1. Hechos demostrados (OBS / tests)

- Staging vacío; HEAD = `d872ac4…`.
- Harness SPP untracked bajo `tests/stellar/spp/harness/`; fixtures 2.9 intactos.
- `aspState` + fixture aspMinimal: WASM acepta `getLedgerEntries` y decodifica Admin/NextIndex/Levels/Root (**2.9**).
- Mock: `sendTransaction` y métodos no modelados fallan; tests de seguridad + esquema pasan (**15**).
- `readTokenDecimals` en browser solo dispara `simulateTransaction`, rechazado por mock (**2.7**).
- Tip `getLatestLedger`: sin path público seguro; **2.10** no ejecutó probe.

### 2. Hechos inferidos del código fuente (SRC)

- Único caller productivo de `get_latest_ledger`: `Indexer::fetch_contract_events`.
- `bootnodeRequired` → `Indexer::init` → `getEvents` únicamente.
- `operationalFeed` / `recipientLookup` → `ensure_synced` → catch-up.
- Esquemas serde de tip / entries / events / simulate / send (2.4).

### 3. Aún no demostrados

- Deser WASM exitosa de `getLatestLedger`, `getEvents`, `getTransaction`, `simulateTransaction` (cuerpo success).
- `allContractsData` con pools completos.
- Equivalencia con nodo real / pagos privados reales (**no afirmado**).

### 4. Limitaciones del harness

- Loopback + fixtures sintéticos únicamente.
- OPFS/browser requerido para Storage; Node no sustituye deser WASM de entries vía Storage.
- Tip y eventos acoplados a sync en el SDK publicado.
- Recorder sin firmas válidas; sin vault de producción en el harness.

### 5. Recomendación del siguiente paso

1. Tratar **`aspState` + aspMinimal`** como la ruta de lectura on-chain **demostrada** del harness.  
2. **No** forzar tip vía `sync`/`backgroundSync` sin política y fixtures `getEvents` explícitos.  
3. Opcional (fase futura acotada): fixtures de pool `Admin`/`State` para `allContractsData`, o export upstream tip-only.  
4. No declarar SPP listo para pagos privados reales a partir de esta evidencia.

---

## Archivos de esta fase

| Archivo | Acción |
|---------|--------|
| `packages/wallet-core/tests/stellar/spp/harness/browser/docs/FASE-2.11-READ-PATH-EVIDENCE.md` | **Creado** |

Sin cambios de producción, fixtures, mock ni dependencias en 2.11 (solo este informe + ejecución de tests de lectura).
