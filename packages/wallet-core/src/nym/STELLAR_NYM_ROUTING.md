# Stellar HTTP × Nym routing

Nym protects **network metadata** (client IP vs destination). It does **not** hide Stellar ledger data.

## Routed through Nym when `FailClosedTransportRouter` mode = `nym`

| Operation | Client method | Notes |
| --- | --- | --- |
| Horizon account balance | `StellarReadClient.getBalance` | HTTPS GET via mix-fetch |
| Friendbot fund (testnet) | `StellarReadClient.fundTestnetAccount` | HTTPS GET via mix-fetch |
| Account load, fee, submit, confirm | `StellarTransactionClient` | Same injected fetch via Horizon `httpClient` adapter |

Requires: mixnet `connect()` succeeded (`connected: true`). On mixnet failure → typed error, **no clearnet retry**.

## Direct only when mode = `direct` (user disabled Nym)

Those Stellar operations use the injected fetch (clearnet). Disconnect sets mode back to `direct`. Errors while mode is still `nym` do not retry on clearnet.

## Not routed by this policy

- Solana RPC / `HttpTransport` and Solana `TransactionClient`
- SPP WASM / Storage / Client
- Chrome extension APIs, IPC, signing, vault

## Package

Official egress: `@nymproject/mix-fetch` 1.4.x (`createMixFetch` / `mixFetch` / `disconnectMixFetch`).
Not `@nymproject/sdk` (messaging-only).

## Extension runtime

MV3 **offscreen document** (`nym-offscreen.html`) hosts `@nymproject/mix-fetch`
(needs `window` + WASM worker). SW orchestrates via typed IPC; CSP already
includes `'wasm-unsafe-eval'`. Assets copied to `public/nym-mixfetch/` by
`scripts/copy-nym-mixfetch-assets.mjs`.

Document open ≠ Mixnet Ready — `connected` only after successful `createMixFetch`.

The Android webapp uses the same runtime in the page (`InPageMixFetchBridge`), not `chrome.offscreen`. Assets are still siblings under `nym-mixfetch/`.
