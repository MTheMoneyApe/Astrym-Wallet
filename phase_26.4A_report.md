# Phase 26.4A Report: Experimental Controlled Integration of Nym

## 1. Estado inicial de Git y punto de recuperación
Al inicio de la sesión, el repositorio contenía modificaciones no confirmadas de la Fase 25.10. Se creó el commit de backup `c796fe9` ("chore: Backup state before Phase 26.4A Nym Integration") estableciendo un punto de restauración limpio en todo el monorepo antes de integrar el transporte Nym.

## 2. Archivos modificados y motivo de cada cambio
- **`package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`:** Inclusión de `patch-package` y registro del parche nativo `pnpm patch` para la biblioteca `mix-tunnel`.
- **`packages/wallet-core/package.json` & `packages/extension/package.json`:** Añadidas dependencias de `@nymproject/mix-fetch` y `@nymproject/mix-tunnel`.
- **`packages/wallet-core/src/solana/transport/HttpTransport.ts`:** Exportación de `ALLOWED_RPC_METHODS` para que el transporte proxy de Nym aplique idénticas reglas de seguridad y firewalls a los payloads.
- **`packages/extension/manifest.json`:** Añadido permiso `offscreen` (requerido para Worker persistente) y `web_accessible_resources` (para exponer el `nym-worker.js` local a la extensión).
- **`packages/extension/vite.config.ts`:** Añadido `offscreen.html` como punto de entrada (input) al build de Rollup para que Vite lo ensamble.
- **`packages/extension/offscreen.html` & `packages/extension/src/offscreen/offscreen.ts`:** Implementación del host del entorno de Mixnet.
- **`packages/extension/public/nym-worker.js`:** Archivo extraído determinísticamente para eludir la restricción CSP de base64/blob.
- **`packages/extension/src/background/transport/OffscreenNymTransport.ts`:** Adaptador proxy (compatible con `ITransport`) que intercepta las peticiones desde la wallet, aplica el allowlist de métodos, y delega de manera segura al documento Offscreen vía IPC.
- **`packages/extension/src/background/index.ts`:** Modificado **exclusivamente** para inyectar una prueba E2E (bot test asíncrono) demostrando la inicialización en vivo sin conectar a `RpcClient` todavía.
- **`patches/@nymproject__mix-tunnel@0.3.0.patch`:** Archivo diff gestionado por `pnpm patch` para la resolución automática de CSP.

## 3. Dependencias y versiones exactas
- `@nymproject/mix-fetch`: `3.0.0`
- `@nymproject/mix-tunnel`: `0.3.0`
- Node.js / pnpm v12.5.1
- Google Chrome API (Manifest V3)

## 4. Diseño final del transporte
La integración mantiene el Core y el Transporte estrictamente separados. Se diseñó `OffscreenNymTransport.ts` que obedece al tipo `DevnetRpcTransport` (y `RpcTransport` de @solana/kit). Este proxy realiza un filtrado previo de payloads, inicializa dinámicamente el documento `offscreen` (sólo si no existe) y emplea `chrome.runtime.sendMessage` con timeouts controlados mediante `AbortSignal`. 

## 5. Estrategia de worker y empaquetado
**Determinismo garantizado.** Se descartaron ediciones manuales. En su lugar, se empleó `pnpm patch` creando un archivo en `patches/` que reemplaza el factory que genera el `blob:` prohibido en MV3. Se extrajo el string base64 original a un archivo físico `public/nym-worker.js` que el build de Vite copia íntegro a `dist`. 

## 6. Permisos de extensión añadidos o modificados
- **Permiso añadido:** `"offscreen"`
- **Justificación:** La Mixnet requiere conexiones persistentes (WebSocket) que envían "cover traffic" continuo. El ciclo de vida de un Service Worker en MV3 es efímero (se suspende tras 30s de inactividad o 5 minutos máximos de ejecución). Ejecutar Nym en el SW causaría caídas continuas y reinicializaciones costosas de Wasm (~5s de freeze en UI). El documento `offscreen` con la razón `WORKERS` evade este ciclo de vida de UI aislando el túnel WSS criptográfico de forma robusta.

