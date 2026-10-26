# Fase 2.24 — SPP Read-Only Allowlist + Adversarial Tests

**Fecha:** 2026-10-26  
**HEAD (antes y después):** `d872ac455f47ab8822aace0ba2f62e1574d6cf27`  
**Staging:** vacío (antes y después)  
**Prior:** [FASE-2.23-READ-ONLY-GATE-AUDIT.md](./FASE-2.23-READ-ONLY-GATE-AUDIT.md)  
**SDK:** `stellar-private-payments@0.2.1` · commit documentado `b79107cd…`

**Alcance:** harness only — **sin** integración extensión, **sin** `packages/wallet-core/src`, **sin** manifests/lockfiles, **sin** firmas / sync real / ZK / red externa.

---

## 1. Preflight

| Ítem | Resultado |
|------|-----------|
| Raíz | `C:\Users\M\Downloads\Stellar privacy project` |
| HEAD | `d872ac455f47ab8822aace0ba2f62e1574d6cf27` (coincide) |
| Staging | vacío |
| Working tree | Cambios preexistentes preservados |
| Backup / worktree aislado / `.vscode/mcp.json` | No tocados |
| Git mutaciones | Ninguna |

---

## 2. Archivos añadidos

| Ruta | Rol |
|------|-----|
| `tests/stellar/spp/harness/readOnlyPolicy/types.ts` | Métodos allow/deny, args estrictos, `G8`/`G9` = FAIL |
| `tests/stellar/spp/harness/readOnlyPolicy/policy.ts` | `authorizeReadOnlyCall` fail-closed; validación de args; loopback `rpcUrl` |
| `tests/stellar/spp/harness/readOnlyPolicy/decisionLog.ts` | Log allow/deny sin secretos |
| `tests/stellar/spp/harness/readOnlyPolicy/execute.ts` | `executeReadOnlyCall` sin fallback; fake handlers + side-effect recorder |
| `tests/stellar/spp/harness/readOnlyPolicy/index.ts` | Barrel harness |
| `tests/stellar/spp/harness/readOnlyPolicy/readOnlyPolicy.adversarial.test.ts` | 11 pruebas adversariales offline |
| `…/docs/FASE-2.24-READ-ONLY-ALLOWLIST.md` | Este informe |

**No modificados:** `packages/extension/**`, `packages/wallet-core/src/**`, signer, gate, StateCoordinator, IPC, UI, manifests, lockfiles, tests previos.

---

## 3. Métodos autorizados y denegados

### Allowlist RO-1 (exact match only)

| Método | Args validados | Evidencia SDK / ruta |
|--------|----------------|----------------------|
| `Storage.open` | `{}` u `{ workerUrl? }` local/relativo/loopback | `js/index.js` `openStorage` / `WasmStorage.open` |
| `Client.new` | `rpcUrl` loopback; `contractConfig` object; keys estrictas; **sin** `bootnodeUrl` | `js/index.js` `newClient` → `WasmClient.new` |
| `Client.aspState` | sin args / objeto vacío | `aspState()` → `StateFetcher::asp_state` → `getLedgerEntries` only (FASE-2.8/2.9/2.23) |
| `Client.allContractsData` | sin args / objeto vacío | idem → `all_contracts_data` (FASE-2.12/2.23) |

Coincidencias parciales, prefijos y regex **no** se usan.

### Denegados (explícitos + default deny)

Incluye al menos: `Client.sync`, `Client.backgroundSync`, `ensure_synced`, `operationalFeed`, `recipientLookup`, `verifySelectiveDisclosure`, `prove_next`, `PrivatePool.deposit|transfer|transferToKeys|withdraw|transact|estimate|notes|balance`, `execute_plan`, `signTransaction|signAuthEntry|signMessage`, `sendTransaction`, `bootnodeRequired`, `readTokenDecimals`, `Client.account`, y cualquier método desconocido.

**Fuera de allowlist a propósito (aunque 2.23 los listaba como locales):** `Client.contractConfig`, `Client.dispose`, `deriveAspUserLeaf`, `Client.stopBackgroundSync` — denegados para respetar el alcance estricto de cuatro APIs de esta fase.

### Firmas públicas verificadas (npm `0.2.1`)

