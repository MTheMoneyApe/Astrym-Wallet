# Fase 2.29 — Capability Isolation & Host Security Design

**Fecha:** 2026-10-26  
**HEAD:** `d872ac455f47ab8822aace0ba2f62e1574d6cf27`  
**Staging:** vacío (antes y después)  
**Priors:** FASE-2.24 · 2.25 · 2.26 · 2.27 · 2.28 · (contexto 2.14)  
**SDK:** `stellar-private-payments@0.2.1`

**Alcance:** auditoría + diseño. **Sin** integración producción, **sin** pagos privados, **sin** Testnet/firma/envío, **sin** cambios a manifests/lockfiles/código de producción. **Sin** staging ni commits.

**G8 = FAIL · G9 = FAIL.**

---

## 1. Resumen ejecutivo

1. RO-1 ya tiene **superficie lógica** (allowlist 2.24, sesión 2.26, spike browser 2.27) y **evidencia de recorrido real** (2.28). Eso **no** equivale a aislamiento de capacidades del runtime.  
2. Controles **técnicamente exigibles hoy** (en harness / diseño): lista cerrada de ops, esquemas de args, `rpcUrl` loopback literal, mock `/rpc-ro1` fail-closed, no exposición de `Client`, cierre de sesión lógico, denegación sin fallback.  
3. Controles **aún hipótesis / NO DEMOSTRADOS**: red dentro de workers y WASM, supervivencia de tareas post-`close`, aislamiento durable tras quitar el guard de página, host MV3 (offscreen/popup) con broker tipado, detección completa de red externa.  
4. Ninguna de CSP, `fetch` parcheado, wrapper JS u offscreen document es, por sí sola, un sandbox completo.  
5. Arquitectura candidata: **host documental dedicado + broker tipado + sesión RO-1 sin Client crudo + transporte mock/local allowlisted**, con capas A∩B∩C (no A sola).  
6. Siguiente paso mínimo (2.30): **spike harness del broker + instrumentación de red en workers**, sin wiring de producción ni elevación de G8/G9.

---

## 2. Preflight

| Ítem | Resultado |
|------|-----------|
| Raíz | `C:\Users\M\Downloads\Stellar privacy project` |
| HEAD | `d872ac455f47ab8822aace0ba2f62e1574d6cf27` (coincide) |
| Staging | vacío |
| Informes 2.24–2.28 | Leídos |
| Harness | `ro1-host.html/.mjs`, `serve.mjs` (bind `127.0.0.1`), `mock-rpc.mjs` mode `ro1`, `readOnlyPolicy/*` |
| Backup / worktree / `.vscode/mcp.json` / manifests / lockfiles / prod | No modificados |
| Git mutaciones | Ninguna |

Working tree preexistente (extension, stellar, harness untracked) **preservado**.

---

## 3. Resultados reales de la Fase 2.28 (sin inventar)

Fuente: `FASE-2.28-MANUAL-BROWSER-VALIDATION.md`.

| Hecho | Estado |
|-------|--------|
| Host | Chromium embebido Cursor (`Chrome/148`), **no** Chrome/Edge desktop nativo |
| URL | `http://127.0.0.1:8765/.../ro1-host.html` |
| Bind serve | `127.0.0.1:8765` LISTENING |
| `Storage.open` / `Client.new` / `aspState` / `allContractsData` | **PASS** (SDK real + fixture) |
| RPC durante RO-1 | solo `getLedgerEntries` ×2 |
| Deny sync/sign/send/deposit/backgroundSync | **PASS** (superficie) |
| Client en `window` | no expuesto |
| Página: intento externo durante auto-run | ninguno observado (`blocked: []`) |
| Tras `network.restore()` | externa **alcanzable** (horizon-testnet HTTP 200) |
| Workers storage/prover spawn | observados; red interna **NO DEMOSTRADO** |
| WASM/reqwest si no usa page `fetch` | **NO DEMOSTRADO** |
| Extensión instalada | **NO DEMOSTRADO** |
| G8 / G9 | **FAIL** |

**Brecha 2.28 relevante para diseño:** evidencia de “sin tráfico externo observado en página” ≠ “tráfico bloqueado en todos los canales”; guard efímero; host ≠ extensión.

---

## 4. Modelo de amenazas

### 4.1 Activos

| Activo | Sensibilidad |
|--------|--------------|
| Claves / vault / firma Solanym | Crítico — **fuera** de RO-1; no debe tocarse |
| OPFS / `spp.db` local | Medio — datos de estado SPP; fuga o corrupción |
| Sesión RO-1 / resúmenes de contrato | Bajo–medio — lectura; no debe mutar cadena |
| Logs de auditoría | Bajo — no deben contener secretos |
| Confianza del usuario en “solo lectura” | Crítico de producto — falso positivo = riesgo de abuso |

