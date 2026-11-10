#!/usr/bin/env bash
# Install head and baseline separately, then compare them.
# The comparator and the baseline run use the base checkout's scripts when
# that checkout has them. A missing SHA or an empty suite is not a pass.
set -u

is_sha() {
  [[ "${1:-}" =~ ^[0-9a-f]{40}$ ]] && [[ "$1" != 0000000000000000000000000000000000000000 ]]
}

ROOT="$(git rev-parse --show-toplevel)" || exit 1
cd "$ROOT" || exit 1
BASE="${T9_BASE_SHA:-}"
HEAD="${T9_HEAD_SHA:-}"
BASE_DIR="${T9_BASE_DIR:-$ROOT/t9-baseline}"
HEAD_DIR="${T9_HEAD_DIR:-$ROOT}"
LOG="${T9_LOG_DIR:-$ROOT/t9-logs}"
mkdir -p "$LOG" || exit 1

if ! is_sha "$BASE" || ! is_sha "$HEAD"; then
  echo "baseline or head sha missing" >&2
  printf '%s\n' '{"ok":false,"reason":"sha-missing"}' >"$LOG/delta.json"
  exit 1
fi

base_now="$(git -C "$BASE_DIR" rev-parse HEAD)" || exit 1
head_now="$(git -C "$HEAD_DIR" rev-parse HEAD)" || exit 1
if [ "$base_now" != "$BASE" ] || [ "$head_now" != "$HEAD" ]; then
  echo "checkout mismatch head=$head_now expected=$HEAD base=$base_now expected=$BASE" >&2
  printf '%s\n' '{"ok":false,"reason":"checkout-mismatch"}' >"$LOG/delta.json"
  exit 1
fi

if [ -f "$BASE_DIR/.github/ci/t9-delta.mjs" ] && [ -f "$BASE_DIR/.github/ci/t9-check.sh" ] && [ -f "$BASE_DIR/.github/ci/t9-fingerprint.mjs" ]; then
  SCRIPT_DIR="$BASE_DIR/.github/ci"
  SCRIPT_SOURCE="base:${BASE}"
elif [ "${T9_SCRIPT_FALLBACK:-}" = "workflow" ] && [ -f "$ROOT/.github/ci/t9-delta.mjs" ]; then
  SCRIPT_DIR="$ROOT/.github/ci"
  SCRIPT_SOURCE="workflow:$(git -C "$ROOT" rev-parse HEAD)"
else
  echo "base scripts missing at ${BASE_DIR}/.github/ci" >&2
  printf '%s\n' '{"ok":false,"reason":"base-scripts-missing"}' >"$LOG/delta.json"
  exit 1
fi

{
  echo "base=${BASE}"
  echo "head=${HEAD}"
  echo "merge=${T9_MERGE_SHA:-}"
  echo "scriptSource=${SCRIPT_SOURCE}"
} >"$LOG/shas.txt"

if ! git -C "$HEAD_DIR" cat-file -e "${BASE}^{commit}" 2>/dev/null; then
  git -C "$HEAD_DIR" fetch --no-tags "$BASE_DIR" "$BASE" || true
fi
synthetic="$(git -C "$HEAD_DIR" merge-tree --write-tree "$BASE" "$HEAD" 2>"$LOG/merge-tree.err" || true)"
echo "syntheticMerge=${synthetic:-unresolved}" >>"$LOG/shas.txt"

echo "pnpm install --frozen-lockfile in ${HEAD_DIR}"
( cd "$HEAD_DIR" && pnpm install --frozen-lockfile ) || exit 1
echo "pnpm install --frozen-lockfile in ${BASE_DIR}"
( cd "$BASE_DIR" && pnpm install --frozen-lockfile ) || exit 1

export T9_BASE_SHA="$BASE" T9_HEAD_SHA="$HEAD" T9_MERGE_SHA="${synthetic:-${T9_MERGE_SHA:-}}"
T9_ROOT="$HEAD_DIR" T9_LOG_DIR="$LOG/head" bash "$SCRIPT_DIR/t9-check.sh" full
T9_ROOT="$BASE_DIR" T9_LOG_DIR="$LOG/base" bash "$SCRIPT_DIR/t9-check.sh" full

node "$SCRIPT_DIR/t9-fingerprint.mjs" --log-dir "$LOG/head" --out "$LOG/head.json" --sha "$HEAD" --base-sha "$BASE" --head-sha "$HEAD" --merge-sha "${synthetic:-}" || exit 1
node "$SCRIPT_DIR/t9-fingerprint.mjs" --log-dir "$LOG/base" --out "$LOG/base.json" --sha "$BASE" --base-sha "$BASE" --head-sha "$HEAD" --merge-sha "${synthetic:-}" || exit 1
node "$SCRIPT_DIR/t9-delta.mjs" "$LOG/base.json" "$LOG/head.json" --out "$LOG/delta.json"
exit $?
