# HANDOFF — `astrym/testnet-mvp` (Para Jade — Sprint 22 nov)

## 1. Base mergeada en `dev` (`astrym/testnet-mvp`)
- PR #4 (`1cc0165a` / `78a607d`) mergeado: runtime WASM reproducible, KDF v3, privacidad Nym fail-closed y gates de seguridad en `OFF`.
- Rama `master` sigue congelada.

## 2. Mejoras añadidas hoy en `astrym/testnet-mvp`
- **Default `'direct'` sin preferencia previa:** `DEFAULT_NYM_PRIVACY_MODE = 'direct'` (`nymPrivacyPreference.ts` / `NymRuntimeController.ts`), manteniendo fail-closed estricto en `'nym'` (sin fallback a clearnet).
- **MixFetch + SPP:** deduplicación de peticiones concurrentes en `NymOffscreenRuntime` (`inflightRequests` por `method:url`) y eliminada la apertura automática de `spp-host.html` al conectar Nym (solo bajo acción explícita del usuario).
- **Friendbot vía Nym (Testnet):** `stellarTransportFetch.ts` permite `GET` sin body a `https://friendbot.stellar.org` en Testnet; botón Friendbot habilitado en `direct` o `nym` conectado.
- **UI/UX Popup + Webapp móvil (`#191A1C` / `#3CE894`):**
  - Cambio de privacidad en 1 clic (`executeOneClickPrivacyMode`: `setMode('nym')` + `connect`, o `setMode('direct')` + `disconnect` si activo).
  - Menú de cuentas compacto (`account-menu-row`, copia inline) sin desbordes (`left: 12px; right: 12px; width: auto`) y responsividad móvil (`360px–430px`).
  - Detalles técnicos (`Conectar`/`Desconectar`, Logical/Effective URL, gateway, Probe Horizon y panel SPP) agrupados en el acordeón **"Opciones avanzadas y diagnóstico"**.
  - **Historial real + etiquetas (`512097f`):** últimos 5 pagos desde Horizon (`GET_STELLAR_RECENT_PAYMENTS`, fail-closed) + mapa local `astrym.txTransportHistory` con insignia **`Nym`** / **`Directo`** y enlace a Stellar Expert.
  - **Estabilidad popup (`512097f` / `f0e9ff7`):** ancho/padding raíz (`box-sizing: border-box`, sin recortes laterales), fix de orden de hooks en `Dashboard.tsx` (`mergedRecentTxs` antes de returns tempranos) y `PopupErrorBoundary` en `App.tsx`.
  - Tests unitarios focales en verde; builds `build:nym-dev` y `vite.webapp.config.ts` OK (nota Windows: `copy-spp-assets.mjs` requiere ruta POSIX/caché SPP para `prepare-spp-runtime.sh`).

## 3. Pendiente para cerrar `dev` -> `master` (Ronda 22 nov)
- **Victor:** validar techo de fee de `1.5 XLM` (`15_000_000` stroops) y revisar P2 de B4 (aislamiento de rutas internas del host SPP).
- **Limpieza P2/P3:**
  - Sacar hooks de test fuera de producción.
  - Cubrir camino feliz del `write-pool` en tests.
  - Respaldo de timeout además de `chrome.alarms`.
  - Permisos seguros (`0700`) en directorio temporal de build.
- **Cierre:** revisiones finales de Victor y Elias antes del OK explícito de M para mergear a `master` y lanzar el build real en Vercel.