### 4.2 Límites de confianza

```text
[ UI popup / approve ]  ──untrusted UI──►  [ SW broker ]
                                              │ typed IPC only
                                              ▼
                                       [ SPP host document ]
                                         │  WASM + workers + OPFS
                                         │  RPC only allowlisted
                                         ▼
                                       [ mock/local RPC ]
                                         (harness: 127.0.0.1/rpc-ro1)

Same realm as WASM  =  hostile if arbitrary JS co-located
Worker realm        =  separate; page patches do not apply
Service worker      =  no OPFS/WASM durable; must not hold Client
```

### 4.3 Capacidades por componente

| Componente | Capacidades relevantes |
|------------|------------------------|
| Página extensión (popup) | DOM, `chrome.runtime`, posible `fetch` según CSP/host_permissions |
| Offscreen / página dedicada | DOM + OPFS + Workers + WASM + `fetch`/XHR; posible `chrome.*` limitado |
| Service worker | Mensajería, alarms, storage chrome; **no** host ideal de WASM/OPFS durable |
| SDK SPP 0.2.1 | `Client` completo (sync, pool, prove path), Storage, workers, RpcClient |
| WASM | Lógica nativa; posible HTTP vía bindings (reqwest) **si** enlazado |
| Workers | fetch/XHR propios; OPFS (storage); circuits/prover (prover) |
| Mock RPC | Control total en harness; en prod sería endpoint allowlisted |
| Broker | Si mal diseñado: proxy de métodos arbitrarios → bypass RO-1 |
| UI approve | Si confunde lectura con mutación: aprobación engañosa (fuera RO-1 estricto) |

### 4.4 Atacantes

| Atacante | Objetivo típico |
|----------|-----------------|
| Página web / dApp | Engañar a la extensión para sync/sign/send |
| Extensión maliciosa co-instalada | Mensajes falsos al broker (si origin no validado) |
| Compromiso del host document | Acceso same-realm al `Client` crudo |
| Operador de RPC malicioso | Respuestas que empujen a fallback sync (si el código lo hace) |
| Bug en SDK | Efecto colateral (telemetría, sync implícito) |

### 4.5 Vectores de escape

| Vector | Posible / teórico / demostrado | Notas |
|--------|--------------------------------|-------|
| Red directa página (`fetch`/XHR) | **Demostrado controlable** (2.28: bloqueo con guard; bypass tras restore) | Guard ≠ durable |
| Red en worker | **NO DEMOSTRADO** | Realm separado |
| Red WASM-native | **Teórico / NO DEMOSTRADO** | Sin instrumentación |
| Callbacks / aliases al Client | **Posible** si se filtra referencia | Spike no expone Client; same-realm JS hostil sí podría |
| Workers/tareas tras `close` | **NO DEMOSTRADO** | `close` dispone Client lógico; workers pueden vivir |
| Mensajes falsificados al broker | **Teórico** (broker aún no existe en prod) | Mitigable con tipos + origin |
| Params RPC manipulados | **Posible** | Mock RO-1 ignora métodos no allowlisted; args maliciosos en `getLedgerEntries` = DoS/confusión, no send |
| Métodos fuera RO-1 | **Demostrado denegable** en wrapper/sesión | No impide llamada directa al Client si está expuesto |
| Reuso sesión / respuestas stale | **Parcialmente demostrado** (2.26 close; 2.28 invoke-after-close) | Falta broker + IDs de mensaje |
| Error → fallback a sync/send | **Demostrado evitable** en policy/sesión (fail-closed) | Debe ser invariante del broker |
| APIs nativas / deps | **Teórico** | `chrome.sockets`, WebSocket, etc. |

---

## 5. Comparación de fronteras (A–D)

**Principio:** ninguna frontera sola = sandbox completo. Evaluar capas y residuales.

### A. Wrapper JavaScript con allowlist

| Aspecto | Evaluación |
|---------|------------|
| Limita realmente | Superficie de llamada **cooperativa** (`aspState`, etc.); esquemas; deny tipado |
| Permanece | Acceso same-realm al objeto si se filtra; patches de prototipo; workers/WASM |
| WASM/workers | **Eluden** el wrapper (no pasan por él) |
| Políticas browser | Ninguna por sí misma |
| Config extensión | No requiere |
| Impedir send | Solo si **nadie** obtiene `Client` / pool; no bloquea red |
| Detectar red externa | No |
| Pruebas | Unit adversarial (ya 2.24/2.26); fuzz de métodos/args |

