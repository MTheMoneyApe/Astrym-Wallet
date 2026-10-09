# Diseño Conceptual del Parche: @nymproject/mix-tunnel@0.3.0

ESTADO: PENDIENTE DE VERIFICACIÓN Y GENERACIÓN OFICIAL
RAZÓN: El paquete aún no está instalado en el monorepo. No se puede usar `patch-package` de forma segura.

## Objetivo
Interceptar la fábrica de `new Worker()` para permitir una URL de extensión (evitando el bloqueo CSP de `blob:` en MV3), inyectando una dependencia agnóstica (`globalThis.__NYM_WORKER_URL__`).

## Diff Conceptual Esperado
```diff
--- a/node_modules/@nymproject/mix-tunnel/dist/esm/index.js
+++ b/node_modules/@nymproject/mix-tunnel/dist/esm/index.js
@@ -... @@
 function createBase64WorkerFactory(base64, sourcemapArg, enableUnicodeArg) {
     var url;
     return function WorkerFactory(options) {
-        url = url || createURL(base64, sourcemapArg, enableUnicodeArg);
+        url = globalThis.__NYM_WORKER_URL__ || url || createURL(base64, sourcemapArg, enableUnicodeArg);
         return new Worker(url, options);
     };
 }
```

## Instrucciones para futura Fase
1. Ejecutar `pnpm add @nymproject/mix-fetch@3.0.0 @nymproject/mix-tunnel@0.3.0`.
2. Modificar físicamente el archivo `dist/esm/index.js` según el diff conceptual.
3. Ejecutar `pnpm patch-package @nymproject/mix-tunnel`.
4. El archivo generado `.patch` reemplazará a este documento conceptual.
