# Astrym Wallet

**Private Stellar payments for people who refuse to broadcast their financial life.**

Astrym is a browser extension wallet for the Stellar network. It combines a familiar self-custody experience with network-level privacy: when Nym MixFetch is enabled, Horizon and related HTTPS traffic leave the device through the Nym mixnet—so observers on your local network or ISP cannot trivially link your IP to which Stellar endpoints you query. Signing and keys stay local; the mixnet carries transport, not your seed.

| | |
| --- | --- |
| **Repository** | [github.com/MTheMoneyApe/Astrym-Wallet](https://github.com/MTheMoneyApe/Astrym-Wallet) |
| **Network** | Stellar Testnet (demo / hackathon) |
| **Builder track** | **Genesis** |
| **Thematic track** | **Stellar Composed** |

---

## Problem

Stellar makes moving value fast and cheap—but classic wallet traffic is still **clearnet HTTP** to public Horizon. Anyone watching the network path can see *that* you talk to Stellar APIs, when you do it, and often enough context to fingerprint a user—even when ledger privacy primitives exist separately.

Everyday users also face wallets that bury them in seed phrases, RPC jargon, and “privacy” claims that only apply to one layer of the stack.

## Solution

Astrym is a **privacy-first Stellar wallet** that:

- Holds Stellar accounts locally (HD derivation, vault, unlock / auto-lock).
- Reads balances and funds Testnet accounts through Horizon with an injectable transport.
- Routes compatible Stellar HTTPS through **Nym MixFetch** when the user selects Nym mode—**fail-closed** (no silent clearnet fallback).
- Surfaces transport state clearly: logical Horizon URL vs MixFetch-effective endpoint, connection readiness, and probe results.
- Is built for Stellar Testnet demos judges can reproduce from this public repo.

## Target users

- Individuals who want **Stellar payments** without exposing wallet API traffic to their ISP.
- Builders and privacy-conscious power users who need a **working extension** (not a mock) on Testnet.
- Teams composing Stellar with **mixnet transport** and, where applicable, private-payment ecosystem tooling.

## Value proposition

| Layer | What Astrym delivers |
| --- | --- |
| **Product** | A real Chrome MV3 wallet UX for Stellar Testnet. |
| **Privacy (network)** | Nym MixFetch for Stellar Horizon-compatible HTTPS when Nym is selected. |
| **Integrity** | Fail-closed transport: Mixnet errors surface; traffic does not silently fall back to clearnet. |
| **Stellar** | Native Stellar accounts, Horizon reads, Friendbot funding path, Testnet transfers via the extension stack. |

---

## HackMeridian tracks

### Builder track: Genesis

Astrym enters as a **new / early product** building a working proof of concept and first MVP—not a mockup-only submission.

**How we meet Genesis requirements**

| Requirement | Astrym |
| --- | --- |
| Working PoC / functional MVP | Chrome extension with vault, Stellar accounts, Horizon reads, Nym Connect + MixFetch path. |
| Run on Stellar Testnet | Default Horizon / Friendbot / passphrase paths target **Testnet**. Mainnet not required. |
| ≥1 Stellar protocol / ecosystem integration | Stellar accounts + Horizon API + (ecosystem) **Nym MixFetch** for transport. |
| Meaningful technical work + problem / user / value | Documented in this README; MixFetch offscreen runtime + fail-closed Stellar adapter. |

### Thematic track: Stellar Composed

> *Stellar’s building blocks are yours to compose.*

Astrym composes **Stellar** (accounts, Horizon, Testnet payments) with **Nym MixFetch** (mixnet HTTPS) into a wallet neither piece delivers alone: Stellar value movement with **network-metadata protection** on the API path.

| Building block | Role in Astrym |
| --- | --- |
| **Stellar Testnet + Horizon** | Balances, Friendbot, transfer stack. |
| **Nym MixFetch (`@nymproject/mix-fetch`)** | Mixnet egress for compatible Stellar HTTPS when mode = `nym`. |
| **Chrome MV3 offscreen + SW** | Hosts MixFetch WASM; orchestrates Connect / fail-closed routing. |

We are **not** positioning primarily as Stellar Unlocked (new core-protocol ZK/host-function breakthrough). Our thesis is **composition**: Stellar + mixnet transport (+ optional private-payment ecosystem paths as the product expands).

### Event requirements (checklist)

| Requirement | Status in this repo |
| --- | --- |
| Public GitHub with source | This repository |
| README: summary, problem, setup, env, demo | This file |
| Architecture: how Stellar is used | [Architecture](#architecture) |
| Live demo / video / URL for judges | See [Demo](#demo-for-judges) |
| Onchain Testnet evidence where applicable | Horizon / transfer flows on Testnet (see demo) |
| Disclose prior vs hackathon work | See [Prior work & hackathon scope](#prior-work--hackathon-scope) |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Popup (React) — unlock, dashboard, send, Nym panel         │
└───────────────────────────┬─────────────────────────────────┘
                            │ IPC (typed schemas)
┌───────────────────────────▼─────────────────────────────────┐
│  Service Worker                                             │
│  • Vault / KeyManager / StellarReadClient / Tx clients      │
│  • NymRuntimeController + FailClosedTransportRouter         │
│  • Stellar fetch adapter (logical URL → effective MixFetch) │
└───────────────┬─────────────────────────────┬───────────────┘
                │                             │
                │ mode=direct                 │ mode=nym (fail-closed)
                ▼                             ▼
         clearnet fetch              Offscreen MixFetch
                                     (@nymproject/mix-fetch)
                                              │
                                              ▼
                                      Nym mixnet → Horizon
```

### How Stellar is used

| Concern | Implementation |
| --- | --- |
| Accounts | Stellar HD paths (`m/44'/148'/…`), `StellarAccountService` |
| Reads | `StellarReadClient` → Horizon (`getBalance`, Friendbot fund) |
| Writes / transfers | `StellarTransactionClient` (Testnet passphrase; extension send flow) |
| Network | Stellar **Testnet** Horizon / Friendbot by default |
| Privacy transport | When Nym mode is on, compatible Horizon HTTPS goes through MixFetch |

### Nym + Horizon policy (important)

- **Logical URL**: what the product intends (e.g. SDF Testnet Horizon).
- **Effective URL**: what MixFetch actually fetches after a **documented, allowlisted** remap (SDF-hosted Horizon has been unreliable through MixFetch in live runs; a public Horizon-compatible base is the default effective target).
- **Fail-closed**: MixFetch failure → visible error. No automatic DirectTransport / native `fetch` fallback in Nym mode.
- Nym protects **network metadata**. It does **not** by itself hide data already public on the Stellar ledger.

### Packages

| Package | Role |
| --- | --- |
| `packages/extension` | MV3 Chrome extension (popup, SW, offscreen Nym, SPP host page) |
| `packages/wallet-core` | Vault, signing, Stellar/Solana clients, Nym transport policy types |

---

## Setup

### Prerequisites

- **Node.js** 20+ recommended  
- **pnpm** 9+  
- **Google Chrome** (for loading the unpacked extension)  
- Git  

### Install

```bash
git clone https://github.com/MTheMoneyApe/Astrym-Wallet.git
cd Astrym-Wallet
pnpm install
```

### Build (extension)

```bash
# Full package build (includes SPP asset copy when present)
pnpm --filter @solanym/extension build

# Nym-focused build used during MixFetch development
pnpm --filter @solanym/extension build:nym-dev
```

Output: `packages/extension/dist/`

### Android / webapp

```bash
pnpm dev:webapp
```

On the phone (same Wi-Fi): `http://<lan-ip>:5173/webapp.html`. The site root (`index.html`) is the Astrym landing page; the wallet is `webapp.html`.

**Deploy:** Vercel is the primary host (root domain, WASM headers). Import the repo; `vercel.json` runs `pnpm build:webapp` and publishes `packages/extension/dist-webapp`. GitHub Pages is the fallback: `.github/workflows/deploy-pages.yml` publishes the same folder with relative URLs, so it also works under `/Astrym-Wallet/`.

`pnpm build:webapp` writes `packages/extension/dist-webapp/` for an installable PWA (`display: standalone`, theme `#191A1C`, accent `#3CE894`). MixFetch runs in the page; Chrome extension APIs are not required. Full steps (Spanish): [docs/android-webapp.md](docs/android-webapp.md).

The extension popup button **Modo Android** opens the same UI in a full tab that still shares the extension service worker.

### Load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select `packages/extension/dist`
4. Open the Astrym popup from the toolbar

### Environment variables

Most hackathon demos need **no** secrets in the repo. Optional / advanced:

| Variable | Where | Purpose |
| --- | --- | --- |
| `VITE_NYM_LIVE_SMOKE_AUTHORIZED` | Extension build | Gates authorized live `createMixFetch` smoke (default off) |
| `CHROME_PATH` | CDP harness scripts | Override Chrome binary for automated MixFetch probes |
| `NYM_STELLAR_PROBE_TIMEOUT_MS` | CDP harness | Horizon probe timeout |

**Never commit** `.env`, seeds, vault backups, or private keys.

### Tests

```bash
pnpm --filter @solanym/wallet-core test
pnpm --filter @solanym/extension test
```

---

## Demo for judges

### A. Wallet + Stellar Testnet (UI)

1. Build and load the extension (`build` or `build:nym-dev`).
2. Create / unlock a **disposable Testnet** vault.
3. Note the `G…` address on the dashboard.
4. Fund via Friendbot (UI) or `https://friendbot.stellar.org/?addr=G…`.
5. Confirm balance against Horizon Testnet.
6. (Optional) Send a small Testnet XLM transfer and show the confirmation / Horizon tx.

### B. Stellar HTTPS via Nym MixFetch

1. In the Nym panel: configure a verified gateway (identity key + WSS allowlist), grant host permission, **Connect**.
2. Wait until MixFetch reports **Ready** (`connected`).
3. Run **Probe Horizon via Nym**.
4. Confirm the UI shows:
   - transport `nym`
   - HTTP 200 HAL/`fee_stats` (or equivalent public Horizon JSON)
   - **logical** vs **effective** Horizon URLs when remapped
5. Optional automation (local):

```bash
pnpm --filter @solanym/extension build:nym-dev
node packages/extension/scripts/nym-stellar-horizon-cdp-harness.mjs
```

### C. Video / public URL

Provide judges with a short walkthrough video of (A)+(B) and, if a hosted demo page is published, its public URL on the submission form.

---

## Prior work & hackathon scope

**Disclose for HackMeridian:** base wallet / vault / extension scaffolding may predate the event. **Hackathon-focused work** centers on:

- Stellar ↔ **Nym MixFetch** exclusive transport integration  
- Fail-closed router + offscreen MixFetch runtime  
- Explicit logical vs effective Horizon configuration  
- Live Testnet / MixFetch validation harnesses  
- Astrym branding and submission packaging  

Existing Solana paths in the monorepo are **out of scope** for the Astrym Stellar+Nym product narrative.

---

## Security notes

- Keys and seeds never enter the MixFetch / offscreen network runtime.
- Prefer disposable Testnet vaults for demos.
- Treat Friendbot funds as disposable.
- Review gateway allowlists before Connect; permission grant ≠ Mixnet Ready.

---

## License & contact

Private repository during development; follow HackMeridian participation and submission rules for disclosure and conduct.

**Team / contact:** via the HackMeridian team page linked to [Astrym-Wallet](https://github.com/MTheMoneyApe/Astrym-Wallet).