**Veredicto:** necesario como **disciplina de API**, insuficiente como aislamiento.

### B. Documento de extensión dedicado / offscreen + API mínima

| Aspecto | Evaluación |
|---------|------------|
| Limita realmente | Separa UI/SW del realm WASM; broker puede ser único camino |
| Permanece | Dentro del documento: plenas capacidades web + workers |
| WASM/workers | **Heredan** el documento (mismo origin de extensión); no quedan fuera del host |
| Políticas browser | CSP de extensión, permisos, opcionalmente `host_permissions` mínimos |
| Config extensión | Sí: `offscreen` o página dedicada; CSP; permisos red mínimos |
| Impedir send | Broker sin ops de envío + no exponer Client a UI; **no** elimina `Client.send*` dentro del host si hay bug |
| Detectar red externa | Parcial (DevTools, declarativeNetRequest, proxy propio); incompleto sin cobertura worker |
| Pruebas | IPC falsificado, origin checks, sesión close, dump RO-1 en host real |

**Veredicto:** frontera **candidata principal** para G8 (superficie de integración); aún no G9 completa.

### C. Host documental + CSP restrictiva + conectividad limitada por entorno

| Aspecto | Evaluación |
|---------|------------|
| Limita realmente | Orígenes de script/connect (`connect-src`); reduce escape trivial de página |
| Permanece | Workers suelen heredar CSP con matices; WASM instantiate; bugs de CSP; APIs no cubiertas por CSP |
| WASM/workers | Workers **heredan** en gran medida; no “eluden” CSP como un proceso aparte, pero **sí** hacen red propia bajo la misma política |
| Políticas browser | CSP, COOP/COEP (ya en `serve.mjs` harness), Permissions-Policy |
| Config extensión | CSP en manifest / HTML |
| Impedir send | CSP no entiende “sendTransaction”; solo puede restringir **a dónde** se conecta |
| Detectar red externa | Violaciones CSP / report-to; no garantiza ausencia |
| Pruebas | CSP violation logs; connect-src solo loopback/mock; intentos externos esperan bloqueo |

**Veredicto:** refuerzo **útil** para G9 parcial; **no** sandbox. Harness actual tiene COOP/COEP; CSP RO-1 estricta aún no formalizada en spike.

### D. Aislamiento de red en proceso / entorno externo al SDK

| Aspecto | Evaluación |
|---------|------------|
| Limita realmente | OS/firewall, proxy MITM de test, contenedor sin egress |
| Permanece | Lo que el entorno permita (DNS, loopback) |
| WASM/workers | No eluden el **egress del proceso** si el OS lo corta |
| Políticas browser | Complementarias, no sustitutas |
| Config extensión | No aplica directamente a prod wallet (usuario final sin sandbox OS) |
| Impedir send | Corta submit a red real en CI/lab; no sustituye falta de API |
| Detectar red externa | Muy fuerte en lab (pcap / deny-by-default) |
| Pruebas | CI con deny egress + allow 127.0.0.1; assert cero conexiones externas |

**Veredicto:** excelente para **evidencia de laboratorio** (acercar G9 en harness); **no** es el modelo de amenaza del usuario final con extensión instalada.

### Tabla resumen

| Frontera | ¿Sandbox completo? | Rol en arquitectura candidata |
|----------|--------------------|-------------------------------|
| A Wrapper | No | Capa lógica obligatoria |
| B Host dedicado | No | Contención de realm + único broker |
| C CSP/entorno | No | Reducir connect-src / scripts |
| D Egress lab | No (solo lab) | Evidencia verificable de red |

---

## 6. Arquitectura candidata (mínima RO-1)

### 6.1 Diagrama

