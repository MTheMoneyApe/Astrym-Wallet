# PROMOTE-REPORT

Ticket T-PROMOTE-MIX. Prep only. This branch is `astrym/promote-candidate`, built from dev tip `303504927a5bbef12c9b49df6adaac7ae80edd10` (`astrym/testnet-mvp`).

Master tip compared: `01c7cc6c9f556baee09ddd8272a51db389e6b7cc`.

Nothing here was pushed to `master`. No deploy. No force-push. The promotion commands in the last section were not run. WIP `15b50bca` (`wip/spp-disposable-signer`) was not touched.

## History

The tips are not unrelated. Both histories start at `5a75b5900544b6ae9c356cc5a59fc8a253e7f9ad` and share merge-base `bfc11dd975a477e4cfb0c9d2b5d2bb3ebdf9a86e`.

Master is three commits ahead of that base: `c110b6d` (public landing), `e670426` (test-surface copy), `01c7cc6` (webapp on `/webapp.html`, 157 files). Dev is 372 commits ahead of the base. Since the base, 92 paths were added on both sides, which is the add/add set a merge would conflict on. A content merge was not performed.

## Counts

| Category | Count | Choice |
| --- | ---: | --- |
| only-in-master | 6 | skip 6 |
| only-in-dev | 79 | dev 79 |
| both-differ | 97 | dev 96 · merged 1 |
| choice dev | 175 | kept the dev blob |
| choice master | 0 | took the master blob |
| choice merged | 1 | dev blob plus master prod flags |
| choice skip | 6 | obsolete master-only files left out |

## Invariants kept

- Self-hosted fonts. `packages/extension/index.html`, `webapp.html`, and `public/website.css` stay on the dev side. No `fonts.googleapis.com` or `fonts.gstatic.com`.
- Router default-deny. `MessageRouter.ts` keeps `senderMayCallInternalRoute`. Master's copy would allow every internal route once the sender is internal.
- Gates stay default-closed. No gate file was edited. Broadcast and signing paths were not exercised.
- `vercel.json` `buildCommand` stays `pnpm build:webapp`. `build:webapp:vercel` was not added.
- Vendored pinned wasm under `vendor/spp-canonical/` stays. It exists only on dev.
- Download headers and the mv3 zip rewrite stay. They are on dev and absent on master.
- `git.deploymentEnabled` stays off for every branch except `master`.

## Decisions

