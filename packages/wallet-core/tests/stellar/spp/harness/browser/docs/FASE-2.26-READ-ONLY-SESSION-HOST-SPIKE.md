# Fase 2.26 — ReadOnlySession, network guard y spike del host de extensión

**Fecha:** 2026-10-26  
**HEAD (antes y después):** `d872ac455f47ab8822aace0ba2f62e1574d6cf27`  
**Staging:** vacío  
**Priors:** FASE-2.24 · FASE-2.25  
**SDK:** `stellar-private-payments@0.2.1` (no integrado en producción)

**No se declara** SPP integrado, pagos privados funcionales, ni G8/G9 PASS.

---

## 1. Preflight

| Ítem | Resultado |
|------|-----------|
| Raíz | `C:\Users\M\Downloads\Stellar privacy project` |
| HEAD | `d872ac4…` (coincide) |
| Staging | vacío |
| Informes 2.24/2.25 + RO-1 | Leídos / presentes |
| Backup / worktree / mcp / manifests | No tocados |
| Git mutaciones | Ninguna |

---

## 2. Diseño de `ReadOnlySession`

**Ubicación:** `harness/readOnlyPolicy/readOnlySession.ts`

| Propiedad | Comportamiento |
|-----------|----------------|
| Superficie | Solo `openStorage` → `createClient` → handle.`aspState` / `allContractsData` |
| Cliente crudo | **No se expone**; handle sin `sync` / `account` / `sign*` |
| Validación | `rpcUrl` literal loopback + `authorizeReadOnlyCall` antes de crear |
| Sesión | `sessionId` + estado `open\|closed`; handle inválido tras `close` |
| Errores | Fallo de handler → **cierra** sesión; **sin** fallback a sync/send |
| `tryInvoke` | Default deny para métodos no RO-1 |
| Gates | `gateStatus()` siempre `{ G8: FAIL, G9: FAIL }` |

**Límite explícito:** no es frontera de seguridad frente a código arbitrario en el mismo realm (WASM hostil, patches de prototipo, workers no cooperativos). Es una API disciplinada + policy gate para experimentos de harness.

Handlers por defecto = **fakes** (recorder). Adaptador SDK real queda fuera de esta fase (requiere browser + mock RPC).

---

## 3. Network guard

**Ubicación:** `harness/readOnlyPolicy/networkGuard.ts`

### Instrumentado (Node harness)

| Transporte | Clasificación |
|------------|---------------|
| `fetch` | local_allowed / external_blocked |
| `http.request` / `http.get` | idem |
| `https.request` / `https.get` | idem |
| `WebSocket` / `EventSource` | si existen en el realm |
| `Worker` constructor | registra `not_demonstrated` (red interna del worker) |

### No cubierto → **NO DEMOSTRADO**

- Sockets nativos / WASM del SDK SPP  
- Red dentro de DedicatedWorker sin cooperación  
- APIs `chrome.*` / extension-native  
- Cualquier transporte no parcheado  

**No** se afirma aislamiento completo solo porque `fetch` esté mockeado.

---

## 4. Pruebas y resultados

```text
cd packages/wallet-core
pnpm exec vitest run tests/stellar/spp/harness/readOnlyPolicy/
→ Test Files  3 passed (3)
→ Tests       33 passed (33)
```

Incluye: RO-1 vía sesión; deny mutators; rpcUrl adversarial; cierre/reuso; error fail-closed; sin leak de API SDK; guard fetch/http; G8/G9 FAIL.

Sin Horizon / Testnet / firmas / sync real / ZK.

---

## 5. Spike del host de extensión (análisis estático)

**Sin cambios en `packages/extension`.** Evidencia: FASE-2.14, MV3 constraints, APIs Chrome, hallazgos 2.13/2.25.