```text
┌─ Popup / Review UI ─────────────────────────────────────────┐
│  Solo mensajes tipados: Ro1Open | Ro1AspState | … | Ro1Close │
│  Nunca Client / Storage / PrivatePool                        │
└────────────────────────────┬────────────────────────────────┘
                             │ chrome.runtime / MessagePort
                             │ schema validate + origin check
┌────────────────────────────▼────────────────────────────────┐
│  Service Worker — Ro1Broker                                  │
│  - allowlist ops + zod/ipcSchemas                            │
│  - sessionId + generation token                              │
│  - NO WASM / NO OPFS / NO raw Client                         │
│  - audit log (sin secretos)                                  │
└────────────────────────────┬────────────────────────────────┘
                             │ port to host only
┌────────────────────────────▼────────────────────────────────┐
│  Extension host document (offscreen o página dedicada)       │
│  ┌─ Ro1HostSession ───────────────────────────────────────┐ │
│  │  private: storage, client                               │ │
│  │  public: openStorage, createClient, aspState,           │ │
│  │          allContractsData, close, tryInvoke→deny        │ │
│  │  on error: close session; NEVER fallback sync/send      │ │
│  └─────────────────────────────────────────────────────────┘ │
│  CSP: default-src 'self'; connect-src solo RPC allowlisted   │
│  Workers: same-origin scripts only                           │
│  rpcUrl: literal loopback (harness) / allowlist fija (futuro)│
└────────────────────────────┬────────────────────────────────┘
                             │ getLedgerEntries only
┌────────────────────────────▼────────────────────────────────┐
│  Harness: 127.0.0.1 /rpc-ro1   │  Futuro prod: endpoint pin  │
└──────────────────────────────────────────────────────────────┘
```

### 6.2 Controles exigibles vs hipótesis

| Control | Exigible técnicamente | Hipótesis / residual |
|---------|------------------------|----------------------|
| Broker tipado + schemas | Sí (IPC + tests) | Compromiso del SW |
| Ops cerradas RO-1 | Sí | Bypass same-realm en host |
| Origin/destination RPC | Sí (url literal + mock allowlist) | WASM otro transporte |
| Sin API sign/prove/sync/send en broker | Sí | SDK interno si bug llama sync |
| Session close + revoke | Sí (lógico) | Workers/zombies **NO DEMOSTRADO** |
| Errores sin fallback | Sí (código + tests) | — |
| Audit logs sin secretos | Sí (redacción) | — |
| Tests mensaje falso / replay / close | Sí (harness) | — |
| Red worker/WASM bloqueada | **No aún** | Requiere instrumentación o egress lab |
| Extensión prod aislada | **No aún** | Sin host cableado |

### 6.3 Diferencia clave

- **Validación lógica de métodos** = “el broker/sesión no *acepta* sync/send”.  
- **Restricción efectiva de capacidades** = “el runtime *no puede* completar sync/send aunque se intente” (CSP connect-src, mock reject, egress lab, no Client expuesto).

Ambas son necesarias; 2.24–2.28 cubren sobre todo la primera + mock reject + guard de página efímero.

### 6.4 Anti-patrones explícitos

- Exponer `Client` a UI o broker.  
- Declarar G8/G9 PASS por allowlist o página local.  
- Confiar solo en “no vimos requests externos”.  
- Usar CSP **o** fetch patch **o** offscreen como sandbox único.

---

## 7. Matriz de garantías y verificación

Leyenda de estado **hoy** (post-2.28): PASS / FAIL / NO DEMOSTRADO.

| Garantía | Mecanismo | Test / evidencia | Estado hoy |
|----------|-----------|------------------|------------|
| Solo ops RO-1 vía API disciplinada | allowlist + ReadOnlySession / Ro1HostSession | Vitest 2.24/2.26; tryInvoke 2.28 | **PASS** (cooperativo) |
| Args / rpcUrl estrictos | policy literal loopback | adversarial 2.25/2.26 | **PASS** (harness) |
| RPC mock solo getLedgerEntries | `/rpc-ro1` | 2.27 tests + 2.28 log | **PASS** (harness) |
| Ejecución real SDK RO-1 | spike browser | 2.28 dump `__SPP_RO1_RESULT__` | **PASS** (doc host; no extensión) |
| RPC observados = getLedgerEntries | mock log + page fetch | 2.28 | **PASS** (esa sesión) |
| Red de página allowlisted | fetch/XHR patch | 2.28 blocked=[] durante run; externo bloqueado con guard | **PASS** (efímero) / **FAIL** durable post-restore |
| Red de workers | — | no instrumentado | **NO DEMOSTRADO** |
| Transporte WASM | — | no instrumentado | **NO DEMOSTRADO** |
| Tareas tras close | dispose + null refs | invoke-after-close 2.28; workers vivos? | **PASS** lógico / **NO DEMOSTRADO** runtime workers |
| Write / send no invocados | deny + mock reject | 2.28 adversarial + rpc log | **PASS** (superficie + mock) |
| Aislamiento host extensión | broker + offscreen + CSP | ausente | **NO DEMOSTRADO** |
| Mensajes falsificados al broker | schemas + origin | broker no implementado | **NO DEMOSTRADO** |
| Replay / sessionId | generation token | no implementado en spike | **NO DEMOSTRADO** |
| Egress OS denegado | lab firewall | no ejecutado esta fase | **NO DEMOSTRADO** |

