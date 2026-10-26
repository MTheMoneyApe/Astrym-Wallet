# Nym mix-fetch packaging (extension)

## Official client (`@nymproject/mix-fetch@1.4.2`)

- Init: `createMixFetch(opts?)` awaits internal `setupMixFetch(opts)` then returns `{ mixFetch, disconnectMixFetch, … }`.
- Opts: `MixFetchOpts` from `@nymproject/mix-fetch-wasm@1.4.2`. `preferredGateway` is a **base58 identity key**, not a WSS URL. Solanym strips internal `gatewayAllowlist` and maps `disableCoverTraffic` → `clientOverride.coverTraffic.disableLoopCoverTrafficStream`.
- Worker: `new URL('web-worker-0.js', import.meta.url)` from packaged `nym-mixfetch/index.js` (not Vite-bundled into `nym-offscreen.js`).
- WASM (from worker): `mix_fetch_wasm_bg.wasm`, `go_conn.wasm` via `import.meta.url` siblings.
- CSP: `'wasm-unsafe-eval'` + `worker-src 'self'`. Bootstrap host_permission: `https://validator.nymtech.net/*` (API only — not an entry gateway).
- Operator gateway prep: see `NYM_GATEWAY_SETUP.md`. Allowlist stays empty in repo defaults.

## Dist layout

`public/nym-mixfetch/*` → Vite → `dist/nym-mixfetch/*` (siblings). Offscreen loads `nym-mixfetch/index.js` only via `chrome.runtime.getURL` (no remote scripts).

```
pnpm copy:nym
pnpm smoke:nym:public   # pre-build
pnpm build              # includes smoke:nym --dist
```

## Gateway host permissions (MV3)

- Bootstrap (required): `host_permissions` → `https://validator.nymtech.net/*`
- Gateway (per smoke): exact `https://<gateway-host>:<port>/*` derived from operator `wss://` origin
- Request path: user clicks **Grant permission** → `chrome.permissions.request({ origins: [exactPattern] })`
- Chrome requires that exact pattern to appear under `optional_host_permissions` in the loaded manifest
- Permission granted ≠ Mixnet Ready

## Separately authorized live smoke

Follow `NYM_GATEWAY_SETUP.md` (identity + WSS + exact optional host pattern). Then:

1. `pnpm build:nym-live-smoke` (injects `VITE_NYM_LIVE_SMOKE_AUTHORIZED=true` for that build only).
2. Reload unpacked extension → Grant permission in UI if needed.
3. Invoke `NYM_LIVE_SMOKE` with `{ confirmLiveSmoke: true }` (or Connect after grant).
4. Immediately `pnpm build:nym-dev` + reload to clear the auth flag.

Dry-run (`confirmLiveSmoke: false`) only probes assets/config; it never calls `createMixFetch`.
Default builds keep the auth flag false.