| File | Choice | Reason |
| --- | --- | --- |
| `public/brand/astrym-logo.png` | skip | Byte-identical to `packages/extension/public/brand/astrym-logo.png` (blob acbf1050), which dev already ships. Only the obsolete public landing referenced this path. |
| `public/brand/astrym-symbol.png` | skip | Same blob acbf1050 as the logo already in the extension tree. No distinct prod asset. |
| `public/index.html` | skip | Superseded landing. Dev's reviewed page is `packages/extension/index.html`, copied into the webapp output by `copy-canonical-landing.mjs` (HackMeridian copy, self-hosted fonts, tests). Overlaying this file would replace that page. |
| `public/site.js` | skip | ES/EN strings for the superseded public landing. Not wired into the dev build, and copying it in would not be served. |
| `public/styles.css` | skip | System-ui sheet for the superseded landing. Using it would drop self-hosted `@font-face` fonts. It does not use Google Fonts, but it is not the reviewed stylesheet. |
| `scripts/assemble-vercel-site.mjs` | skip | Copies `public/` over `dist-webapp` and would replace the canonical landing. Only `build:webapp:vercel` calls it, and that must not become `buildCommand`. |
| `.cursor/skills/karpathy-guidelines/SKILL.md` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `.cursor/skills/token-saver/SKILL.md` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `.gitattributes` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `.github/CODEOWNERS` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `.github/ci/t9-check.sh` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `.github/ci/t9-delta-job.sh` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `.github/ci/t9-delta-selftest.mjs` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `.github/ci/t9-delta.mjs` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `.github/ci/t9-fingerprint.mjs` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `.github/workflows/spp-webapp-build.yml` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `.github/workflows/t9-regression.yml` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `HANDOFF.md` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `packages/extension/public/fonts/instrument-sans/OFL.txt` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `packages/extension/public/fonts/instrument-sans/instrument-sans-latin.woff2` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `packages/extension/public/fonts/jetbrains-mono/OFL.txt` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `packages/extension/public/fonts/jetbrains-mono/jetbrains-mono-latin-500.woff2` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `packages/extension/public/fonts/orbitron/OFL.txt` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `packages/extension/public/fonts/orbitron/orbitron-latin.woff2` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `packages/extension/scripts/copy-canonical-landing.mjs` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `packages/extension/src/background/handlers/sppKeyDerivationApprovalHandler.ts` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `packages/extension/src/background/handlers/sppStorageUnlockApprovalHandler.ts` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `packages/extension/src/background/spp/sppBoundAccount.ts` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `packages/extension/src/background/spp/sppSubmissionReconcile.ts` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `packages/extension/src/popup/privacyIndicator.tsx` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `packages/extension/src/shared/nymPrivacyPreference.ts` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `packages/extension/src/shared/nymRuntimeStatus.ts` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `packages/extension/src/shared/txTransportHistory.ts` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `packages/extension/src/spp-host/sppHostFeeScope.ts` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `packages/extension/src/spp-host/sppStorageKeyProvider.ts` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `packages/extension/src/website/i18n.ts` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `packages/extension/tests/background/MessageRouter.internalSenderAllowlist.test.ts` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `packages/extension/tests/background/handlers/nymHandlers.test.ts` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `packages/extension/tests/background/handlers/sppStorageUnlockApprovalHandler.test.ts` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `packages/extension/tests/background/nym/NymPrivacyDurableEcho.test.ts` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `packages/extension/tests/background/nym/NymPrivacyPersistence.test.ts` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `packages/extension/tests/background/nym/NymPrivacyRaces.test.ts` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `packages/extension/tests/background/spp/sppHostBridgeHandlers.simulate.test.ts` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `packages/extension/tests/background/spp/sppPartialHashPipeline.test.ts` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `packages/extension/tests/background/spp/sppSignGate.test.ts` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `packages/extension/tests/background/spp/sppSubmissionReconcile.test.ts` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `packages/extension/tests/popup/App.test.tsx` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `packages/extension/tests/popup/SppAccountPanel.test.tsx` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `packages/extension/tests/popup/nymRuntimeStatus.test.ts` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `packages/extension/tests/popup/privacyIndicator.test.tsx` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `packages/extension/tests/spp-host/sppAssetPins.test.ts` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `packages/extension/tests/spp-host/sppBuiltRuntime.test.ts` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `packages/extension/tests/spp-host/sppCanonicalArtifact.test.ts` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `packages/extension/tests/spp-host/sppHostAutoPrepareOnLoad.test.ts` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `packages/extension/tests/spp-host/sppHostBridgeListener.test.ts` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `packages/extension/tests/spp-host/sppHostFonts.test.ts` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `packages/extension/tests/spp-host/sppHostWritePoolFactory.test.ts` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `packages/extension/tests/spp-host/sppStorageKeyProvider.test.ts` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `packages/extension/tests/webapp/privacyCrossInstance.test.ts` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `packages/extension/tests/webapp/privacyStaleForeignNotice.test.ts` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `packages/wallet-core/src/stellar/spp/nethermind/spp-runtime-manifest.json` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `packages/wallet-core/src/stellar/spp/sppPaymentIdentityChecks.ts` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `packages/wallet-core/src/stellar/spp/sppSignGate.ts` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `packages/wallet-core/src/stellar/spp/sppStorageUnlockGate.ts` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `packages/wallet-core/tests/security/sppTestSeamInvariant.test.ts` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `packages/wallet-core/tests/stellar/spp/seams/runSppProbedPoolPayment.ts` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `packages/wallet-core/tests/stellar/spp/seams/sppPaymentIdentityChecks.ts` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `packages/wallet-core/tests/stellar/spp/seams/sppProbeEconomicsBypass.ts` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `packages/wallet-core/tests/stellar/spp/sppSignGate.test.ts` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `packages/wallet-core/tests/stellar/spp/sppStorageUnlockGate.test.ts` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `packages/wallet-core/tests/stellar/spp/sppUnresolvedSubmission.test.ts` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `scripts/prepare-spp-runtime.sh` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `scripts/spp-distributed-sha256.py` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `scripts/spp-wasm-sections-fb3481af.txt` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `scripts/spp-wasm-sections.py` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `scripts/verify-spp-canonical-artifact.mjs` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `vendor/spp-canonical/8280c686ffc2d55c06a23aec92defb3e21850dd695bcb47a69ac45018b721027/canonical-artifact.json` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `vendor/spp-canonical/8280c686ffc2d55c06a23aec92defb3e21850dd695bcb47a69ac45018b721027/prover-worker-module.js` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `vendor/spp-canonical/8280c686ffc2d55c06a23aec92defb3e21850dd695bcb47a69ac45018b721027/prover-worker-module_bg.wasm` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `vendor/spp-canonical/8280c686ffc2d55c06a23aec92defb3e21850dd695bcb47a69ac45018b721027/prover-worker.js` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `vendor/spp-canonical/8280c686ffc2d55c06a23aec92defb3e21850dd695bcb47a69ac45018b721027/stellar_private_payments_web.js` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `vendor/spp-canonical/8280c686ffc2d55c06a23aec92defb3e21850dd695bcb47a69ac45018b721027/stellar_private_payments_web_bg.wasm` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `vendor/spp-canonical/8280c686ffc2d55c06a23aec92defb3e21850dd695bcb47a69ac45018b721027/storage-worker-module.js` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `vendor/spp-canonical/8280c686ffc2d55c06a23aec92defb3e21850dd695bcb47a69ac45018b721027/storage-worker-module_bg.wasm` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `vendor/spp-canonical/8280c686ffc2d55c06a23aec92defb3e21850dd695bcb47a69ac45018b721027/storage-worker.js` | dev | Only on dev. The candidate is built from the dev tip, so this file stays. |
| `.gitignore` | dev | Master deletes the `.cache/` ignore that `scripts/prepare-spp-runtime.sh` needs. Not prod content. |
| `package.json` | dev | Master's only addition is `build:webapp:vercel`, which runs the obsolete public-landing overlay. `buildCommand` stays `pnpm build:webapp`. |
| `packages/extension/index.html` | dev | The only master hunk is a Google Fonts stylesheet (`fonts.googleapis.com`). Self-hosted fonts stay. |
| `packages/extension/package.json` | dev | Master drops `copy-canonical-landing` from `build:webapp` and drops `jsdom`. That would skip the reviewed landing and the self-hosted font copy. |
| `packages/extension/public/website.css` | dev | Master deletes the six self-hosted `@font-face` rules. |
| `packages/extension/scripts/copy-spp-assets.mjs` | dev | Master's copy is the older snapshot inside 01c7cc6, not prod-only landing copy, assets, config, or download headers. Dev is the reviewed tree. |
| `packages/extension/scripts/smoke-spp-assets.mjs` | dev | Untouched by the three master-only commits. The difference is dev work after merge-base bfc11dd. Master has no newer prod hunk here. |
| `packages/extension/spp-host.html` | dev | Master's copy is the older snapshot inside 01c7cc6, not prod-only landing copy, assets, config, or download headers. Dev is the reviewed tree. |
| `packages/extension/src/background/MessageRouter.ts` | dev | Master drops `senderMayCallInternalRoute` and would let any internal sender call every route. Default-deny stays. |
| `packages/extension/src/background/handlers/accountHandlers.ts` | dev | Untouched by the three master-only commits. The difference is dev work after merge-base bfc11dd. Master has no newer prod hunk here. |
| `packages/extension/src/background/handlers/nymHandlers.ts` | dev | Master's copy is the older snapshot inside 01c7cc6, not prod-only landing copy, assets, config, or download headers. Dev is the reviewed tree. |
| `packages/extension/src/background/handlers/sppAccountHandlers.ts` | dev | Master's copy is the older snapshot inside 01c7cc6, not prod-only landing copy, assets, config, or download headers. Dev is the reviewed tree. |
| `packages/extension/src/background/handlers/sppPrivatePaymentHandler.ts` | dev | Master's copy is the older snapshot inside 01c7cc6, not prod-only landing copy, assets, config, or download headers. Dev is the reviewed tree. |
| `packages/extension/src/background/handlers/vaultHandlers.ts` | dev | Master starts SPP auto-prepare on unlock. That is not landing copy, assets, or prod config, and it would run prepare with gates still closed. |
| `packages/extension/src/background/index.ts` | dev | Master's copy is the older snapshot inside 01c7cc6, not prod-only landing copy, assets, config, or download headers. Dev is the reviewed tree. |
| `packages/extension/src/background/nym/NymRuntimeController.ts` | dev | Master's copy is the older snapshot inside 01c7cc6, not prod-only landing copy, assets, config, or download headers. Dev is the reviewed tree. |
| `packages/extension/src/background/nym/OffscreenMixFetchBridge.ts` | dev | Master's copy is the older snapshot inside 01c7cc6, not prod-only landing copy, assets, config, or download headers. Dev is the reviewed tree. |
| `packages/extension/src/background/nym/stellarTransportFetch.ts` | dev | Untouched by the three master-only commits. The difference is dev work after merge-base bfc11dd. Master has no newer prod hunk here. |
| `packages/extension/src/background/spp/sppAutoPrepare.ts` | dev | Master's copy is the older snapshot inside 01c7cc6, not prod-only landing copy, assets, config, or download headers. Dev is the reviewed tree. |
| `packages/extension/src/background/spp/sppHostBridgeHandlers.ts` | dev | Master's copy is the older snapshot inside 01c7cc6, not prod-only landing copy, assets, config, or download headers. Dev is the reviewed tree. |
| `packages/extension/src/background/spp/sppHostPoolProxy.ts` | dev | Master's copy is the older snapshot inside 01c7cc6, not prod-only landing copy, assets, config, or download headers. Dev is the reviewed tree. |
| `packages/extension/src/background/trustedWalletOrigin.ts` | dev | Master's copy is the older snapshot inside 01c7cc6, not prod-only landing copy, assets, config, or download headers. Dev is the reviewed tree. |
| `packages/extension/src/nym-offscreen/main.ts` | dev | Master's copy is the older snapshot inside 01c7cc6, not prod-only landing copy, assets, config, or download headers. Dev is the reviewed tree. |
| `packages/extension/src/nym-offscreen/protocol.ts` | dev | Master's copy is the older snapshot inside 01c7cc6, not prod-only landing copy, assets, config, or download headers. Dev is the reviewed tree. |
| `packages/extension/src/nym-offscreen/runtime.ts` | dev | Master's copy is the older snapshot inside 01c7cc6, not prod-only landing copy, assets, config, or download headers. Dev is the reviewed tree. |
| `packages/extension/src/popup/App.tsx` | dev | Master's copy is the older snapshot inside 01c7cc6, not prod-only landing copy, assets, config, or download headers. Dev is the reviewed tree. |
| `packages/extension/src/popup/Dashboard.tsx` | dev | Master's copy is the older snapshot inside 01c7cc6, not prod-only landing copy, assets, config, or download headers. Dev is the reviewed tree. |
| `packages/extension/src/popup/NymTransportPanel.tsx` | dev | Master's copy is the older snapshot inside 01c7cc6, not prod-only landing copy, assets, config, or download headers. Dev is the reviewed tree. |
| `packages/extension/src/popup/Send.tsx` | dev | Master's copy is the older snapshot inside 01c7cc6, not prod-only landing copy, assets, config, or download headers. Dev is the reviewed tree. |
| `packages/extension/src/popup/SppAccountPanel.tsx` | dev | Master's copy is the older snapshot inside 01c7cc6, not prod-only landing copy, assets, config, or download headers. Dev is the reviewed tree. |
| `packages/extension/src/popup/SppPrivateSend.tsx` | dev | Master's copy is the older snapshot inside 01c7cc6, not prod-only landing copy, assets, config, or download headers. Dev is the reviewed tree. |
| `packages/extension/src/popup/SppStatusPanel.tsx` | dev | Master's copy is the older snapshot inside 01c7cc6, not prod-only landing copy, assets, config, or download headers. Dev is the reviewed tree. |
| `packages/extension/src/popup/ipc.ts` | dev | Untouched by the three master-only commits. The difference is dev work after merge-base bfc11dd. Master has no newer prod hunk here. |
| `packages/extension/src/popup/privatePaymentRouter.ts` | dev | Master's copy is the older snapshot inside 01c7cc6, not prod-only landing copy, assets, config, or download headers. Dev is the reviewed tree. |
| `packages/extension/src/popup/wallet.css` | dev | Master's copy is the older snapshot inside 01c7cc6, not prod-only landing copy, assets, config, or download headers. Dev is the reviewed tree. |
| `packages/extension/src/shared/ipcSchemas.ts` | dev | Master's copy is the older snapshot inside 01c7cc6, not prod-only landing copy, assets, config, or download headers. Dev is the reviewed tree. |
| `packages/extension/src/shared/ipcTypes.ts` | dev | Untouched by the three master-only commits. The difference is dev work after merge-base bfc11dd. Master has no newer prod hunk here. |
| `packages/extension/src/shared/sppHostBridge.ts` | dev | Master's copy is the older snapshot inside 01c7cc6, not prod-only landing copy, assets, config, or download headers. Dev is the reviewed tree. |
| `packages/extension/src/spp-host/hostController.ts` | dev | Master's copy is the older snapshot inside 01c7cc6, not prod-only landing copy, assets, config, or download headers. Dev is the reviewed tree. |
| `packages/extension/src/spp-host/main.ts` | dev | Master's copy is the older snapshot inside 01c7cc6, not prod-only landing copy, assets, config, or download headers. Dev is the reviewed tree. |
| `packages/extension/src/spp-host/openSppHost.ts` | dev | Master's copy is the older snapshot inside 01c7cc6, not prod-only landing copy, assets, config, or download headers. Dev is the reviewed tree. |
| `packages/extension/src/spp-host/sdkLoad.ts` | dev | Untouched by the three master-only commits. The difference is dev work after merge-base bfc11dd. Master has no newer prod hunk here. |
| `packages/extension/src/spp-host/sessionConstruct.ts` | dev | Master's copy is the older snapshot inside 01c7cc6, not prod-only landing copy, assets, config, or download headers. Dev is the reviewed tree. |
| `packages/extension/src/spp-host/sppHostAccountSurface.ts` | dev | Master's copy is the older snapshot inside 01c7cc6, not prod-only landing copy, assets, config, or download headers. Dev is the reviewed tree. |
| `packages/extension/src/spp-host/sppHostAutoPrepare.ts` | dev | Master's copy is the older snapshot inside 01c7cc6, not prod-only landing copy, assets, config, or download headers. Dev is the reviewed tree. |
| `packages/extension/src/spp-host/sppHostBridgeListener.ts` | dev | Master's copy is the older snapshot inside 01c7cc6, not prod-only landing copy, assets, config, or download headers. Dev is the reviewed tree. |
| `packages/extension/src/spp-host/sppHostRemoteSigner.ts` | dev | Master's copy is the older snapshot inside 01c7cc6, not prod-only landing copy, assets, config, or download headers. Dev is the reviewed tree. |
| `packages/extension/src/spp-host/sppHostWritePool.ts` | dev | Master's copy is the older snapshot inside 01c7cc6, not prod-only landing copy, assets, config, or download headers. Dev is the reviewed tree. |
| `packages/extension/src/spp-host/sppHostWritePoolFactory.ts` | dev | Master's copy is the older snapshot inside 01c7cc6, not prod-only landing copy, assets, config, or download headers. Dev is the reviewed tree. |
| `packages/extension/src/webapp/installChromeShim.ts` | dev | Master's copy is the older snapshot inside 01c7cc6, not prod-only landing copy, assets, config, or download headers. Dev is the reviewed tree. |
| `packages/extension/tests/background/handlers/stellarIpcFlow.test.ts` | dev | Untouched by the three master-only commits. The difference is dev work after merge-base bfc11dd. Master has no newer prod hunk here. |
| `packages/extension/tests/background/nym/NymDiagnosticIsolation.test.ts` | dev | Master's copy is the older snapshot inside 01c7cc6, not prod-only landing copy, assets, config, or download headers. Dev is the reviewed tree. |
| `packages/extension/tests/background/nym/NymRuntimeController.lifecycle.test.ts` | dev | Master's copy is the older snapshot inside 01c7cc6, not prod-only landing copy, assets, config, or download headers. Dev is the reviewed tree. |
| `packages/extension/tests/background/nym/OffscreenMixFetchBridge.test.ts` | dev | Untouched by the three master-only commits. The difference is dev work after merge-base bfc11dd. Master has no newer prod hunk here. |
| `packages/extension/tests/background/nym/stellarTransportFetch.test.ts` | dev | Untouched by the three master-only commits. The difference is dev work after merge-base bfc11dd. Master has no newer prod hunk here. |
| `packages/extension/tests/background/spp/sppAccountHandlers.test.ts` | dev | Master's copy is the older snapshot inside 01c7cc6, not prod-only landing copy, assets, config, or download headers. Dev is the reviewed tree. |
| `packages/extension/tests/background/spp/sppAutoPrepare.test.ts` | dev | Master's copy is the older snapshot inside 01c7cc6, not prod-only landing copy, assets, config, or download headers. Dev is the reviewed tree. |
| `packages/extension/tests/background/spp/sppHostBridgeHandlers.test.ts` | dev | Master's copy is the older snapshot inside 01c7cc6, not prod-only landing copy, assets, config, or download headers. Dev is the reviewed tree. |
| `packages/extension/tests/background/spp/sppHostPoolProxy.test.ts` | dev | Master's copy is the older snapshot inside 01c7cc6, not prod-only landing copy, assets, config, or download headers. Dev is the reviewed tree. |
| `packages/extension/tests/nym-offscreen/runtime.test.ts` | dev | Untouched by the three master-only commits. The difference is dev work after merge-base bfc11dd. Master has no newer prod hunk here. |
| `packages/extension/tests/popup/Dashboard.test.tsx` | dev | Untouched by the three master-only commits. The difference is dev work after merge-base bfc11dd. Master has no newer prod hunk here. |
| `packages/extension/tests/popup/NymTransportPanel.test.tsx` | dev | Untouched by the three master-only commits. The difference is dev work after merge-base bfc11dd. Master has no newer prod hunk here. |
| `packages/extension/tests/popup/SppStatusPanel.test.tsx` | dev | Master's copy is the older snapshot inside 01c7cc6, not prod-only landing copy, assets, config, or download headers. Dev is the reviewed tree. |
| `packages/extension/tests/popup/privatePaymentRouter.test.ts` | dev | Master's copy is the older snapshot inside 01c7cc6, not prod-only landing copy, assets, config, or download headers. Dev is the reviewed tree. |
| `packages/extension/tests/responsive/responsiveCss.test.ts` | dev | Master's copy is the older snapshot inside 01c7cc6, not prod-only landing copy, assets, config, or download headers. Dev is the reviewed tree. |
| `packages/extension/tests/responsive/screenFixtures.ts` | dev | Master's copy is the older snapshot inside 01c7cc6, not prod-only landing copy, assets, config, or download headers. Dev is the reviewed tree. |
| `packages/extension/tests/security/extensionInvariants.test.ts` | dev | Master's copy is the older snapshot inside 01c7cc6, not prod-only landing copy, assets, config, or download headers. Dev is the reviewed tree. |
| `packages/extension/tests/spp-host/openSppHostReuse.test.ts` | dev | Master's copy is the older snapshot inside 01c7cc6, not prod-only landing copy, assets, config, or download headers. Dev is the reviewed tree. |
| `packages/extension/tests/spp-host/sessionConstruct.test.ts` | dev | Master's copy is the older snapshot inside 01c7cc6, not prod-only landing copy, assets, config, or download headers. Dev is the reviewed tree. |
| `packages/extension/tests/spp-host/sppHost.test.ts` | dev | Untouched by the three master-only commits. The difference is dev work after merge-base bfc11dd. Master has no newer prod hunk here. |
| `packages/extension/tests/spp-host/sppHostRemoteSigner.test.ts` | dev | Master's copy is the older snapshot inside 01c7cc6, not prod-only landing copy, assets, config, or download headers. Dev is the reviewed tree. |
| `packages/extension/tests/spp-host/sppHostWritePool.test.ts` | dev | Master's copy is the older snapshot inside 01c7cc6, not prod-only landing copy, assets, config, or download headers. Dev is the reviewed tree. |
| `packages/extension/tests/webapp/androidChromeShim.test.ts` | dev | Master's copy is the older snapshot inside 01c7cc6, not prod-only landing copy, assets, config, or download headers. Dev is the reviewed tree. |
| `packages/extension/tests/website/landing.test.ts` | dev | Master removes the local-font assertions and renames the palette test. Test titles stay. |
| `packages/extension/webapp.html` | dev | Same Google Fonts hunk as `index.html`. Rejected so the webapp does not call Google. |
| `packages/wallet-core/src/index.ts` | dev | Untouched by the three master-only commits. The difference is dev work after merge-base bfc11dd. Master has no newer prod hunk here. |
| `packages/wallet-core/src/nym/NymTransportPolicy.ts` | dev | Master's copy is the older snapshot inside 01c7cc6, not prod-only landing copy, assets, config, or download headers. Dev is the reviewed tree. |
| `packages/wallet-core/src/nym/STELLAR_NYM_ROUTING.md` | dev | Master's copy is the older snapshot inside 01c7cc6, not prod-only landing copy, assets, config, or download headers. Dev is the reviewed tree. |
| `packages/wallet-core/src/stellar/read/StellarReadClient.ts` | dev | Untouched by the three master-only commits. The difference is dev work after merge-base bfc11dd. Master has no newer prod hunk here. |
| `packages/wallet-core/src/stellar/read/types.ts` | dev | Untouched by the three master-only commits. The difference is dev work after merge-base bfc11dd. Master has no newer prod hunk here. |
| `packages/wallet-core/src/stellar/spp/SppIntegrationStatus.ts` | dev | Master's copy is the older snapshot inside 01c7cc6, not prod-only landing copy, assets, config, or download headers. Dev is the reviewed tree. |
| `packages/wallet-core/src/stellar/spp/SppSession.ts` | dev | Master's copy is the older snapshot inside 01c7cc6, not prod-only landing copy, assets, config, or download headers. Dev is the reviewed tree. |
| `packages/wallet-core/src/stellar/spp/SppWalletSignerAdapter.ts` | dev | Master's copy is the older snapshot inside 01c7cc6, not prod-only landing copy, assets, config, or download headers. Dev is the reviewed tree. |
| `packages/wallet-core/src/stellar/spp/nethermind/nethermindPublicTestnet.ts` | dev | Master's copy is the older snapshot inside 01c7cc6, not prod-only landing copy, assets, config, or download headers. Dev is the reviewed tree. |
| `packages/wallet-core/src/stellar/spp/nethermind/testnet-deployments.json` | dev | Master's copy is the older snapshot inside 01c7cc6, not prod-only landing copy, assets, config, or download headers. Dev is the reviewed tree. |
| `packages/wallet-core/src/stellar/spp/sppContractConfig.ts` | dev | Master's copy is the older snapshot inside 01c7cc6, not prod-only landing copy, assets, config, or download headers. Dev is the reviewed tree. |
| `packages/wallet-core/src/stellar/spp/sppExecutionGuard.ts` | dev | Master's copy is the older snapshot inside 01c7cc6, not prod-only landing copy, assets, config, or download headers. Dev is the reviewed tree. |
| `packages/wallet-core/src/stellar/spp/sppFeePolicy.ts` | dev | Master's copy is the older snapshot inside 01c7cc6, not prod-only landing copy, assets, config, or download headers. Dev is the reviewed tree. |
| `packages/wallet-core/src/stellar/spp/sppNymOption.ts` | dev | Master's copy is the older snapshot inside 01c7cc6, not prod-only landing copy, assets, config, or download headers. Dev is the reviewed tree. |
| `packages/wallet-core/tests/nym/NymTransport.test.ts` | dev | Untouched by the three master-only commits. The difference is dev work after merge-base bfc11dd. Master has no newer prod hunk here. |
| `packages/wallet-core/tests/stellar/spp/SppSession.test.ts` | dev | Master's copy is the older snapshot inside 01c7cc6, not prod-only landing copy, assets, config, or download headers. Dev is the reviewed tree. |
| `packages/wallet-core/tests/stellar/spp/SppWalletSignerAdapter.test.ts` | dev | Untouched by the three master-only commits. The difference is dev work after merge-base bfc11dd. Master has no newer prod hunk here. |
| `packages/wallet-core/tests/stellar/spp/sppContractConfig.test.ts` | dev | Master's copy is the older snapshot inside 01c7cc6, not prod-only landing copy, assets, config, or download headers. Dev is the reviewed tree. |
| `packages/wallet-core/tests/stellar/spp/sppFeePolicy.test.ts` | dev | Master's copy is the older snapshot inside 01c7cc6, not prod-only landing copy, assets, config, or download headers. Dev is the reviewed tree. |
| `packages/wallet-core/tests/stellar/spp/sppNymOption.test.ts` | dev | Master's copy is the older snapshot inside 01c7cc6, not prod-only landing copy, assets, config, or download headers. Dev is the reviewed tree. |
| `pnpm-lock.yaml` | dev | Lockfile matches the dev dependency set and the vendored wasm path. Master's lock is the older snapshot. |
| `vercel.json` | merged | Kept dev `buildCommand` `pnpm build:webapp`, `git.deploymentEnabled` (non-master off), wasm/html/manifest/sw headers, and the `/downloads` zip+json headers plus the mv3 zip rewrite (master has none of those). Added master's `framework: null`, `cleanUrls: false`, and `trailingSlash: false` so framework detection cannot rewrite `/webapp.html`. |