**Regla de evidencia:** ausencia de tráfico observado ≠ tráfico bloqueado. Filas worker/WASM/extensión permanecen **NO DEMOSTRADO** hasta instrumentación o restricción demostrable.

---

## 8. Criterios G8 / G9

Definiciones operativas (`gates.ts` / 2.25):

| Gate | Invariante resumida | Estado | Por qué sigue FAIL |
|------|---------------------|--------|---------------------|
| **G8** | En la **integración real**, el read path no activa sync/prove/sign/send/mutators | **FAIL** | Hay spike documental + SRC + policy; **no** hay host extensión ni IPC RO-1 en producción |
| **G9** | El **host de ejecución** impone aislamiento de red/capacidades sobre los transportes que el SDK usa | **FAIL** | Guard de página incompleto; workers/WASM NO DEMOSTRADO; sin CSP/host_permissions de extensión aplicados a SPP |

### Evidencia adicional para aprobar (sin afirmar que bastará sola)

**G8 (mínimo):**

1. Host extensión (offscreen o página dedicada) ejecutando RO-1 con SDK 0.2.1.  
2. Broker tipado: únicos mensajes RO-1; tests de falsificación.  
3. Log RPC del path real: solo `getLedgerEntries` (+ init documentado).  
4. Side-effect / deny recorder: cero sync/sign/send/deposit.

¿Obtenible sin merge de producción? **Parcialmente sí** — spike en rama/harness de extensión **no cableado** al flujo de usuario (página de test empaquetada, flag off). Cablear al popup de producción **no** es requisito para *evidenciar*, pero sí para *integrar*.

**G9 (mínimo):**

1. Política de red del host (CSP `connect-src` + permisos mínimos) demostrada con intentos externos → bloqueo.  
2. Instrumentación o evidencia lab de **workers** (y residual WASM documentado).  
3. Preferible: corrida con egress denegado a nivel proceso (alternativa D) como evidencia complementaria.  
4. Persistencia post-close: workers terminados o incapaces de red.

¿Sin cambios de producción? **Sí para lab/harness**; CSP/manifest reales tocarían empaquetado — puede hacerse en **spike de extensión de prueba** sin habilitar pagos privados.

**No aprobar** G8/G9 solo con: harness Node, mock server, página `127.0.0.1` que funciona, o tests de allowlist.

---

## 9. Recomendación concreta — Fase 2.30

**Objetivo 2.30 (mínimo):** *Broker RO-1 + worker network probe en harness* — aún sin producción.

1. **Implementar en harness** (no `packages/extension` prod):  
   - `Ro1Broker` in-process o MessageChannel: mensajes tipados, sessionId, reject forge/replay/closed.  
   - Host session ya existente (`ro1-host` / `ReadOnlySession`) detrás del broker; **Client** nunca cruza el broker.  
2. **Probe de red en workers:** worker de prueba que parchea/`reports` fetch interno, o Service Worker/devtools protocol contra storage/prover workers; documentar PASS/FAIL/NO DEMOSTRADO con honestidad.  
3. **CSP draft** para `ro1-host.html` (`connect-src 'self' http://127.0.0.1:*`) y prueba de violación — sin afirmar sandbox completo.  
4. **Opcional lab:** un script de verificación con egress bloqueado (D) si el entorno lo permite.  
5. **Mantener G8/G9 FAIL**; checklist explícito de qué falta para cada gate.  
6. **No:** Testnet, firma, send, manifests de prod, lockfiles, adapter wiring.

Criterio de salida 2.30: informe con matriz actualizada (broker tests PASS; worker red al menos clasificada; G8/G9 siguen FAIL con gaps reducidos pero no cerrados).

---

## 10. Cierre

### Garantías exigibles hoy

- Allowlist RO-1 + args/`rpcUrl`  
- Mock `/rpc-ro1` fail-closed  
- Sesión sin Client expuesto + deny mutators + close lógico  
- Bind loopback del harness  
- Recorrido SDK real en documento local (2.28)

### Siguen sin demostrarse

- Red workers / WASM  
- Aislamiento durable post-guard  
- Broker/IPC de extensión + anti-forgery  
- Host MV3 real  
- Egress lab sistemático  
- G8 / G9

### Siguiente paso mínimo

Fase **2.30**: broker tipado en harness + probe de red de workers (+ CSP draft en host documental), sin producción ni elevación de gates.

### Git

| Ítem | Valor |
|------|--------|
| HEAD | `d872ac4…` |
| Staging | vacío |
| Artefacto de esta fase | solo este informe markdown |
| Código producción | intacto |
