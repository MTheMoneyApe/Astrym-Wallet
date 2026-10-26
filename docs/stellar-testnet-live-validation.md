# Stellar Testnet — live validation of public XLM transfers

This document distinguishes **mocked unit/integration tests** from a **real Testnet** proof.

| Kind | What it proves | Network |
|------|----------------|---------|
| Default Vitest (`pnpm --filter @solanym/wallet-core test`, extension suite) | Logic with **mocked** Horizon/`fetch` | Offline |
| Manual procedure below | End-to-end through the **extension UI** (vault + IPC + Horizon) | Horizon Testnet |
| Optional smoke `stellarTestnetLive.smoke.test.ts` | Production clients against live Horizon; **read / fund / send gated separately** | Horizon Testnet |

**This does not demonstrate on-chain privacy.** Classic `payment` / `createAccount` operations publish source, destination, amount, and memo on the public ledger.

## Safety rules

- Use **Testnet only** (`horizon-testnet.stellar.org`, Friendbot). Never Mainnet.
- Never paste seed phrases or private keys into chat, tickets, or CI logs.
- Do **not** run Friendbot or live send until an explicit human authorization after reviewing this procedure.
- Discard or lock the Testnet vault when finished; treat Friendbot funds as disposable.

## Production entry points (verified in code)

| Step | Extension IPC | Core implementation |
|------|---------------|---------------------|
| Balance | `GET_STELLAR_BALANCE` | `StellarReadClient.getBalance` → Horizon Testnet |
| Friendbot | `FUND_STELLAR_TESTNET_ACCOUNT` | `StellarReadClient.fundTestnetAccount` |
| Estimate / review | `ESTIMATE_STELLAR_TRANSFER` / `REVIEW_STELLAR_TRANSFER` | `StellarTransactionClient.reviewXlmTransfer` |
| Send | `SEND_STELLAR_TRANSFER` | `consumeReview(…,'stellar')` → `sendXlm` → Horizon `submitTransaction` |
| Confirm | `CONFIRM_STELLAR_TRANSFER` | `StellarTransferConfirmationTracker` / `confirmTransaction` |

Signer path: `SoftwareSigner(vault, 'stellar')` with HD path `m/44'/148'/{index}'`. Network passphrase defaults to Stellar **TESTNET** in `StellarTransactionClient`.

## Manual procedure (preferred E2E)

Requires a built extension loaded in Chrome (`pnpm --filter @solanym/extension build`).

1. Create or unlock a **disposable Testnet** vault in the popup (do not reuse a Mainnet-capable secret).
2. Note the active account **G…** address (Dashboard). Do not export the seed unless required for recovery of this throwaway vault.
3. Fund via UI / Friendbot (`FUND_STELLAR_TESTNET_ACCOUNT`) or https://friendbot.stellar.org/?addr=G…
4. Confirm balance via UI (`GET_STELLAR_BALANCE`) matches Horizon:
   - `https://horizon-testnet.stellar.org/accounts/G…`
5. Open **Send** (Stellar), enter a **Testnet** destination `G…`, amount ≥ 1 XLM if the destination is unfunded (`createAccount`), optional memo ≤ 28 bytes.
6. Review the estimate (fee, reserve, operation type), then confirm send.
7. Wait for confirmation in UI / notification. Record:
   - `txHash`
   - final status (`CONFIRMED` / `FAILED` / `UNKNOWN`)
   - source and destination balances after settlement
8. **Acceptance:** open `https://horizon-testnet.stellar.org/transactions/{txHash}` and verify `successful: true`. Only then is a public Testnet transfer **demonstrated**.

### Report template (no secrets)

```text
Date (UTC):
Operator:
Source G… (public):
Destination G… (public):
Amount XLM:
Memo present (yes/no):
txHash:
Horizon successful:
Pre-balance source / dest:
Post-balance source / dest:
Notes / errors:
Privacy claim: none (public ledger)
```

## Optional automated smoke (wallet-core)

**Disabled by default.** Offline `vitest run` skips all live describes.

```powershell
# Read-only: Horizon getBalance only. Requires a public G… address.
# Does NOT call Friendbot or submit transactions.
$env:SOLANYM_TESTNET_LIVE = '1'
$env:SOLANYM_TESTNET_READ_ADDRESS = 'G...'   # Testnet public address you control or know
Remove-Item Env:SOLANYM_TESTNET_LIVE_FUND -ErrorAction SilentlyContinue
Remove-Item Env:SOLANYM_TESTNET_LIVE_SEND -ErrorAction SilentlyContinue
pnpm --filter @solanym/wallet-core exec vitest run tests/stellar/stellarTestnetLive.smoke.test.ts

# Friendbot fund (writes Testnet state) — ONLY after explicit authorization.
$env:SOLANYM_TESTNET_LIVE = '1'
$env:SOLANYM_TESTNET_LIVE_FUND = '1'
pnpm --filter @solanym/wallet-core exec vitest run tests/stellar/stellarTestnetLive.smoke.test.ts

# Submit a real Testnet payment — ONLY after explicit human authorization.
$env:SOLANYM_TESTNET_LIVE = '1'
$env:SOLANYM_TESTNET_LIVE_SEND = '1'
pnpm --filter @solanym/wallet-core exec vitest run tests/stellar/stellarTestnetLive.smoke.test.ts
```

- **Read** uses only `StellarReadClient.getBalance`.
- **Fund** uses Friendbot (`fundTestnetAccount`) on an ephemeral vault-derived address.
- **Send** uses production `VaultService` → `SoftwareSigner('stellar')` → `StellarTransactionClient.sendXlm` (not a Keypair.sign bypass). It refuses Mainnet Horizon URLs and the public network passphrase.

## Activation matrix

| `LIVE` | `READ_ADDRESS` | `LIVE_FUND` | `LIVE_SEND` | Behavior |
|--------|----------------|-------------|-------------|----------|
| unset | any | any | any | Offline guards only; **no network** |
| `1` | missing/invalid | unset | unset | Read describe runs but **fails** before fetch (address required) |
| `1` | valid `G…` | unset | unset | **Read-only** `getBalance` on Horizon Testnet |
| `1` | any | `1` | unset | Friendbot fund + balance (write) |
| `1` | any | any | `1` | Real submit + confirm (write); may also Friendbot-fund source |

Env var names:

- `SOLANYM_TESTNET_LIVE`
- `SOLANYM_TESTNET_READ_ADDRESS`
- `SOLANYM_TESTNET_LIVE_FUND`
- `SOLANYM_TESTNET_LIVE_SEND`

## What remains experimental

- Any “private payment”, shielded pool, or confidential-token flow — **not implemented** in this repository.
- CI green without these env vars does **not** prove a Testnet transfer (or even a live Horizon read) occurred.
