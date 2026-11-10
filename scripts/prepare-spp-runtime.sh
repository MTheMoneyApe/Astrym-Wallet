#!/usr/bin/env bash
# Reproduce the SPP web runtime from Nethermind source commit e6ce95c2.
# Does not use the npm stellar-private-payments@0.2.1 tarball.
# jq 1.7.1 is the official release binary, checked by SHA-256, on this build's PATH only.
# rustup is installed from the pinned 1.29.3 installer when absent.
# A toolchain already present on a developer machine is not assumed.
# Official steps: rust-toolchain.toml, sdk/web/scripts/build.sh,
# .github/actions/circuits/action.yml (circuits-v0.7 + circomlib lock).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE_COMMIT="e6ce95c2a71ed6313f78bb19cfdd0de1d9663120"
SOURCE_REPO="https://github.com/NethermindEth/stellar-private-payments.git"
RUST_CHANNEL="1.97.1"
RUSTUP_VERSION="1.29.3"
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

command -v git >/dev/null 2>&1 || die "git is required"
command -v curl >/dev/null 2>&1 || die "curl is required"
command -v sha256sum >/dev/null 2>&1 || die "sha256sum is required"

export CARGO_HOME="${CARGO_HOME:-$HOME/.cargo}"
export RUSTUP_HOME="${RUSTUP_HOME:-$HOME/.rustup}"
export PATH="$CARGO_HOME/bin:$PATH"

if ! command -v rustup >/dev/null 2>&1; then
  triple=""
  expect=""
  case "$(uname -s)-$(uname -m)" in
    Linux-x86_64)
      triple="x86_64-unknown-linux-gnu"
      expect="b1c8cb14e30889e7e2999e6b69e62d9e9b9ffc0f4df8180564d306d9680e6c55"
      ;;
    Linux-aarch64|Linux-arm64)
      triple="aarch64-unknown-linux-gnu"
      expect="9f608c142e0e38a78957d0661ba1dfaf0b6fb37184cfaa4b9a0aa57af6184282"
      ;;
    *)
      die "no pinned rustup-init for $(uname -s)-$(uname -m)"
      ;;
  esac
  mkdir -p "$BUILD_ROOT"
  installer="$BUILD_ROOT/rustup-init-$RUSTUP_VERSION-$triple"
  log "COMMAND: curl rustup-init $RUSTUP_VERSION $triple"
  curl -fsSL -o "$installer" "https://static.rust-lang.org/rustup/archive/$RUSTUP_VERSION/$triple/rustup-init"
  echo "$expect  $installer" | sha256sum -c -
  chmod +x "$installer"
  log "COMMAND: rustup-init -y --default-toolchain none --profile minimal --no-modify-path"
  "$installer" -y --default-toolchain none --profile minimal --no-modify-path
  command -v rustup >/dev/null 2>&1 || die "rustup bootstrap did not put rustup on PATH"
fi

log "COMMAND: rustup toolchain install $RUST_CHANNEL --profile minimal --component rustfmt,clippy"
rustup toolchain install "$RUST_CHANNEL" --profile minimal --component rustfmt,clippy
log "COMMAND: rustup target add wasm32-unknown-unknown wasm32v1-none --toolchain $RUST_CHANNEL"
rustup target add wasm32-unknown-unknown wasm32v1-none --toolchain "$RUST_CHANNEL"

if [ "${SPP_PREPARE_STOP_AFTER:-}" = "toolchain" ]; then
  log "prepare-spp-runtime: toolchain bootstrap complete ($(rustc +"$RUST_CHANNEL" --version))"
  exit 0
fi

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
if [ -n "$(git -C "$SRC" status --porcelain --untracked-files=no)" ]; then
  git -C "$SRC" status --porcelain --untracked-files=no >&2
  die "upstream worktree has tracked changes; refusing to build or reuse it"
fi
if [ "${SPP_PREPARE_STOP_AFTER:-}" = "worktree" ]; then
  log "prepare-spp-runtime: worktree clean at $SOURCE_COMMIT"
  exit 0
fi

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
# Official circuit-artifacts.sh calls jq. Do not shim it. Install the pinned
# jq 1.7.1 binary and put that directory first on this build's PATH.
ensure_official_jq() {
  local name expect dest dir
  case "$(uname -s)-$(uname -m)" in
    Linux-x86_64)
      name="jq-linux-amd64"
      expect="5942c9b0934e510ee61eb3e30273f1b3fe2590df93933a93d7c58b81d19c8ff5"
      ;;
    Linux-aarch64|Linux-arm64)
      name="jq-linux-arm64"
      expect="4dd2d8a0661df0b22f1bb9a1f9830f06b6f3b8f7d91211a1ef5d7c4f06a8b4a5"
      ;;
    *)
      die "no pinned jq 1.7.1 binary for $(uname -s)-$(uname -m)"
      ;;
  esac
  dir="$BUILD_ROOT/bin"
  dest="$dir/jq"
  mkdir -p "$dir"
  if [ ! -f "$dest" ] || ! echo "$expect  $dest" | sha256sum -c - >/dev/null 2>&1; then
    log "COMMAND: curl jq 1.7.1 $name"
    curl -fsSL -o "$dest.partial" "https://github.com/jqlang/jq/releases/download/jq-1.7.1/$name"
    if ! echo "$expect  $dest.partial" | sha256sum -c -; then
      rm -f "$dest.partial"
      die "jq 1.7.1 checksum mismatch; refusing to continue"
    fi
    chmod +x "$dest.partial"
    mv "$dest.partial" "$dest"
  fi
  echo "$expect  $dest" | sha256sum -c - || die "jq 1.7.1 checksum mismatch; refusing to continue"
  export PATH="$dir:$PATH"
  log "jq on build PATH: $dest ($("$dest" --version))"
}
ensure_official_jq
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

