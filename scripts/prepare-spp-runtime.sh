#!/usr/bin/env bash
# Reproduce the SPP web runtime from Nethermind source commit e6ce95c2.
# Does not use the npm stellar-private-payments@0.2.1 tarball.
# Official steps: rust-toolchain.toml, sdk/web/scripts/build.sh,
# .github/actions/circuits/action.yml (circuits-v0.7 + circomlib lock).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE_COMMIT="e6ce95c2a71ed6313f78bb19cfdd0de1d9663120"
SOURCE_REPO="https://github.com/NethermindEth/stellar-private-payments.git"
RUST_CHANNEL="1.97.1"
WASM_BINDGEN_VERSION="0.2.128"
CIRCUITS_URL="https://github.com/NethermindEth/stellar-private-payments/releases/download/circuits-v0.7/circuits.tar.gz"
CIRCUITS_SHA256="c4ad54de6cc146bd8323e502341d545e09d0cd95d21b4f60ad2388188f64a2f9"
CIRCUITS_LOCK_SHA256="35c36f4d0f7055514156b67df9995cb9550e5f380e9a84d85dddb457d17b241e"
CIRCOMLIB_REPO="https://github.com/iden3/circomlib.git"
BUILD_ROOT="${SPP_BUILD_ROOT:-$REPO_ROOT/.cache/spp-upstream}"
SRC="$BUILD_ROOT/stellar-private-payments"
MANIFEST="$REPO_ROOT/packages/wallet-core/src/stellar/spp/nethermind/spp-runtime-manifest.json"

log() { printf '%s\n' "$*"; }
die() { printf 'prepare-spp-runtime: %s\n' "$*" >&2; exit 1; }

command -v rustup >/dev/null 2>&1 || die "rustup is required (https://rustup.rs)"
command -v git >/dev/null 2>&1 || die "git is required"
command -v curl >/dev/null 2>&1 || die "curl is required"
command -v jq >/dev/null 2>&1 || die "jq is required"

log "COMMAND: rustup toolchain install $RUST_CHANNEL --profile minimal --component rustfmt,clippy"
rustup toolchain install "$RUST_CHANNEL" --profile minimal --component rustfmt,clippy
log "COMMAND: rustup target add wasm32-unknown-unknown wasm32v1-none --toolchain $RUST_CHANNEL"
rustup target add wasm32-unknown-unknown wasm32v1-none --toolchain "$RUST_CHANNEL"

export PATH="${CARGO_HOME:-$HOME/.cargo}/bin:/usr/local/cargo/bin:$PATH"
if ! wasm-bindgen --version 2>/dev/null | grep -q "$WASM_BINDGEN_VERSION"; then
  log "COMMAND: cargo +$RUST_CHANNEL install wasm-bindgen-cli --version $WASM_BINDGEN_VERSION --locked --force"
  cargo "+$RUST_CHANNEL" install wasm-bindgen-cli --version "$WASM_BINDGEN_VERSION" --locked --force
fi

mkdir -p "$BUILD_ROOT"
if [ ! -d "$SRC/.git" ]; then
  git init "$SRC"
  git -C "$SRC" remote add origin "$SOURCE_REPO"
fi
if [ "$(git -C "$SRC" rev-parse HEAD 2>/dev/null || true)" != "$SOURCE_COMMIT" ]; then
  log "COMMAND: git fetch --depth 1 origin $SOURCE_COMMIT"
  git -C "$SRC" fetch --depth 1 origin "$SOURCE_COMMIT"
  git -C "$SRC" checkout --detach FETCH_HEAD
fi
[ "$(git -C "$SRC" rev-parse HEAD)" = "$SOURCE_COMMIT" ] || die "upstream HEAD is not $SOURCE_COMMIT"

python3 - "$SRC" "$REPO_ROOT" "$CIRCUITS_LOCK_SHA256" <<'PY'
import hashlib, sys
from pathlib import Path
src, repo, expect = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]
lock = (src / "deployments/testnet/circuits.json").read_bytes()
got = hashlib.sha256(lock).hexdigest()
if got != expect:
    raise SystemExit(f"upstream circuits.json sha256 {got} != {expect}")
pinned = (repo / "packages/wallet-core/src/stellar/spp/nethermind/testnet-circuits.json").read_bytes()
if pinned != lock:
    raise SystemExit("wallet circuits pin is not the upstream lock at this commit")
print("circuits lock matches", got)
PY