## Local checks

`env -i CI=1 VERCEL=1` with `PATH`, `HOME`, `TMPDIR`, and `LANG` set, then `pnpm build:webapp`, exited 0. The built landing still contains the HackMeridian copy and six self-hosted `@font-face` rules, and it does not reference Google Fonts.

Focal vitest `packages/extension/tests/website/landing.test.ts`: 3 passed. Test titles were not changed.

## Promotion plan (not executed)

Goal: one ordinary commit on `master` whose tree equals this branch, parented on the current master tip. No rebase, no reset, no filter, no `--force`.

`--allow-unrelated-histories` is the wrong flag here. A merge-base exists, and a normal `git merge` of this branch into `master` still stops on the 92 add/add paths. Do not resolve that merge by hand.

Run the block below only when promotion is approved, from a clean clone, and only if `origin/master` is still `01c7cc6c9f556baee09ddd8272a51db389e6b7cc`. If master has moved, stop. Do not run it as part of this prep ticket. The last command fast-forwards `master`. It is not a force-push.

```bash
set -euo pipefail
git fetch origin master astrym/promote-candidate
test "$(git rev-parse origin/master)" = "01c7cc6c9f556baee09ddd8272a51db389e6b7cc"
TREE=$(git rev-parse origin/astrym/promote-candidate^{tree})
PARENT=$(git rev-parse origin/master)
NEW=$(git commit-tree "$TREE" -p "$PARENT" -m "Promote astrym/promote-candidate tree onto master")
git checkout master
git merge --ff-only "$NEW"
test "$(git rev-parse HEAD^{tree})" = "$TREE"
test "$(git rev-parse HEAD^)" = "$PARENT"
git push origin master
```

`git commit-tree` writes one commit object. `git merge --ff-only` moves local `master` only when that commit's parent is the current tip. `git push` without `--force` then updates the remote only if it is still a fast-forward.

Equivalent merge form, still one commit, if a second parent should record this branch. Still not run:

```bash
set -euo pipefail
git fetch origin master astrym/promote-candidate
git checkout master
test "$(git rev-parse HEAD)" = "01c7cc6c9f556baee09ddd8272a51db389e6b7cc"
git merge --no-ff --no-commit -s ours origin/astrym/promote-candidate
git read-tree -u --reset origin/astrym/promote-candidate
git commit -m "Promote astrym/promote-candidate tree onto master"
test "$(git rev-parse HEAD^{tree})" = "$(git rev-parse origin/astrym/promote-candidate^{tree})"
test "$(git rev-parse HEAD^1)" = "01c7cc6c9f556baee09ddd8272a51db389e6b7cc"
git push origin master
```

Do not use `git push --force`, `git reset` on `master`, or a branch deploy.

