# Fase 2.36 — Validación manual reproducible en Chrome Desktop MV3

**Fecha:** 2026-10-26  
**HEAD (antes y después):** `d872ac455f47ab8822aace0ba2f62e1574d6cf27`  
**Rama:** `master`  
**Staging:** vacío (antes y después)  
**Priors:** FASE-2.29–2.35  
**SDK:** `stellar-private-payments@0.2.1`  
**Artefacto:** `packages/wallet-core/tests/stellar/spp/harness/mv3-spike/` **v0.0.36**

**G8 = FAIL · G9 = FAIL.**

---

## 0. Estado de ejecución Chrome Desktop (obligatorio)

| Ítem | Estado |
|------|--------|
| Chrome Desktop | **Ejecutado** (UA `Chrome/156.0.0.0`) |
| Extensión unpacked | ID `kloekcmhonhmmlfcbmpedeehcciffagk` · artifact `0.0.36` |
| Sesión canónica | `mv3-36-1792982674264` |
| Evidencia operador (canónica) | `mv3-spike/evidence/runs/spp-2.36-evidence-mv3-36-1792982674264-1792983765641.json` |
| Validación offline | `node evidence/validate-evidence-cli.mjs …` → **exit 0**, `ok: true`, **G8/G9 FAIL** |
| Export intermedio (egress storage duplicado / sin prover) | `…1792983580606.json` — supersedido por el canónico |

---

## 1. Preflight y Git

| Ítem | Resultado |
|------|-----------|
| Raíz | `C:\Users\M\Downloads\Stellar privacy project` |
| HEAD | `d872ac455f47ab8822aace0ba2f62e1574d6cf27` |
| Staging | vacío |
| Backup / worktree / `.vscode/mcp.json` | No tocados |
| Prod extension / lockfiles | No modificados por el cierre documental |
| Git mutaciones | Ninguna |

---

## 2. Arquitectura del artefacto de prueba

```text
Popup ──envelope req──► SW broker (background.js)
                           │  validateBrokerRequest · NO SDK
                           ▼ port spp-ro1-host
                    host/spp-ro1-host.html  (chrome-extension://)
                           │  vendor/ SDK 0.2.1 + containment
                           ▼
                    http://127.0.0.1:8765/rpc-ro1  (getLedgerEntries only)
```

CSP `extension_pages` observada en export (`csp.manifestExtensionPages`):

```text
script-src 'self' 'wasm-unsafe-eval'; object-src 'self';
connect-src 'self' http://127.0.0.1:8765; worker-src 'self'
```

Persistencia post-fix: `chrome.storage.local` clave `spp_2_36_session_store_v1` (append-only). Un reload arranca sesión nueva; no mezcla `workers`/`rpc` de la anterior en el export actual.

---

## 3. Instrucciones

Ver `mv3-spike/OPERATOR-RUNBOOK.md`. Ejecutadas por el operador en Chrome Desktop.

---

## 4. Resultados observados

### 4.1 Offline (agente)

| Comando | Exit |
|---------|------|
| `node validate-artifact.mjs` | 0 |
| `node evidence/validateEvidence.test.mjs` | 0 (8 PASS) |
| `node evidence/validate-evidence-cli.mjs` (export canónico) | 0 |

### 4.2 Chrome Desktop (operador + export canónico)

| Hecho | Evidencia |
|-------|-----------|
| Host `chrome-extension://…/host/spp-ro1-host.html` | `context.isExtensionPage: true` |
| RO-1 `ok: true` | `stages.aspState` / `allContractsData`; `rpc.onlyGetLedgerEntries: true` |
| RPC observado | solo `getLedgerEntries` (×2) |
| Denied probes | mutators + RPC no allowlisted con `rejected: true` |
| Workers SDK_REAL | `storage-worker.js`, `prover-worker.js` registrados |
| Egress storage | contexto confirmado (`typeof document === 'undefined'`, href worker); CSP `connect-src` bloqueó `https://csp-probe.invalid/` → `PASS_CSP_CONFIRMED` |
| Egress prover | mismo patrón → `PASS_CSP_CONFIRMED` |
| Duplicado | 2ª fila storage idéntica; validador dedupe (no cuenta doble) |
| Emergency close | `lifecycle.operator_close` · terminate host |
| Post-close | `NO_ACTIVITY_OBSERVED` (**≠** ausencia demostrada) |
| Vault / keys / signing | `false` |

