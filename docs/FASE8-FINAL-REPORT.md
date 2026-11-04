# Fase 8 — Informe final (SPP Host ↔ Background)

Fecha: 2026-11-04 (Europe/Paris). Rama: `cursor/nym-android-webapp-1aa1`.
**Sin commits / pushes / merges / despliegues.**

## Arquitectura real de contextos

- **spp-host** (página `chrome-extension://…/spp-host.html` o webapp): carga WASM, OPFS Storage, `Client`, sesión RO.
- **Service Worker**: Nym, autorización, `SPP_PRIVATE_PAYMENT`, registry + `HostPoolProxy`.
- Los objetos WASM **no** se pueden compartir entre realms → bridge JSON (`astrym-spp-host-bridge`).

## SDK verificado en fuente (0.2.1)

| Capacidad | API real | ¿Cableada end-to-end? |
| --- | --- | --- |
| Init sesión / Client | `Client.new` | Sí (RO via `SppSession`) |
| Estado RO | `aspState`, `allContractsData` | Sí |
| Deposit | `PrivatePool.deposit` | API sí; **write pool no creado aún** |
| Transfer | `PrivatePool.transfer` | API sí; write pool no creado |
| Withdraw | `PrivatePool.withdraw` | API sí; write pool no creado |
| Pool state | `balance`, `notes`, `estimate` | API sí; no expuesto en UI |

Resultado on-chain del SDK: `PoolExecuteResult.hashes: string[]`.

## Archivos tocados / nuevos

- `packages/extension/src/shared/sppHostBridge.ts`
- `packages/extension/src/background/spp/sppHostPoolProxy.ts`
- `packages/extension/src/background/spp/sppPrivatePoolRegistry.ts`
- `packages/extension/src/background/handlers/sppPrivatePaymentHandler.ts`
- `packages/extension/src/background/handlers/nymHandlers.ts` (clear on disconnect)
- `packages/extension/src/background/index.ts` (lifecycle ingest)
- `packages/extension/src/spp-host/sppHostWritePool.ts`
- `packages/extension/src/spp-host/sppHostBridgeListener.ts`
- `packages/extension/src/spp-host/main.ts`, `hostController.ts`
- `packages/wallet-core/src/stellar/spp/sppNymOption.ts` (scoped fetch, injected path, `HOST_UNAVAILABLE`)
- Tests bajo `tests/shared`, `tests/background/spp`, `tests/spp-host`
- Docs: `docs/spp-host-background-integration.md`, este informe

## Tests ejecutados

| Suite | Resultado |
| --- | --- |
| extension bridge/proxy/registry/writePool | **13/13 passed** |
| wallet-core `sppNymOption.test.ts` | actualizado; re-ejecutar en validación |

No hay tests de integración Testnet reales (sin claves/fondos).

## ¿Deposit / transfer / withdraw son operativos?

**Parcialmente cableados (código), no verificados en Testnet vivo.**

Implementado en esta integración:

1. Bridge JSON + `HostPoolProxy` + lifecycle registry.
2. WalletSigner IPC (`SPP_HOST_SIGN`) → `SppWalletSignerAdapter` en el SW (vault).
3. Proxy Nym fetch (`SPP_HOST_NYM_FETCH`) para RPC Soroban desde spp-host (fail-closed).
4. `initializeWritePoolForNym`: `Client.account` → `derivePrivacyKeys` → `pool()` → `registerSppHostWritePool`.
5. Execute bajo `withSppHostNymFetchProxy`; éxito solo con `PoolExecuteResult.hashes` reales (nunca inventados).

Bloqueadores externos para PASS Testnet:

- Circuit/proving keys (~272MB) y sesión WASM/OPFS en Chromium real.
- Contratos/deploy SPP Testnet + fondos desechables.
- Evidencia de hashes confirmados on-chain.

Sin write pool registrado → `SESSION_NOT_READY` / sin host → `HOST_UNAVAILABLE` — nunca éxito inventado.