```text
Storage.open(options?) → Storage
Client.new({ rpcUrl, contractConfig, storage?, …, bootnodeUrl? }) → Client
client.aspState() → Promise<ContractsStateData>
client.allContractsData() → Promise<ContractsStateData>
```

---

## 4. Limitaciones de cobertura transitiva

| Garantía | Estado |
|----------|--------|
| Política bloquea superficie JS no allowlisted | **Demostrado** (unit tests) |
| `aspState`/`allContractsData` solo `getLedgerEntries` dentro del WASM | **Documentado SRC** (2.8–2.12); **no** re-probado con WASM en 2.24 |
| Init `Client.new` no arranca sync | **SRC** (`background_sync_stop: None`); política además prohíbe `bootnodeUrl` |
| Init carga prover/circuits | **Hecho JS**; APIs de prove/verify siguen denegadas — load ≠ prove |
| Ausencia total de tráfico en browser E2E | **No re-ejecutado** en 2.24; ver §6 |
| G8 / G9 | Siguen **FAIL** — no elevados |

Si una lectura interna exigiera sync, la política **no** elude el SDK: el método permanecería fuera de allowlist o se marcaría BLOCKED en auditoría.

---

## 5. Pruebas ejecutadas

```text
cd packages/wallet-core
pnpm exec vitest run tests/stellar/spp/harness/readOnlyPolicy/
→ Test Files  1 passed (1)
→ Tests       11 passed (11)
```

| # | Caso | Resultado |
|---|------|-----------|
| 1 | APIs autorizadas + args válidos | PASS |
| 2 | Métodos desconocidos fail-closed | PASS |
| 3 | Denylist explícita + críticos | PASS |
| 4 | Casing / nombres similares | PASS |
| 5 | Args extra / malformados / Horizon rpcUrl | PASS |
| 6 | Sin activar ruta bloqueada tras allow | PASS |
| 7 | Excepción SDK sin fallback sync/send | PASS |
| 8 | Sin sign* / sendTransaction | PASS |
| 9 | `fetch` no invocado (suite unitaria) | PASS |
| 10 | G8/G9 no PASS; production prohibited | PASS |
| + | Decision log sin secretos en JSON | PASS |

---

## 6. Aislamiento de red

| Mecanismo | Uso en 2.24 |
|-----------|-------------|
| Vitest unitario con **fake handlers** (sin SDK WASM) | Sí — cero RPC real |
| `vi.spyOn(globalThis, 'fetch')` → assert not called | Sí (caso 9) |
| Browser `installNetworkGuard` / mock loopback | **No re-ejecutado**; documentado en 2.7/2.9/2.12 |

**Afirmación:** bajo esta suite, `fetch` no fue llamado.  
**No afirmado:** “cero tráfico de todo el proceso” solo por log vacío fuera del spy.

---

## 7. Estado G8 / G9

| Gate | Estado (sin inferencia) |
|------|-------------------------|
| G8 Host no-SW (extensión) | **FAIL** (`readOnlyGateStatus().G8_host`) |
| G9 Config Testnet / RPC allowlist prod | **FAIL** |
| Integración producción | **prohibited** |

Estos tests **no** aprueban G8/G9.

---

## 8. Confirmaciones

- Producción / extension / src / manifests / lockfiles: **no modificados**.  
- No firmas, no `sendTransaction`, no sync real, no ZK gen, no Horizon/RPC externo.  
- Allowlist **no** conectada a producción.  
- Fail-closed: error de lectura → `handlerError` retornado; **sin** operación alternativa bloqueada.

---

## 9. Git final

| Ítem | Valor |
|------|--------|
| HEAD | `d872ac455f47ab8822aace0ba2f62e1574d6cf27` |
| Staging | vacío |
| Nuevos untracked (esta fase) | `harness/readOnlyPolicy/**` + este `.md` (bajo árbol `tests/stellar/` ya untracked) |

Comandos: `git rev-parse HEAD`, `git status --short`, `git diff --cached --name-only`, vitest (arriba).

---

## 10. Criterio de cierre

| Requisito | Estado |
|-----------|--------|
| Política fail-closed | Sí |
| Casos adversariales pasan | 11/11 |
| Sin convertir fallo de lectura en op bloqueada | Sí (`executeReadOnlyCall`) |
| Integración prod sigue prohibida (G8/G9 unresolved) | Sí |