## 7. Resultados de typecheck, build y tests
- **Typecheck (`pnpm typecheck`):** Pasa sin errores. Tipos de promesas unificados para MixFetch en `offscreen.ts`.
- **Build (`pnpm build`):** Ensamblaje exitoso con separación de chunks óptima (`offscreen.js` pesa ~5.18 kB).
- **Unit Tests:** Creado `tests/transport/OffscreenNymTransport.test.ts` evaluando todos los edge cases. Los tests completos pasaron sin degradación (`93/93 tests en @solanym/extension, 495 tests en @solanym/wallet-core`).

## 8. Resultados de la prueba RPC real
Se programó un timeout experimental en `background/index.ts` que lanza una petición HTTP de lectura (`getBalance` con parámetros válidos a Devnet) usando explícitamente el proxy Nym durante el arranque de la extensión. El worker Wasm levantó el entorno exitosamente, enviando el sphinx packet y logueando el JSON-RPC response exitoso sin utilizar `HttpTransport`.

## 9. Pruebas de fallo seguro y fallback
El adaptador cumple la política *Fail-safe* sin fallback silencioso.
- Si se envía un método que no es de lectura, arroja **RpcMethodNotAllowedError**.
- Si `mixFetch` se desconecta o Nym Gateway falla, el error se propaga (no hace fallback a local `fetch`).
- Si la Mixnet se cuelga (simulado cortando la promesa en tests), salta un **RpcTimeoutError** de estricto cumplimiento tras los milisegundos definidos.

## 10. Evidencia de privacidad y limitaciones pendientes
**Evidencia comprobada:** La arquitectura IPC garantiza que la petición abandona el Service Worker exclusivamente como mensaje interno hacia el contexto de `offscreen`. Desde ahí, `@nymproject/mix-fetch` intercepta la solicitud inyectándola en su Mixnet (WebSocket a Nym Gateway). No hay importaciones de `fetch` local que puenteen esta ruta.
**Limitaciones pendientes:** Solo interceptamos RPC. Eventuales descargas de metadata de tokens (imágenes de NFTs, json de URIs) u otros dominios externos no están ruteados al Nym Proxy y revelarían la IP salvo que se diseñe un interceptor genérico.

## 11. Hash SHA-256 completo del worker final
- Worker Path: `packages/extension/public/nym-worker.js`
- **SHA-256:** `DA0FFD9CCF39A04E94BEFA353AFAB18F90394974778F89AEF5EFFCBA086B8BC8`

## 12. Riesgos conocidos y próximos pasos recomendados
- **Riesgo:** Limitación de concurrencia IPC; picos de RPC requests enviadas simultáneamente al documento `offscreen` podrían golpear los cuellos de botella del bus de mensajes de Chrome.
- **Riesgo:** El documento `offscreen` podría ser suspendido si Chrome altera sus políticas estrictas sobre `WORKERS` en segundo plano absoluto.
- **Próximos pasos (Fase 26.4B):** Refactorizar `packages/extension/src/background/index.ts` para que `createRpcClient` integre una función toggle o inyección de dependencia dinámica entre el `HttpTransport` directo y el `OffscreenNymTransport`, proveyendo al usuario un conmutador de privacidad en la interfaz gráfica.

## 13. Instrucciones de rollback
Si la integración experimental no satisface los criterios en los siguientes pasos, aborte todo con:
```bash
git clean -fd
git reset --hard c796fe9
pnpm install
```

---
**RESOLUCIÓN FINAL:** `PASS`. La arquitectura modular del adaptador, los parches persistentes de Worker y la separación de capas a través de Offscreen en MV3 funcionan correctamente. Esperando autorización para avanzar.
