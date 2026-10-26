# Copilot instructions for Solanym Wallet

## Project overview

This repository is a pnpm workspace with two main packages:

- `packages/wallet-core`: the reusable core library. This is where cryptography, vault lifecycle logic, key derivation, account storage, and Solana RPC/transaction logic live.
- `packages/extension`: the Manifest V3 browser extension. This package owns the popup UI, background message routing, Chrome storage adapters, dApp approval flows, and the offscreen Nym transport used for privacy-oriented RPC calls.

The extension composes `@solanym/wallet-core` services instead of re-implementing wallet logic. Most behavior changes should start in the shared library unless they are strictly Chrome-extension or UI concerns.

## Build, test, lint, and typecheck

Run these from the repository root:

- `pnpm install`
- `pnpm build` - runs the workspace build. In practice this compiles `wallet-core` with `tsc` and bundles the extension with Vite.
- `pnpm test` - runs all Vitest suites in every package.
- `pnpm lint` - runs ESLint in packages that define a lint script; the core package currently includes the lint workflow.
- `pnpm typecheck` - runs TypeScript checks across the workspace.

Single-test commands:

- `pnpm --filter @solanym/wallet-core exec vitest run tests/crypto/mnemonic.test.ts`
- `pnpm --filter @solanym/wallet-core exec vitest run tests/solana/TransactionClient.sign.test.ts`
- `pnpm --filter @solanym/extension exec vitest run tests/popup/Dashboard.test.tsx`
- `pnpm --filter @solanym/extension exec vitest run tests/background/handlers/transactionHandlers.test.ts`

For a single file in a package, prefer the `vitest run <path-to-test-file>` form above instead of running the full suite. The extension package also uses Vite to build popup, offscreen, content, and provider bundles; the Nym worker preparation step is handled by `pnpm --filter @solanym/extension run prepare-nym` when needed.

## High-level architecture

The repository is organized around a clear split between portable wallet logic and browser-extension integration:

- `packages/wallet-core/src/vault/`: vault lifecycle, password-based unlocker, encrypted blob storage, and session-based key caching. The `VaultService` is the central state machine: it keeps mnemonic contents only in service-worker memory, never writes plaintext to persistent storage, and uses auto-lock via the alarm service.
- `packages/wallet-core/src/keyManager/`: account derivation, storage, and idempotency logic. The `KeyManager` intentionally persists account state and tracks creation intents to avoid duplicate account creation across restarts.
- `packages/wallet-core/src/solana/`: RPC clients, read clients, transaction building, and validation. This is the core Solana integration layer used by the extension.
- `packages/extension/src/background/`: the extension runtime entrypoint. `background/index.ts` wires together the vault service, signer, key manager, network config, and RPC clients, then registers all message handlers and async initialization paths.
- `packages/extension/src/popup/`: React UI that talks to background via the message router and IPC types. Keep feature logic in the background layer and keep UI components focused on rendering and user approvals.
- `packages/extension/src/content/` and `src/provider/`: dApp-facing bridge and provider code. The extension handles dApp permission and signing requests through the router and approval flows.
- `packages/extension/src/background/transport/OffscreenNymTransport.ts`: the privacy-oriented transport bridge; it is used in the background bootstrap and is intentionally strict about which RPC methods it allows.

When investigating a feature, start with the service composition in `background/index.ts` and then follow the related handler and core service files; this reveals the real call chain across packages much faster than reading a single file in isolation.

## Key conventions and repository-specific patterns

- Prefer shared logic in `packages/wallet-core` for anything that is not explicitly extension- or browser-specific. UI code should not duplicate cryptographic, account, or transaction logic.
- Treat the extension package as a Chrome MV3 integration layer. Use browser storage separation intentionally: `chrome.storage.local` for persistent encrypted vault blobs, `chrome.storage.session` for transient key material, and keep decrypted mnemonic state in memory only.
- Keep message routing in `src/background/MessageRouter.ts` and registered handlers under `src/background/handlers/`. Do not bypass the router for runtime actions that are meant to be centrally validated and coordinated.
- Follow the repository’s vault and account lifecycle patterns rather than introducing ad hoc state handling:
  - `VaultService` owns lock/unlock, auto-lock, and state transitions.
  - `KeyManager` owns account creation/renaming and idempotency mapping.
  - `ActiveAccountManager` and `stateCoordinator` are part of the extension’s runtime state model.
- Test files are colocated with the package under `tests/` and use Vitest. Favor package-local tests over broad integration suites when validating a specific change.
- The workspace uses pnpm workspaces and package aliases such as `@solanym/wallet-core`. Do not assume relative imports are the only supported pattern inside the monorepo.
- Because the extension is a browser extension, do not treat background service worker limitations as an afterthought. The architecture explicitly includes offscreen document handling and alarm-based lock scheduling for MV3.
- The repo has a patched dependency for Nym transport (`pnpm-workspace.yaml` includes `patchedDependencies` for `@nymproject/mix-tunnel`). If you are touching Nym or transport flows, keep that patching and the offscreen worker setup in mind.

## Notes for future Copilot sessions

- The repository includes a release audit in `RELEASE_READINESS.md`; if a local check is failing in a way that matches the documented project status, treat that as a known repo-specific issue rather than a generic regression.
- Keep changes scoped to the relevant package unless a cross-package change is required by the feature boundary.
- When editing runtime behavior in the extension, validate the nearest affected test file first; prefer the smallest command that checks the changed behavior.