ART="$SRC/target/circuits-artifacts"
KEYS="$SRC/deployments/testnet/circuit_keys"
mkdir -p "$ART" "$KEYS" "$BUILD_ROOT/circuits-unpacked"
TARBALL="$BUILD_ROOT/circuits-v0.7.tar.gz"
if [ ! -f "$TARBALL" ] || ! echo "$CIRCUITS_SHA256  $TARBALL" | sha256sum -c -; then
  log "COMMAND: curl circuits-v0.7"
  curl -fsSL -o "$TARBALL" "$CIRCUITS_URL"
  echo "$CIRCUITS_SHA256  $TARBALL" | sha256sum -c -
fi
rm -rf "$BUILD_ROOT/circuits-unpacked"
mkdir -p "$BUILD_ROOT/circuits-unpacked"
tar -xzf "$TARBALL" -C "$BUILD_ROOT/circuits-unpacked"
python3 - "$BUILD_ROOT/circuits-unpacked" "$ART" "$KEYS" "$CIRCUITS_LOCK_SHA256" <<'PY'
import hashlib, shutil, sys
from pathlib import Path
root, art, keys, expect = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]), sys.argv[4]
lock = (root / "circuits.json").read_bytes()
got = hashlib.sha256(lock).hexdigest()
if got != expect:
    raise SystemExit(f"archive circuits.json {got} != {expect}")
art.mkdir(parents=True, exist_ok=True)
keys.mkdir(parents=True, exist_ok=True)
for path in root.iterdir():
    name = path.name
    if name.endswith(".r1cs"):
        shutil.copy2(path, art / name)
    elif name.endswith(".graph.bin") or name.endswith("_proving_key.bin"):
        shutil.copy2(path, keys / name)
print("laid out circuit artifacts")
PY

log "COMMAND: sh deployments/scripts/circuit-artifacts.sh verify"
( cd "$SRC" && sh deployments/scripts/circuit-artifacts.sh verify )

LOCK="$(tr -d '[:space:]' < "$SRC/circuits/circomlib.lock")"
if [ "$(git -C "$SRC/circuits/src/circomlib" rev-parse HEAD 2>/dev/null || true)" != "$LOCK" ]; then
  rm -rf "$SRC/circuits/src/circomlib"
  git init -q "$SRC/circuits/src/circomlib"
  log "COMMAND: git fetch circomlib $LOCK"
  git -C "$SRC/circuits/src/circomlib" fetch --depth=1 "$CIRCOMLIB_REPO" "$LOCK"
  git -C "$SRC/circuits/src/circomlib" checkout -q --detach FETCH_HEAD
fi
[ "$(git -C "$SRC/circuits/src/circomlib" rev-parse HEAD)" = "$LOCK" ] || die "circomlib is not $LOCK"

log "COMMAND: bash sdk/web/scripts/build.sh"
( cd "$SRC" && bash sdk/web/scripts/build.sh )

python3 - "$SRC/sdk/web" "$MANIFEST" "$SOURCE_COMMIT" <<'PY'
import hashlib, json, sys
from pathlib import Path
web, manifest_path, commit = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]
manifest = json.loads(manifest_path.read_text())
if manifest["sourceCommit"] != commit:
    raise SystemExit("manifest sourceCommit drifted")
for rel, expect in manifest["files"].items():
    path = web / "dist" / rel.removeprefix("dist/")
    data = path.read_bytes()
    got = hashlib.sha256(data).hexdigest()
    if got != expect["sha256"] or len(data) != expect["size"]:
        raise SystemExit(f"hash mismatch {rel}: {got} {len(data)}")
    print(f"ok {rel}")
prov = {
    "sourceRepository": manifest["sourceRepository"],
    "sourceCommit": commit,
    "rustc": manifest["rustc"],
    "wasmBindgen": manifest["wasmBindgen"],
    "circuitsRelease": manifest["circuitsRelease"],
    "circuitsArchiveSha256": manifest["circuitsArchiveSha256"],
    "circuitsLockSha256": manifest["circuitsLockSha256"],
    "circomlib": manifest["circomlib"],
    "packageVersionString": manifest["packageVersionString"],
    "note": manifest["packageVersionNote"],
}
(web / "SPP_SOURCE_PROVENANCE.json").write_text(json.dumps(prov, indent=2) + "\n")
print("wrote", web / "SPP_SOURCE_PROVENANCE.json")
PY

log "prepare-spp-runtime: built $SRC/sdk/web at $SOURCE_COMMIT"
