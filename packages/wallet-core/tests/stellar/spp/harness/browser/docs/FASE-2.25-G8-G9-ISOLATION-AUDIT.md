# Fase 2.25 — Auditoría de G8/G9 y efectos indirectos del SDK SPP

**Fecha:** 2026-10-26  
**HEAD (antes y después):** `d872ac455f47ab8822aace0ba2f62e1574d6cf27`  
**Staging:** vacío (antes y después)  
**SDK:** `stellar-private-payments@0.2.1` · snapshot `b79107cd24327198f8eb2dbaf4bdc65a8a1e8cf1`  
**Prior:** FASE-2.24-READ-ONLY-ALLOWLIST · FASE-2.23-READ-ONLY-GATE-AUDIT · FASE-2.8–2.12  

**Alcance:** auditoría + pruebas harness aisladas. **Sin** integración producción, **sin** ops privadas, **sin** red externa, **sin** manifests/lockfiles.

**No se declara** SPP integrado, pagos privados funcionales, ni SDK seguro para producción.

---

## 1. Resumen ejecutivo

1. **RO-1 puede aplicarse al SDK real solo como *gate de superficie***: la allowlist 2.24 coincide con rutas SRC donde `aspState` / `allContractsData` usan únicamente `getLedgerEntries`, y `Client.new` / `Storage.open` no arrancan sync ni `execute_plan`.  
2. **La allowlist no es prueba de ausencia de efectos indirectos en runtime WASM** dentro de esta suite Node (fake handlers). Eso queda **NO DEMOSTRADO** aquí; la evidencia WASM sigue siendo FASE-2.9/2.12.  
3. **G8 y G9 permanecen FAIL.** El harness no los aprueba.  
4. **Endurecimiento 2.25:** `rpcUrl` exige host **literal** (`127.0.0.1` | `localhost` | `[::1]`); se rechazan credenciales, `127.1`, `0x7f000001`, IPv4 decimal y authority `@` tricks que el parser WHATWG canoniza o confunde.

---

## 2. Preflight

| Ítem | Resultado |
|------|-----------|
| Raíz | `C:\Users\M\Downloads\Stellar privacy project` |
| HEAD | `d872ac4…` (coincide) |
| Staging | vacío |
| Módulo 2.24 | Presente (`readOnlyPolicy/`, informe 2.24) |
| Snapshot 2.4 | Presente (temp `upstream-src-b79107cd…`) |
| Backup / worktree / mcp.json | No tocados |
| Git mutaciones | Ninguna |

---

## 3. Árbol de llamadas y efectos indirectos

Leyenda: **COMPROBADO_EN_FUENTE** · **INFERIDO** · **NO_DEMOSTRADO** (también en `sdkCallGraph.ts`).

### 3.1 `Storage.open`

```text
js/index.js openStorage
  → WasmStorage.open({ workerUrl })
       → storage-worker (OPFS / spp.db)
```

| Efecto | ¿? | Evidencia |
|--------|-----|-----------|
| RPC chain | No | COMPROBADO (no RpcClient) |
| Sync / events | No | COMPROBADO |
| Prove / sign / send | No | COMPROBADO |
| Worker local | Sí | COMPROBADO |
| Escape | `storage.call(...)` bajo nivel — **fuera** RO-1 | COMPROBADO |

### 3.2 `Client.new`

```text
js/index.js newClient(options)
  → Storage.open? (si no hay storage)
  → ProverBridge.spawn + configureCircuitsBase + ping   // load ≠ prove_next
  → WasmClient.new(rpcUrl, storage, prover, config, bootnode?)
       → NativeClient::init
            → RpcClient::new(rpc_url)     // sin RPC al construir
            → SyncHandle::inline(bootnode) // no spawn BackgroundSync::run
            → guarda prover + storage + config
```

| Efecto | ¿? | Evidencia |
|--------|-----|-----------|
| Sync al init | **No** | COMPROBADO (`background_sync_stop: None`; no `catch_up`) |
| Prove ZK gen | **No** en init | COMPROBADO (ping/configure only) |
| Sign / send | No | COMPROBADO |
| bootnode | Solo si `bootnodeUrl` — **RO-1 rechaza la key** | COMPROBADO |
| Telemetría | Sinks locales registrados | COMPROBADO existencia; red = **NO_DEMOSTRADO** sin guard |
| `init_readonly` nativo | Existe; **no** en API JS WASM | COMPROBADO |

### 3.3 `Client.aspState` / `Client.allContractsData`

```text
aspState | allContractsData
  → state_fetcher()
  → StateFetcher::asp_state | all_contracts_data
       → contracts_data(...)
            → get_contract_data_bulk
                 → RpcClient::get_ledger_entries   // ÚNICO método RPC
```

| Efecto | aspState / allContractsData |
|--------|------------------------------|
| RPC | `getLedgerEntries` only — COMPROBADO |
| `ensure_synced` | **No** — COMPROBADO (contrasta con `operationalFeed`) |
| simulate / send / sign / prove | **No** — COMPROBADO |
| WASM aceptó fixture | FASE-2.9 / 2.12 OBS — **no re-ejecutado** en 2.25 unit |

### 3.4 Elusión de la política RO-1

| Vector | Mitigación / estado |
|--------|---------------------|
| Alias / casing de método | Exact match — deny (2.24) |
| Callbacks SDK tras allow | Política no hookea WASM; depende de no llamar otras APIs — **limitación** |
| `bootnodeUrl` + sync posterior | Key prohibida en `Client.new`; sync denegado |
| `storage.call` / account / pool | Default deny |
| rpcUrl alias `127.1` / hex / decimal | **Cerrado en 2.25** (literal host) |
| Credenciales en URL | **Cerrado en 2.25** |
| Confundir allowlist con G8/G9 PASS | `assessG8G9()` / tests fuerzan FAIL |

