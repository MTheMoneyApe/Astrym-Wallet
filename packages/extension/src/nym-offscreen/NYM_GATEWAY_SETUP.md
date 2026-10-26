# Nym Mixnet — gateway setup (operator)

Solanym uses `@nymproject/mix-fetch@1.4.2`. Live Mixnet connect stays **off** until you configure
both values below, grant the exact optional host permission, and (separately) authorize live smoke
for a one-shot rebuild. Defaults keep the allowlist **empty** in source.

## Two values (do not confuse them)

| Role | Format | Where used |
| --- | --- | --- |
| **Identity key** | Base58 Ed25519 node id (no `://`, no host) | `MixFetchOpts.preferredGateway` → `createMixFetch` |
| **WSS origin** | `wss://hostname:port` (exact) | Chrome `optional_host_permissions` + Solanym allowlist |

Official mix-fetch v1 docs pin entry with an identity, not a URL:

- Source: [mix-fetch migrating from v1.x](https://nym.com/docs/developers/mix-fetch/migration)
- Example identity in that doc: `q2A2cbooyC16YJzvdYaSMH9X3cSiieZNtfBr8cE8Fi1`

`https://validator.nymtech.net` is the **bootstrap / Nym API** host already in
`host_permissions`. It is **not** a Mixnet entry gateway.

## Verified operator reference (mainnet)

Cross-checked against Nym’s official Node Status API (re-verify before live use):

| Field | Value |
| --- | --- |
| Identity (`preferredGateway`) | `q2A2cbooyC16YJzvdYaSMH9X3cSiieZNtfBr8cE8Fi1` |
| Docs source | https://nym.com/docs/developers/mix-fetch/migration |
| Status API | https://mainnet-node-status-api.nymtech.cc/v2/gateways/q2A2cbooyC16YJzvdYaSMH9X3cSiieZNtfBr8cE8Fi1 |
| Hostname | `nym-node-cli.devrel.nymte.ch` |
| `wss_port` | `9001` |
| WSS origin | `wss://nym-node-cli.devrel.nymte.ch:9001` |
| Host permission pattern | `https://nym-node-cli.devrel.nymte.ch:9001/*` |
| Bonded / entry | `true` / `entry: true` |
| Code constant | `NYM_VERIFIED_GATEWAY` in `verifiedGateway.ts` |

The development manifest lists that **exact** pattern under `optional_host_permissions`.
Chrome will not grant it until you click **Grant permission** in the Solanym UI (user gesture).
Build scripts never call `chrome.permissions.request`.

## Configuration steps

1. Re-confirm identity + `hostname` + `wss_port` on the Node Status API.
2. Build without SPP vendor rebuild: `pnpm --filter @solanym/extension build:nym-dev`
3. Chrome → Extensions → Load unpacked → `packages/extension/dist` (or Reload if already loaded).
4. Settings → Nym: paste WSS origin + identity (placeholders show the verified values) → **Save gateway**.
5. Click **Grant permission** — the popup calls `chrome.permissions.request` on the click
   stack (not via background IPC). Accept the Chrome prompt for the exact host only.
   Grant is confirmed only when `chrome.permissions.contains` returns true.
6. Dry-run: **Smoke dry-run** (`confirmLiveSmoke: false`) — assets/config/permission probe;
   returns `SMOKE_DRY_RUN` (expected). Never calls `createMixFetch`.

## Live connect / disconnect (one-shot authorization)

Authorization is **build-time**, not a permanent source flip:

| Build | Auth flag | Use |
| --- | --- | --- |
| `pnpm build:nym-dev` | `false` (default) | Daily / dry-run |
| `pnpm build:nym-live-smoke` | `VITE_NYM_LIVE_SMOKE_AUTHORIZED=true` | Single live session |

After `build:nym-live-smoke`:

1. Reload the unpacked extension.
2. Confirm gateway still saved + permission still granted.
3. Invoke live smoke with `{ confirmLiveSmoke: true }` **or** Connect — runs `createMixFetch` then disconnect.
4. Immediately rebuild with `pnpm build:nym-dev` and reload so the auth flag is cleared.

Do not leave a live-authorized build loaded longer than the test. No Stellar RPC/Horizon traffic;
no vault/signer access.

## Diagnostics

| Code | Meaning |
| --- | --- |
| `GATEWAY_ALLOWLIST_EMPTY` | No WSS origin saved |
| `GATEWAY_IDENTITY_REQUIRED` | No MixFetch identity key saved |
| `GATEWAY_NOT_ALLOWLISTED` | Selected WSS not in saved origins |
| `PERMISSION_DENIED` | Exact host pattern not granted |
| `PERMISSION_NOT_IN_MANIFEST` | Pattern missing from `optional_host_permissions` |
| `BAD_IDENTITY` | Value looks like a URL/host; MixFetch wants base58 identity |
| `SMOKE_NOT_AUTHORIZED` | Dry-run or unauthorized build — expected until live rebuild |
| `CLOCK_SKEWED` | OS clock differs from gateway UTC (MixFetch auth rejects skewed timestamps). Sync Windows Time / NTP, then retry Connect. |

## MixFetch HTTP round-trip smoke

After **MixFetch Ready**, use **HTTP smoke (MixFetch)** in the Nym panel. This POSTs a
random `solanymProbeId` through the **existing** MixFetch instance and checks the echo.
Offscreen open / Connect / createMixFetch alone are **not** a completed Mixnet request.

| Field | Default |
| --- | --- |
| URL | `https://postman-echo.com/post` |
| Method | `POST` `application/json` `{ "solanymProbeId": "<id>" }` |
| Success | HTTP 2xx **and** response JSON echoes the same id under `json.solanymProbeId` (or `data` / top-level) |
| Timeout | 60s (Mixnet latency) |
| Override | UI URL field, or `VITE_NYM_HTTP_SMOKE_URL`, or IPC `NYM_HTTP_SMOKE.url` |

Custom echo: HTTPS POST JSON that returns the same `solanymProbeId` field. Do not point at
Stellar/Solana RPC. No extra Chrome host permission is required for Mixnet egress (gateway
WSS permission already covers the MixFetch path). Traffic uses `mixFetch` only — never clearnet
`fetch` for this smoke.

## Public data via transport (architecture check)

**Fetch public data via Nym** uses `FailClosedTransportRouter.fetch` → MixFetch POST
`https://postman-echo.com/post` with `{ solanymProbeId }` (same echo that passed HTTP smoke).
GET to `/get` timed out via Mixnet in live CDP; POST kept. Override `VITE_NYM_PUBLIC_DATA_URL`.
Explicit transport selection; no clearnet fallback when Nym fails. Not wallet/Horizon/RPC.

## What this repo does **not** do by default

- Does not ship a non-empty gateway allowlist in `DEFAULT_NYM_NETWORK_ALLOWLIST`
- Does not enable live smoke without `build:nym-live-smoke`
- Does not call `createMixFetch`, grant permissions, or send Mixnet traffic during ordinary builds