### 4.3 Harness twin 2.35

Sigue siendo evidencia HTTP distinta; no sustituye este run Desktop.

---

## 5. Tabla PASS / FAIL / NOT DEMONSTRATED / NOT TESTED

| Afirmación | Estado | Notas |
|------------|--------|-------|
| Artefacto unpack listo (estático) | **PASS** | |
| Host MV3 real (`chrome-extension://`) ejecutado | **PASS** | Export canónico |
| SW no instancia SDK | **PASS** (diseño + broker sin SDK) | Ping runtime no re-citado en JSON; SW no importa SPP |
| Broker adversarial en Chrome | **NOT TESTED** | No ejercido en esta pasada |
| RPC allowlist Desktop | **PASS** | |
| Workers SDK_REAL registrados + terminables | **PASS** | register + `emergencyClose` |
| CSP página = manifest | **PASS** | `manifestExtensionPages` en export |
| CSP workers efectiva (connect-src) | **PASS** | Probe in-realm + mensaje CSP |
| Egress `.invalid` worker real atribuible a CSP | **PASS** | storage + prover |
| Mensajes tardíos post-cierre (broker) | **NOT TESTED** | |
| Ausencia de actividad posterior **demostrada** | **NOT DEMONSTRATED** | Solo `NO_ACTIVITY_OBSERVED` |
| Nested workers fuera de registro | **NOT DEMONSTRATED** | |
| Sin acceso a claves / firma / vault | **PASS** | |
| G8 | **FAIL** | Spike ≠ integración producción |
| G9 | **FAIL** | Post-close + nested insuficientes |

---

## 6. Limitaciones

1. `NO_ACTIVITY_OBSERVED` no prueba ausencia absoluta.  
2. Nested `Worker` dentro de DedicatedWorker fuera del wrapper del host.  
3. Broker adversarial UI no corrido en esta pasada.  
4. Un export temprano con dos filas `storage-worker` se corrigió con re-export; usar el canónico `…3765641.json`.  
5. Playwright/CDP no usado (sin deps nuevas).

---

## 7. G8 / G9

| Gate | Estado | Justificación (evaluador) |
|------|--------|---------------------------|
| **G8** | **FAIL** | `productionIntegration`: spike ≠ wallet de producción (checklist RO-1/RPC/deny/vault pueden estar PASS) |
| **G9** | **FAIL** | `postCloseAbsence` INSUFFICIENT; `nestedWorkers` INSUFFICIENT — pese a egress CSP PASS en ambos workers |

`PASS_CSP_CONFIRMED` **no** eleva G8/G9 por sí solo.

---

## 8. Harness vs Chrome Desktop vs abiertas

| Fuente | Aporta | No aporta |
|--------|--------|-----------|
| Twin 2.35 | RO-1 bajo CSP HTTP | Origen extension |
| Spike + validate Node | Empaque, gates, dedupe | Sustituir Chrome |
| **Chrome Desktop (este run)** | Host MV3, RO-1, egress CSP workers, terminate | G8/G9 producto; nested; ausencia post-close demostrada |

---

## 9. Siguiente acción mínima

1. Tratar el export `…3765641.json` como evidencia canónica 2.36 Desktop.  
2. No flipar G8/G9.  
3. Siguiente fase de producto (si procede): diseño de host en `packages/extension` **sin** mutaciones SPP — o instrumentación adicional solo si se exige nested/post-close demostrable.

---

## 10. Comandos (cierre documental)

```text
git rev-parse HEAD
→ d872ac455f47ab8822aace0ba2f62e1574d6cf27

node evidence/validate-evidence-cli.mjs evidence/runs/spp-2.36-evidence-mv3-36-1792982674264-1792983765641.json
→ exit 0 · G8 FAIL · G9 FAIL · workerEgressStorage/Prover PASS
```

Sin Horizon / Testnet / firma / sync / ZK / staging / commits.

---

## 11. Conclusión

**Demostrado en Chrome Desktop MV3 (spike):** host extension page; RO-1 loopback allowlisted; workers SDK_REAL registrados y terminados por el host; egress a `.invalid` bloqueado por CSP (`connect-src`) **dentro** de `storage-worker.js` y `prover-worker.js` con contexto de consola verificado.

**Sigue FAIL / NOT DEMONSTRATED:** G8 (no es integración de producción); G9 (post-close y nested); ausencia absoluta de actividad post-cierre.