---

## 4. Tabla allow / block (RO-1)

| Permitido | Bloqueado (ejemplos SRC-peligrosos) |
|-----------|--------------------------------------|
| `Storage.open` | `Client.sync`, `Client.backgroundSync`, `ensure_synced` |
| `Client.new` (loopback literal) | `operationalFeed`, `recipientLookup` |
| `Client.aspState` | `verifySelectiveDisclosure`, `prove_next` |
| `Client.allContractsData` | `PrivatePool.*` mutators, `execute_plan` |
| | `sign*`, `sendTransaction`, desconocidos |

---

## 5. G8 — veredicto

| Campo | Contenido |
|-------|-----------|
| **Invariante** | Client+OPFS+workers solo en documento durable; SW no es runtime SPP; RO policy delante de IPC |
| **Evidencia requerida** | Host extensión real; SW sin ownership de Client; test suspend/restart |
| **Pruebas 2.25** | `assessG8G9().G8.verdict === 'FAIL'`; harness OPFS histórico ≠ extensión |
| **Limitaciones** | Snapshot/harness browser ≠ MV3 |
| **Brecha** | Cero wiring `packages/extension` → SPP |
| **Veredicto** | **FAIL** |

## 6. G9 — veredicto

| Campo | Contenido |
|-------|-----------|
| **Invariante** | ContractConfig pinneado + RPC allowlist de integración; sin claim Nym-SPP |
| **Evidencia requerida** | Config Testnet real versionado; allowlist en host; UX Nym≠SPP |
| **Pruebas 2.25** | Loopback literal endurecido; `G9.verdict === 'FAIL'` |
| **Limitaciones** | Regex harness ≠ allowlist producción |
| **Brecha** | Sin deployment Testnet en path Solanym |
| **Veredicto** | **FAIL** |

Ningún gate pasa a PASS por nombre de API o allowlist declarativa.

---

## 7. Pruebas y comandos

```text
cd packages/wallet-core
pnpm exec vitest run tests/stellar/spp/harness/readOnlyPolicy/
→ Test Files  2 passed (2)
→ Tests       21 passed (21)
```

Archivos de prueba:  
`readOnlyPolicy.adversarial.test.ts` (2.24) · `readOnlyPolicy.sdkIsolation.adversarial.test.ts` (2.25).

Casos 2.25 destacados: rpcUrl adversarial; alineación deny↔SRC; traverse fake sin sync/sign/send; error fail-closed; G8/G9 FAIL; fetch spy.

**Red:** suite unitaria con fake handlers + `fetch` spy. **No** browser E2E / Horizon / Testnet.

---

## 8. Limitaciones y falsos positivos posibles

| Riesgo | Nota |
|--------|------|
| “Allowlist PASS ⇒ SDK seguro” | Falso — solo superficie |
| “Unit test ⇒ cero efectos WASM” | Falso — **NO DEMOSTRADO** aquí |
| “Loopback harness ⇒ G9” | Falso — G9 exige pin Testnet/host |
| “OPFS harness ⇒ G8” | Falso — falta host extensión |
| Telemetría / prover ping | Posible ruido local; no afirmamos cero red sin guard browser |
| Snapshot parcial | Módulos `plan` ausentes; no afecta paths RO-1 auditados |

---

## 9. Archivos tocados (solo harness)

| Archivo | Cambio |
|---------|--------|
| `readOnlyPolicy/policy.ts` | rpcUrl literal + credenciales |
| `readOnlyPolicy/sdkCallGraph.ts` | **Nuevo** — evidencia call graph |
| `readOnlyPolicy/gates.ts` | **Nuevo** — G8/G9 assessments |
| `readOnlyPolicy/readOnlyPolicy.sdkIsolation.adversarial.test.ts` | **Nuevo** |
| `readOnlyPolicy/index.ts` | Exports |
| `…/docs/FASE-2.25-G8-G9-ISOLATION-AUDIT.md` | Este informe |

Producción / extension / src / manifests: **intactos**.

---

## 10. Condiciones verificables para la siguiente fase

Antes de declarar progreso hacia integración RO en extensión:

1. **G8:** stub de host documento (offscreen o página) en extensión **o** doc+spike reproducible — aún sin mutaciones.  
2. **G9:** ContractConfig pin + lista RPC explícita (aunque sea solo mock loopback embebido en extensión).  
3. Re-ejecutar Stage E browser con `installNetworkGuard` + policy wrapper delante de `Client.*`.  
4. Mantener RO-1; no ampliar allowlist sin nueva auditoría SRC.

---

## 11. Recomendación técnica — Fase 2.26

**Implementar un *ReadOnlySession* harness/browser** que:

1. Envuelva `authorizeReadOnlyCall` → llamadas reales al SDK **solo** bajo mock RPC loopback + network guard.  
2. Assert post-run: RPC log ⊆ `{ getLedgerEntries }`; `externalSentCount === 0`; denylist probes.  
3. Entregue checklist G8/G9 **aún FAIL**, con spike de diseño del host extensión (sin cablear mutaciones ni producción vault).

**No** hacer: conectar UI/IPC producción, sync, deposit, ni marcar G8/G9 PASS.

---

## 12. Git final

| Ítem | Valor |
|------|--------|
| HEAD | `d872ac455f47ab8822aace0ba2f62e1574d6cf27` |
| Staging | vacío |
| Diff relevante | untracked bajo `harness/readOnlyPolicy/` + este `.md` |

Confirmaciones: sin staging/commit; sin producción; sin tráfico externo en tests ejecutados; G8/G9 **FAIL**.
