#!/usr/bin/env bash
# Compare the checked-out head with the exact base SHA. Exit 1 when tsc
# diagnostics or failing tests increase. A missing SHA is not a pass.
set -u

is_sha() {
  [[ "${1:-}" =~ ^[0-9a-f]{40}$ ]] && [[ "$1" != 0000000000000000000000000000000000000000 ]]
}

ROOT="$(git rev-parse --show-toplevel)" || exit 1
cd "$ROOT" || exit 1
BASE="${T9_BASE_SHA:-}"
HEAD="${T9_HEAD_SHA:-}"
BASE_DIR="${T9_BASE_DIR:-$ROOT/t9-baseline}"
LOG="${T9_LOG_DIR:-$ROOT/t9-logs}"
mkdir -p "$LOG" || exit 1

if ! is_sha "$BASE" || ! is_sha "$HEAD"; then
  echo "baseline or head sha missing" >&2
  exit 1
fi
head_now="$(git rev-parse HEAD)" || exit 1
base_now="$(git -C "$BASE_DIR" rev-parse HEAD)" || exit 1
if [ "$head_now" != "$HEAD" ] || [ "$base_now" != "$BASE" ]; then
  echo "checkout mismatch head=$head_now expected=$HEAD base=$base_now expected=$BASE" >&2
  exit 1
fi

T9_ROOT="$ROOT" T9_LOG_DIR="$LOG/head" bash "$ROOT/.github/ci/t9-check.sh" full
T9_ROOT="$BASE_DIR" T9_LOG_DIR="$LOG/base" bash "$ROOT/.github/ci/t9-check.sh" full

node "$ROOT/.github/ci/t9-fingerprint.mjs" --log-dir "$LOG/head" --out "$LOG/head.json" --sha "$HEAD" || exit 1
node "$ROOT/.github/ci/t9-fingerprint.mjs" --log-dir "$LOG/base" --out "$LOG/base.json" --sha "$BASE" || exit 1
node "$ROOT/.github/ci/t9-delta.mjs" "$LOG/base.json" "$LOG/head.json" --out "$LOG/delta.json"
exit $?
