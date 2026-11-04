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

## Destination policy

Only `https://postman-echo.com/post` is approved. A per-call URL or
`VITE_NYM_HTTP_SMOKE_URL` override is accepted only if it resolves to that exact
HTTPS URL; other hosts, paths, query strings, and embedded credentials are
rejected before MixFetch is invoked.

The installed MixFetch bridge does not expose a documented redirect policy.
The allowlist validates the initial URL only; redirects are not guaranteed to
be blocked or revalidated.

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
