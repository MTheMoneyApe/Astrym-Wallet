# Astrym en Android

La billetera se abre como **webapp independiente** en el navegador del teléfono o instalada en la pantalla de inicio. En ese modo no existen `chrome.runtime`, `chrome.storage`, `chrome.offscreen`, `chrome.alarms` ni `chrome.tabs`. El mismo código de la extensión arranca dentro de la página.

## Qué corre en el teléfono

| Pieza | Extensión (Chrome de escritorio) | Webapp Android |
| --- | --- | --- |
| Interfaz | Popup 400×600, o pestaña `webapp.html` | Página a pantalla completa (`100dvh`, safe area) |
| Bóveda | `chrome.storage` + Web Crypto | `localStorage` (cifrado) e IndexedDB (clave de sesión) |
| Nym MixFetch | Documento offscreen (`chrome.offscreen`) | `@nymproject/mix-fetch` en esta ventana |
| Permiso de host | `chrome.permissions.request` en el clic de Connect | No hace falta: el socket WSS es del navegador |
| Gateway | Si no hay uno guardado, Connect fija el gateway verificado | Igual |

Mientras el modo es `nym`, un error de MixFetch **no** reintenta por clearnet. **Disconnect** vuelve el transporte a `direct`. Los datos del ledger de Stellar siguen siendo públicos: Nym oculta la metadata de red (tu IP frente al destino), no el libro.

## Abrirla en el teléfono

Requisitos en el ordenador: Node 20+, pnpm 9+.

```bash
pnpm install
pnpm dev:webapp
```

Vite escucha en `0.0.0.0:5173`. En el teléfono, misma Wi-Fi:

`http://<ip-lan-del-ordenador>:5173/webapp.html`

La página funciona así, sin instalarla. El service worker (necesario para “Añadir a pantalla de inicio”) solo se registra en un contexto seguro: `https://` o `http://localhost`.

### Instalar como PWA

1. En el ordenador: `pnpm build:webapp`. La salida es `packages/extension/dist-webapp/`.
2. Sírvela por HTTPS (cualquier servidor estático en la raíz del sitio). `manifest.webmanifest` pide `display: standalone`, color `#191A1C` y acento `#3CE894`.
3. En Chrome, Brave o Firefox para Android abre la URL y elige **Añadir a pantalla de inicio** / **Instalar app**.
4. Ábrela desde el icono. Arranca en `webapp.html`, sin barra del navegador.

Atajo con cable USB, sin HTTPS: `adb reverse tcp:5173 tcp:5173` y en el teléfono abre `http://localhost:5173/webapp.html`. `localhost` sí permite el service worker.

## Desde el popup de la extensión

El botón **Modo Android** abre `webapp.html` en una pestaña con `chrome.tabs.create`. Esa pestaña comparte el service worker y la bóveda de la extensión. No es el runtime del teléfono: MixFetch sigue en el documento offscreen. En el teléfono, abre la URL del paso anterior.

## Nym en los dos sitios

1. Ajustes → Nym → **Connect**.
2. Sin gateway guardado se usa el origen verificado `wss://nym-node-cli.devrel.nymte.ch:9001` y su identity key.
3. En la extensión, el permiso de host del gateway se pide en ese mismo clic. En Android ese paso no existe.
4. **Ready** solo cuando `createMixFetch` termina. El documento abierto no basta.
5. Las lecturas Horizon, Friendbot y el envío Stellar (`StellarTransactionClient`) usan el mismo fetch. En modo `nym` salen por MixFetch.
6. **Disconnect** cierra MixFetch y deja el modo en `direct`.

Los assets WASM (`nym-mixfetch/`) se copian al arrancar `dev:webapp` / `build:webapp` y también al build de la extensión. Deben quedar como hermanos de `index.js` para que `import.meta.url` resuelva el worker.