| Opción | WASM / workers / OPFS | Ciclo de vida | Separación vs SW/popup | Red / CSP | Firmar/enviar | Veredicto spike |
|--------|----------------------|---------------|------------------------|-----------|---------------|-----------------|
| **Service Worker** | OPFS limitado / workers frágiles; SW efímero | Suspend/restart pierde estado | Es el SW | DeclarativeNetRequest posible pero complejo | Riesgo si se cablea signer | **No recomendado** como runtime SPP |
| **Offscreen document** | DOM + workers + OPFS más plausibles | Mientras offscreen exista; Chrome puede limitar | Mejor separación del SW | CSP extensión + fetch observable | Debe **no** recibir claves de firma | **Candidato** si APIs disponibles y política RO |
| **Página extensión dedicada** (`chrome-extension://…/spp-host.html`) | Igual que documento pleno | Usuario/ventana; más estable para debug | Clara vs content scripts | CSP + allowlist RPC | Host RO-only; firmar en otro módulo gated | **Candidato preferido** para spike seguro |
| **SharedWorker** | Posible compartir OPFS/session | Vida ligada a documentos | Media | Difícil auditar | — | **NO DEMOSTRADO** sin spike runtime |

### Recomendación de host

1. **Primera opción de diseño:** página de extensión dedicada (o offscreen si el producto exige background sin ventana) como **único** lugar que carga `stellar-private-payments` WASM + workers + OPFS.  
2. SW solo como **broker IPC** (mensajes tipados RO-1), sin importar el SDK.  
3. Popup/UI nunca recibe transporte RPC ni objeto Client.  
4. Política de red del host: allowlist loopback/mock en harness; allowlist pinneada en Testnet futuro — **G9 sigue FAIL** hasta implementarse.  
5. El host **no** debe enlazar `WalletSigner` / vault en el hito RO.

**Ejecutar SDK real en extensión:** no hecho en 2.26 (requeriría tocar producción o empaquetado). Marcado **NO DEMOSTRADO** en runtime extensión.

---

## 6. Gates G8 / G9

| Gate | Estado | Evidencia 2.26 | Límites | Brecha |
|------|--------|----------------|---------|--------|
| **G8** (read path real sin ops prohibidas) | **FAIL** | Fakes + SRC graphs; no host extensión | Fakes ≠ WASM en extensión | Wiring extensión ausente |
| **G9** (aislamiento red/runtime/capacidades del host) | **FAIL** | Node `networkGuard` parcial | WASM/worker sockets NO DEMOSTRADO | Sin host CSP/política extensión |

`ReadOnlySession` tests **no** bastan para PASS.

---

## 7. Archivos

| Ruta | Acción |
|------|--------|
| `readOnlyPolicy/readOnlySession.ts` | Nuevo |
| `readOnlyPolicy/networkGuard.ts` | Nuevo |
| `readOnlyPolicy/readOnlySession.adversarial.test.ts` | Nuevo |
| `readOnlyPolicy/gates.ts` | Invariantes G8/G9 alineados a 2.26 |
| `readOnlyPolicy/index.ts` | Exports |
| `…/docs/FASE-2.26-READ-ONLY-SESSION-HOST-SPIKE.md` | Este informe |

Producción / manifests / lockfiles: **no modificados**.

---

## 8. Veredicto honesto

| Demostrado | No demostrado |
|------------|---------------|
| RO-1 session API fail-closed con fakes | SDK real dentro de `ReadOnlySession` |
| Deny mutators/sign/send/sync vía sesión | Aislamiento WASM-native network |
| Guard Node fetch/http/https bloquea externos en test | Guard completo en extensión / workers |
| Spike estático: SW malo; página/offscreen candidatos | Host extensión ejecutando SPP |
| G8/G9 siguen FAIL | Cualquier PASS de integración |

**Siguiente bloqueo técnico:** falta un **host documento en extensión** (o harness browser que invoque SDK real bajo mock+guard) antes de poder reunir evidencia G8/G9. El wrapper JS solo no cierra G9.

### Recomendación Fase 2.27

Spike **runtime** en harness browser (no producción): cablear `ReadOnlySession` a handlers que llamen `Client.aspState`/`allContractsData` reales bajo `serve.mjs` + mock RPC + `installNetworkGuard` del browser; medir `getLedgerEntries`-only. En paralelo, documento de arquitectura del `spp-host.html` sin merge a extension code — o stub untracked solo si se acota explícitamente fuera de `src/` de producción.

---

## 9. Git final

| Ítem | Valor |
|------|--------|
| HEAD | `d872ac455f47ab8822aace0ba2f62e1574d6cf27` |
| Staging | vacío |
| Tests | 33 passed |
| Red externa | no usada |
