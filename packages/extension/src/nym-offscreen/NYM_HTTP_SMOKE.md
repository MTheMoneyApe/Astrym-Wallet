# MixFetch HTTP round-trip smoke

Explicit POST echo through the **already initialized** MixFetch instance in the
offscreen document. Does not create a second MixFetch client. Does not touch
wallet seeds, vaults, or Stellar/Solana RPC.

## Default endpoint

| Item | Value |
| --- | --- |
| URL | `https://postman-echo.com/post` |
| Method | `POST` |
| Body | `{ "solanymProbeId": "<random non-secret id>" }` |
| Success | HTTP 2xx **and** echoed id equals sent id under `json.solanymProbeId` |

Verified outside Mixnet with a clearnet curl for **format only** — that check is
documentation evidence, not a Mixnet result. Live Mixnet success is only the
in-extension **HTTP smoke (MixFetch)** path.

## Provide your own echo URL

1. HTTPS endpoint accepting `POST` + `application/json`.
2. Response JSON must include the same `solanymProbeId` at:
   - `json.solanymProbeId` (Postman Echo / httpbin style), or
   - `data.solanymProbeId`, or
   - top-level `solanymProbeId`.
3. Set URL in the Nym panel override field, or build with
   `VITE_NYM_HTTP_SMOKE_URL=https://…`, or pass `NYM_HTTP_SMOKE` IPC `{ url }`.

Do not use Stellar Horizon/Friendbot or Solana RPC hosts (validation rejects them).

## States

`idle` → `running` → `success` | `error` | `timeout`

MixFetch Ready / offscreen open / permission grant ≠ HTTP smoke success.

## mix-fetch@1.4.2 CORS note

v1 Go WASM validates `Access-Control-Allow-Origin` on Mixnet responses. Public
echo hosts usually omit ACAO for `chrome-extension://…`, which surfaces as
`"Access-Control-Allow-Origin" header not present on remote` even though the
request already traveled the Mixnet. Solanym sets
`RequestInit.mode = 'unsafe-ignore-cors'` (official v1 flag; removed in v2)
for HTTP smoke only. That is **not** a clearnet fallback.
