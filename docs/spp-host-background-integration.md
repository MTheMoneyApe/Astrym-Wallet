# Fase 8 — SPP Host ↔ Background Integration

## Execution-context architecture (verified)

```
┌──────────────────────────┐         chrome.runtime messages          ┌─────────────────────────────┐
│ MV3 Service Worker       │◄────────────────────────────────────────►│ spp-host.html (extension    │
│ - Nym gate / MixFetch    │   SPP_HOST_EXECUTE / LIFECYCLE (JSON)    │   page / separate JS realm) │
│ - authorize payments     │                                           │ - load spp/js/index.js      │
│ - sppPrivatePoolRegistry │   ✗ cannot share WASM objects            │ - init WASM + OPFS Storage  │
│ - HostPoolProxy (RPC)    │                                           │ - SppSession (RO Client)    │
└──────────────────────────┘                                           │ - optional write PrivatePool│
                                                                       └─────────────────────────────┘
```

**Boundary rule:** `PrivatePool`, `Client`, `Storage`, and workers are page-local.
They cannot be registered into the SW as live object references. The SW holds either
a test double or a **HostPoolProxy** that RPCs into the host.

## Lifecycle trace

| Step | Where | What runs |
| --- | --- | --- |
| 1. WASM load | `spp-host` `probe()` → `loadSppSdkFacade` → `initializeWasm()` | facade `default({ module_or_path })` |
| 2. Session construct | `constructAndAttachUninitializedSession` | `new SppSession` — **no** init |
| 3. Session initialize | `initializeBoundSessionForNym(true)` | `createReadOnlyClient`: initWasm + `Storage.open` + `Client.new` → RO only |
| 4. PrivatePool create | **Not wired yet** | SDK requires `Client.account(opts, WalletSigner)` → `derivePrivacyKeys()` → `account.pool({ poolContract })` |
| 5. SW registration | `noteSppHostLifecycle` / `registerSppPrivatePool` | lifecycle JSON or local proxy/double |
| 6. Payment | popup → `SPP_PRIVATE_PAYMENT` → SW | Nym gate → probe Soroban via Nym → pool.deposit/transfer/withdraw |
| 7. Invalidate | `NYM_DISCONNECT`, `clearBoundSession`, host dispose | `clearSppPrivatePool` + host `clearSppHostWritePool` |

## SDK methods verified in source (`stellar-private-payments@0.2.1`)

From `js/types/api-types.d.ts` + `crates/stellar_private_payments_web.d.ts` + README:

- `Client.new(options)`
- `Client.aspState` / `allContractsData` / `dispose` (RO session uses these)
- `Client.account(AccountOptions, WalletSigner) → Account`
- `Account.pool({ poolContract }) → PrivatePool`
- `Account.derivePrivacyKeys()`
- `PrivatePool.deposit(amount: bigint)`
- `PrivatePool.transfer(recipient, amount)`
- `PrivatePool.withdraw(amount, recipient?)`
- `PrivatePool.balance()` / `notes()` / `estimate()`
- `PoolExecuteResult.hashes: string[]` (not a single `txHash` field)

`SppSession` **intentionally omits** `account()` / mutators. RO ready ≠ write ready.

## Remaining blockers for genuine Testnet deposit/transfer/withdraw

1. Retain a full `Client` in spp-host (not only the RO wrapper).
2. WalletSigner IPC: host must request signatures from the SW vault (`SppWalletSignerAdapter` + contextual gate) without shipping secrets to the host.
3. Call `derivePrivacyKeys()` then `account.pool({ poolContract })` and `registerSppHostWritePool`.
4. Ensure Soroban RPC from the SDK uses Nym (scoped fetch / no silent clearnet). Proving keys (~272MB) required for real proofs in extension builds; web profile omits them.
5. Live Testnet evidence with disposable keys — **not claimed** in this phase.
6. **Deposit Soroban resource-fee policy (2026-11-05):** see section below.

## Deposit fee policy & persistent rent (2026-11-05)

Evidence: `/opt/cursor/artifacts/deposit/` (prepare packet + `fee-opt/FEE-OPTIMIZATION-REPORT.md`).

| Item | Value |
| --- | --- |
| Policy ceiling `deposit` | **8_000_000** stroops (unchanged; not raised) |
| Observed successful sim `minResourceFee` | **≈ 8_718_236** stroops |
| Fingerprint (unsigned 2.0 XLM XDR) | `8983d1dfee435b4a056915e61cc5a20cc75df6f43bda359a89df78e6432c3044` |
| Dominant cost | ~99.6% residual **persistent rent** / events / historical |

### Storage writes (Nethermind pool `transact`)

Protocol-required persistent/instance writes on deposit (from sim footprint + upstream sources):

1. **2×** `DataKey::Nullifier(n)` — `pool.rs` `mark_spent` → `persistent().set` (double-spend prevention).
2. **1×** `MerkleDataKey::State` rewrite + `extend_persistent` — `merkle_with_history.rs` `insert_two_leaves` (commitment tree + 90-root history).
3. Pool **instance** totals — `totals::record` (notes/fees).
4. Sender account + native SAC balance — token `transfer` of `ext_amount` (note + 0.1 XLM pool fee).

Commitments are **not** separate ledger rows; encrypted outputs are **events** only.

### Optimization conclusion

- Client-side assemble/footprint/fee-declaration tricks: **0** safe savings (fee-opt experiments A–F).
- Reducing rent requires **upstream** pool/Merkle/TTL redesign + migration + new sims — not Astrym wallet changes.
- Do **not** move nullifiers to temporary storage (double-spend after expiry).
- Do **not** split `TreeState` (explicitly rejected upstream for sim/race stability).

### Wallet enforcement

- Global mutator / registration / deposit-scoped gates remain **OFF** by default.
- `SPP_PROPOSED_MAX_FEE_STROOPS.deposit` stays **8_000_000**.
- Deposits are blocked with `FEE_POLICY_EXCEEDED` / UI copy that this is a **network resource-fee policy** block, **not** a Nym or wallet connection failure (`sppFeePolicy.ts`, `sppNymOption.ts`, `privatePaymentRouter.ts`, `SppPrivateSend.tsx`).

## Privacy / failure handling

- No clearnet fallback in Nym mode (SW uses `getStellarFetch()` / MixFetch fail-closed).
- Default payment path uses `preferInjectedTransport: true` (no `globalThis.fetch` mutation).
- Nym disconnect clears SW registry and broadcasts host clear.
- Missing write pool → `SESSION_NOT_READY` (not a fake success).
- Host WASM/adapter throw → `EXECUTION_FAILED` with sanitized message.