# Panic locations and registry paths must not depend on this machine.
# CARGO_ENCODED_RUSTFLAGS overrides RUSTFLAGS, so both carry the same remaps.
if [ -n "${RUSTFLAGS:-}${CARGO_ENCODED_RUSTFLAGS:-}" ]; then
  die "RUSTFLAGS or CARGO_ENCODED_RUSTFLAGS is already set; refusing a mixed flag set"
fi
mkdir -p "$CARGO_HOME" "$RUSTUP_HOME"
remap_from_to() {
  python3 - "$@" <<'PY'
import os, sys
pairs = []
args = sys.argv[1:]
tokens = {"src": "/spp-src", "cargo": "/cargo", "rustup": "/rustup"}
for item in args:
    key, path = item.split("=", 1)
    path = os.path.abspath(path)
    real = os.path.realpath(path)
    for candidate in (path, real):
        if candidate and candidate not in [p for p, _ in pairs]:
            pairs.append((candidate, tokens[key]))
pairs.sort(key=lambda pair: len(pair[0]), reverse=True)
flags = [f"--remap-path-prefix={src}={dst}" for src, dst in pairs]
print("\n".join(flags))
PY
}
mapfile -t REMAP_ARGS < <(remap_from_to "src=$SRC" "cargo=$CARGO_HOME" "rustup=$RUSTUP_HOME")
[ "${#REMAP_ARGS[@]}" -ge 3 ] || die "path remap flags were not built"
RUSTFLAGS="${REMAP_ARGS[*]}"
export RUSTFLAGS
CARGO_ENCODED_RUSTFLAGS="$(printf '%s\037' "${REMAP_ARGS[@]}")"
CARGO_ENCODED_RUSTFLAGS="${CARGO_ENCODED_RUSTFLAGS%$'\037'}"
export CARGO_ENCODED_RUSTFLAGS
log "COMMAND: rustc path remap (longest prefix first)"
printf '  %s\n' "${REMAP_ARGS[@]}"

log "COMMAND: bash sdk/web/scripts/build.sh"
( cd "$SRC" && bash sdk/web/scripts/build.sh )

log "COMMAND: scan shipped wasm and bindgen glue for host paths"
python3 - "$SRC/sdk/web/dist" "$SRC" "$CARGO_HOME" "$RUSTUP_HOME" <<'PY'
import os, sys
from pathlib import Path

dist, src, cargo, rustup = map(Path, sys.argv[1:])
needles = []
for path in (src, cargo, rustup):
    for candidate in (path.resolve(), Path(os.path.realpath(path))):
        text = str(candidate)
        if text not in needles:
            needles.append(text)

def leb(data, i):
    n = s = 0
    while True:
        b = data[i]
        i += 1
        n |= (b & 0x7F) << s
        if b < 128:
            return n, i
        s += 7

def custom_sections(data):
    if data[:4] != b"\0asm":
        return
    i = 8
    while i < len(data):
        sid = data[i]
        i += 1
        size, i = leb(data, i)
        body = data[i : i + size]
        i += size
        if sid != 0 or not body:
            continue
        nlen, j = leb(body, 0)
        name = body[j : j + nlen].decode("utf-8", "replace")
        yield name, body[j + nlen :]

scanned = []
for path in sorted(dist.rglob("*")):
    if not path.is_file():
        continue
    if path.suffix not in {".wasm", ".js"}:
        continue
    if "circuits" in path.parts:
        continue
    data = path.read_bytes()
    scanned.append(path)
    for needle in needles:
        if needle.encode() in data:
            raise SystemExit(f"host path still embedded in {path}: {needle}")
    if path.suffix == ".wasm":
        for name, payload in custom_sections(data):
            strings = []
            i = 0
            while i < len(payload):
                try:
                    n, j = leb(payload, i)
                except Exception:
                    break
                if 0 < n <= 200 and j + n <= len(payload) and all(32 <= b < 127 for b in payload[j : j + n]):
                    strings.append(payload[j : j + n].decode())
                    i = j + n
                else:
                    i += 1
            print(f"custom {path.name} {name}: {strings}")

if not any(path.name == "stellar_private_payments_web_bg.wasm" for path in scanned):
    raise SystemExit("shipped main wasm was not scanned")
print(f"host paths absent from {len(scanned)} shipped wasm/js files")
PY

python3 - "$SRC/sdk/web" "$MANIFEST" "$SOURCE_COMMIT" <<'PY'
import hashlib, json, sys
from pathlib import Path
web, manifest_path, commit = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]
manifest = json.loads(manifest_path.read_text())
if manifest["sourceCommit"] != commit:
    raise SystemExit("manifest sourceCommit drifted")
for rel, expect in manifest["files"].items():
    path = web / rel
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
