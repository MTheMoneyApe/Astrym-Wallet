#!/usr/bin/env bash
# Fail-closed T9 check for astrym/testnet-mvp.
#
# Asset preparation, the security/privacy focal tests, and the full package
# typecheck and vitest suites each keep their own exit status. pnpm -r stops
# at the first failing workspace package, so this script invokes each package
# and returns non-zero if any status is non-zero. It does not drop tests,
# rewrite assertions, or turn a failing command into success.
#
# Live signing, broadcast, and Mainnet flags are cleared. Generated public/
# assets and the mv3 vendor meta stay uncommitted.

set -u

if [ -n "${T9_ROOT:-}" ]; then
  ROOT="$T9_ROOT"
else
  ROOT="$(git rev-parse --show-toplevel)" || exit 1
fi
cd "$ROOT" || exit 1

unset SOLANYM_TESTNET_LIVE \
  SOLANYM_TESTNET_LIVE_FUND \
  SOLANYM_TESTNET_LIVE_SEND \
  SOLANYM_TESTNET_READ_ADDRESS \
  VITE_NYM_LIVE_SMOKE_AUTHORIZED

MODE="${1:-all}"
status=0
LOG_DIR="${T9_LOG_DIR:-${ROOT}/t9-logs}"
mkdir -p "$LOG_DIR" || exit 1

note() {
  printf '\n== t9 %s ==\n' "$*"
}

run() {
  local name="$1"
  shift
  local log="${LOG_DIR}/${name}.log"
  {
    echo "COMMAND: $*"
    echo "CWD: $(pwd)"
    echo "UTC: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  } >"$log"
  note "$*"
  set +e
  "$@" 2>&1 | tee -a "$log"
  local code=${PIPESTATUS[0]}
  printf '%s\n' "$code" >"${LOG_DIR}/${name}.exit"
  echo "exit=${code}"
  if [ "$code" -ne 0 ]; then
    status=1
  fi
  return 0
}

append_required() {
  local root="$1"
  local dest="$2"
  shift 2
  local rel
  for rel in "$@"; do
    if [ -f "${root}/${rel}" ]; then
      printf '%s\n' "$rel" >> "$dest"
    else
      echo "MISSING ${root}/${rel}" >&2
      status=1
    fi
  done
}

prepare_assets() {
  note "asset preparation"
  pushd packages/extension >/dev/null || exit 1
  run asset-copy-nym node scripts/copy-nym-mixfetch-assets.mjs
  run asset-copy-spp node scripts/copy-spp-assets.mjs
  popd >/dev/null || exit 1
  pushd packages/wallet-core/tests/stellar/spp/harness/mv3-spike >/dev/null || exit 1
  run asset-prepare-vendor node prepare-vendor.mjs
  popd >/dev/null || exit 1
}

focal_tests() {
  local -a ext_required=(
    tests/background/handlers/stellarIpcFlow.test.ts
    tests/background/nym/NymGatewayConfigService.test.ts
    tests/background/spp/sppSignGate.test.ts
    tests/background/spp/sppHostBridgeHandlers.test.ts
    tests/nym-offscreen/gatewayConfig.test.ts
    tests/nym-offscreen/verifiedGateway.test.ts
    tests/popup/NymTransportPanel.test.tsx
    tests/popup/SppStatusPanel.test.tsx
    tests/security/dappAccountAuthority.test.ts
    tests/security/extensionInvariants.test.ts
    tests/security/readyWithMutationLock.test.ts
    tests/security/signingResetConcurrency.test.ts
    tests/shared/stellarIpcSchemas.test.ts
    tests/spp-host/sppHostBridgeListener.test.ts
  )
  local -a ext_privacy=(
    tests/background/nym/NymPrivacyDurableEcho.test.ts
    tests/background/nym/NymPrivacyPersistence.test.ts
    tests/background/nym/NymPrivacyRaces.test.ts
    tests/popup/nymRuntimeStatus.test.ts
    tests/popup/privacyIndicator.test.tsx
    tests/webapp/privacyCrossInstance.test.ts
    tests/webapp/privacyStaleForeignNotice.test.ts
  )
  local -a core_required=(
    tests/security/staticInvariants.test.ts
    tests/stellar/spp/harness/browser/mockRpc.security.test.ts
    tests/stellar/spp/sppBroadcastGate.test.ts
    tests/stellar/spp/sppSignGate.test.ts
    tests/vault/ChromeStorageAdapters.test.ts
  )

  local ext_list core_list line
  ext_list="$(mktemp)" || exit 1
  core_list="$(mktemp)" || exit 1
  append_required packages/extension "$ext_list" "${ext_required[@]}"
  append_required packages/extension "$ext_list" "${ext_privacy[@]}"
  append_required packages/wallet-core "$core_list" "${core_required[@]}"

  local -a ext_files=()
  local -a core_files=()
  while IFS= read -r line; do
    [ -n "$line" ] && ext_files+=("$line")
  done < "$ext_list"
  while IFS= read -r line; do
    [ -n "$line" ] && core_files+=("$line")
  done < "$core_list"
  rm -f "$ext_list" "$core_list"

  if [ "${#ext_files[@]}" -gt 0 ]; then
    run test-focal-extension pnpm --filter @solanym/extension exec vitest run --reporter=json --outputFile="${LOG_DIR}/test-focal-extension.json" "${ext_files[@]}"
  fi
  if [ "${#core_files[@]}" -gt 0 ]; then
    run test-focal-wallet-core pnpm --filter @solanym/wallet-core exec vitest run --reporter=json --outputFile="${LOG_DIR}/test-focal-wallet-core.json" "${core_files[@]}"
  fi
}

full_suite() {
  run typecheck-extension pnpm --filter @solanym/extension typecheck
  run typecheck-wallet-core pnpm --filter @solanym/wallet-core typecheck
  run test-full-extension pnpm --filter @solanym/extension exec vitest run --reporter=json --outputFile="${LOG_DIR}/test-full-extension.json"
  run test-full-wallet-core pnpm --filter @solanym/wallet-core exec vitest run --reporter=json --outputFile="${LOG_DIR}/test-full-wallet-core.json"
}

note "toolchain node=$(node -v) pnpm=$(pnpm -v) npm=$(npm -v) head=$(git rev-parse HEAD)"

case "$MODE" in
  prepare)
    prepare_assets
    ;;
  focal)
    prepare_assets
    focal_tests
    ;;
  full)
    prepare_assets
    full_suite
    ;;
  all)
    prepare_assets
    focal_tests
    full_suite
    ;;
  *)
    echo "usage: t9-check.sh [prepare|focal|full|all]" >&2
    exit 2
    ;;
esac

if [ "$status" -eq 0 ]; then
  echo "t9-result=PASS"
else
  echo "t9-result=FAIL"
fi
exit "$status"
