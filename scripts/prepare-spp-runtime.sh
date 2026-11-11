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
# The pinned rustup 1.97.1 proxy must win over any image toolchain.
export PATH="$CARGO_HOME/bin${PATH:+:$PATH}"

curl_https() {
  local dest="$1" url="$2"
  rm -f "$dest.partial"
  curl --proto '=https' -fsSL -o "$dest.partial" "$url"
}

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
  curl_https "$installer" "https://static.rust-lang.org/rustup/archive/$RUSTUP_VERSION/$triple/rustup-init"
  if ! echo "$expect  $installer.partial" | sha256sum -c -; then
    rm -f "$installer.partial"
    die "rustup-init checksum mismatch; refusing to continue"
  fi
  chmod +x "$installer.partial"
  mv "$installer.partial" "$installer"
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

bindgen_version() {
  wasm-bindgen --version 2>/dev/null | awk '{print $2}'
}
if [ "$(bindgen_version)" != "$WASM_BINDGEN_VERSION" ]; then
  log "COMMAND: cargo +$RUST_CHANNEL install wasm-bindgen-cli --version $WASM_BINDGEN_VERSION --locked --force"
  cargo "+$RUST_CHANNEL" install wasm-bindgen-cli --version "$WASM_BINDGEN_VERSION" --locked --force
fi
[ "$(bindgen_version)" = "$WASM_BINDGEN_VERSION" ] || die "wasm-bindgen $(bindgen_version) is not $WASM_BINDGEN_VERSION"

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
# The build writes this provenance file inside the temporary upstream checkout.
# Remove only our untracked generated copy before a second clean rebuild; never
# remove or overwrite a file that belongs to the pinned upstream source.
PROVENANCE_REL="sdk/web/SPP_SOURCE_PROVENANCE.json"
if [ -f "$SRC/$PROVENANCE_REL" ] && ! git -C "$SRC" ls-files --error-unmatch "$PROVENANCE_REL" >/dev/null 2>&1; then
  rm -f "$SRC/$PROVENANCE_REL"
fi
dirty="$(git -C "$SRC" status --porcelain --untracked-files=all)"
if [ -n "$dirty" ]; then
  printf '%s\n' "$dirty" >&2
  die "upstream worktree is not clean; refusing to build or reuse it"
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
  curl_https "$TARBALL" "$CIRCUITS_URL"
  if ! echo "$CIRCUITS_SHA256  $TARBALL.partial" | sha256sum -c -; then
    rm -f "$TARBALL.partial"
    die "circuits-v0.7 checksum mismatch; refusing to continue"
  fi
  mv "$TARBALL.partial" "$TARBALL"
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
    curl_https "$dest" "https://github.com/jqlang/jq/releases/download/jq-1.7.1/$name"
    if ! echo "$expect  $dest.partial" | sha256sum -c -; then
      rm -f "$dest.partial"
      die "jq 1.7.1 checksum mismatch; refusing to continue"
    fi
    chmod +x "$dest.partial"
    mv "$dest.partial" "$dest"
  fi
  echo "$expect  $dest" | sha256sum -c - || die "jq 1.7.1 checksum mismatch; refusing to continue"
  # Pinned rustup stays ahead of jq and of any image toolchain.
  export PATH="$CARGO_HOME/bin:$dir:$PATH"
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
circomlib_dirty="$(git -C "$SRC/circuits/src/circomlib" status --porcelain --untracked-files=all)"
if [ -n "$circomlib_dirty" ]; then
  printf '%s\n' "$circomlib_dirty" >&2
  die "circomlib worktree is not clean; refusing to build or reuse it"
fi

# CARGO_ENCODED_RUSTFLAGS replaces .cargo/config.toml rustflags entirely.
# Keep the upstream wasm32 memory link-args and append the path remaps.
if [ -n "${RUSTFLAGS:-}${CARGO_ENCODED_RUSTFLAGS:-}" ]; then
  die "RUSTFLAGS or CARGO_ENCODED_RUSTFLAGS is already set; refusing a mixed flag set"
fi
mkdir -p "$CARGO_HOME" "$RUSTUP_HOME" "$BUILD_ROOT/bin" "$BUILD_ROOT/date-bin"
SOURCE_DATE_EPOCH="$(git -C "$SRC" log -1 --format=%ct)"
export SOURCE_DATE_EPOCH
# The date wrapper is only on PATH for sdk/web/scripts/build.sh, which stamps NOTICE.txt.
cat > "$BUILD_ROOT/date-bin/date" <<'EOF'
#!/bin/sh
# Upstream stamps NOTICE.txt with `date -u +%Y-%m-%dT%H:%M:%SZ`.
# Honor SOURCE_DATE_EPOCH so two machines emit the same notice.
if [ -n "${SOURCE_DATE_EPOCH:-}" ] && [ "$1" = "-u" ] && [ "$2" = "+%Y-%m-%dT%H:%M:%SZ" ]; then
  exec /usr/bin/date -u -d "@${SOURCE_DATE_EPOCH}" "+%Y-%m-%dT%H:%M:%SZ"
fi
exec /usr/bin/date "$@"
EOF
chmod 755 "$BUILD_ROOT/date-bin/date"

CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$SRC/target}"
export CARGO_TARGET_DIR
FLAG_FILE="$BUILD_ROOT/rust-flags.txt"
python3 - "$SRC/.cargo/config.toml" "$FLAG_FILE" \
  "src=$SRC" "cargo=$CARGO_HOME" "rustup=$RUSTUP_HOME" \
  "build=$BUILD_ROOT" "target=$CARGO_TARGET_DIR" "home=$HOME" \
  "circuits=$SRC/circuits" <<'PY'
import os, sys
config_path, flag_file = sys.argv[1], sys.argv[2]
try:
    import tomllib
except ModuleNotFoundError:
    raise SystemExit(
        "python3 tomllib is required to read upstream .cargo/config.toml "
        "(Python 3.11 or newer). Refusing to guess rustflags."
    )
cfg = tomllib.loads(open(config_path, encoding="utf-8").read())
upstream = list(cfg["target"]["wasm32-unknown-unknown"]["rustflags"])
required = [
    "-Clink-arg=--initial-memory=67108864",
    "-Clink-arg=--max-memory=4294967296",
]
missing = [item for item in required if item not in upstream]
if missing:
    raise SystemExit("upstream wasm32 rustflags lost: " + ", ".join(missing))
tokens = {
    "src": "/spp-src",
    "cargo": "/cargo",
    "rustup": "/rustup",
    "build": "/spp-build",
    "target": "/spp-target",
    "home": "/spp-home",
    "circuits": "/spp-circuits",
}
pairs = []
for item in sys.argv[3:]:
    key, path = item.split("=", 1)
    path = os.path.abspath(path)
    real = os.path.realpath(path)
    for candidate in (path, real):
        if candidate and all(candidate != old for old, _ in pairs):
            pairs.append((candidate, tokens[key]))
pairs.sort(key=lambda pair: len(pair[0]), reverse=True)
remaps = [f"--remap-path-prefix={src}={dst}" for src, dst in pairs]
prefix_maps = [f"-ffile-prefix-map={src}={dst}" for src, dst in pairs]
flags = upstream + remaps
open(flag_file, "w", encoding="utf-8").write(
    "RUST\n" + "\n".join(flags) + "\nCFLAGS\n" + "\n".join(prefix_maps) + "\n"
)
PY
mapfile -t RUST_FLAGS < <(awk 'BEGIN{s=0} /^RUST$/{s=1; next} /^CFLAGS$/{s=0; next} s && NF{print}' "$FLAG_FILE")
mapfile -t C_FLAGS < <(awk 'BEGIN{s=0} /^CFLAGS$/{s=1; next} s && NF{print}' "$FLAG_FILE")
[ "${#RUST_FLAGS[@]}" -ge 4 ] || die "combined rustflags were not built"
printf -v RUSTFLAGS '%s ' "${RUST_FLAGS[@]}"
RUSTFLAGS="${RUSTFLAGS% }"
export RUSTFLAGS
CARGO_ENCODED_RUSTFLAGS="$(printf '%s\037' "${RUST_FLAGS[@]}")"
CARGO_ENCODED_RUSTFLAGS="${CARGO_ENCODED_RUSTFLAGS%$'\037'}"
export CARGO_ENCODED_RUSTFLAGS
printf -v CFLAGS '%s ' "${C_FLAGS[@]}"
CFLAGS="${CFLAGS% }"
export CFLAGS
export CXXFLAGS="$CFLAGS"
log "TOOL rustc $(rustc +"$RUST_CHANNEL" --version)"
log "TOOL cargo $(cargo +"$RUST_CHANNEL" --version)"
log "TOOL wasm-bindgen $(wasm-bindgen --version)"
log "TOOL jq $(jq --version)"
log "TOOL git $(git --version)"
log "TOOL python3 $(python3 --version)"
log "SOURCE_DATE_EPOCH $SOURCE_DATE_EPOCH"
log "NOTICE date $($BUILD_ROOT/date-bin/date -u +"%Y-%m-%dT%H:%M:%SZ")"
log "effective RUSTFLAGS: $RUSTFLAGS"
log "effective CFLAGS: $CFLAGS"
log "PATH rustup $(command -v rustup) cargo $(command -v cargo)"

# Upstream build.sh checksums the binaryen tarball only when wasm-opt is absent.
# An existing binary is accepted on its version string alone. Download the
# pinned tarball here, fail if the SHA-256 does not match, then let build.sh
# use that tree.
pin_binaryen() {
  local platform expect url dest dir
  case "$(uname -s)-$(uname -m)" in
    Linux-x86_64)
      platform="x86_64-linux"
      expect="b5bf1f0eaf17c63ee588ff7a5954dc8f6ce2c26989051c66f24dfe9ece3e46db"
      ;;
    Linux-aarch64|Linux-arm64)
      platform="aarch64-linux"
      expect="ba991f677edd9a21d2bc96c0144bc8ac5b112d4d98a3eb266e075e22e557df2a"
      ;;
    *)
      die "no pinned binaryen 131 tarball for $(uname -s)-$(uname -m)"
      ;;
  esac
  dir="$SRC/target/tmp/binaryen"
  dest="$dir/binaryen-version_131-${platform}.tar.gz"
  rm -rf "$dir"
  mkdir -p "$dir"
  url="https://github.com/WebAssembly/binaryen/releases/download/version_131/binaryen-version_131-${platform}.tar.gz"
  log "COMMAND: curl binaryen version_131 $platform"
  curl_https "$dest" "$url"
  if ! echo "$expect  $dest.partial" | sha256sum -c -; then
    rm -f "$dest.partial"
    die "binaryen version_131 checksum mismatch; refusing to continue"
  fi
  mv "$dest.partial" "$dest"
  tar -xzf "$dest" -C "$dir"
  rm -f "$dest"
  [ -x "$dir/binaryen-version_131/bin/wasm-opt" ] || die "wasm-opt missing after the checksummed binaryen extract"
  unset WASM_OPT
  log "binaryen version_131 tarball sha256 $expect"
}
pin_binaryen

# Preserve each transformation boundary so a manifest mismatch can be attributed.
DIAGNOSTIC_LABEL="${SPP_DIAGNOSTIC_LABEL:-primary}"
case "$DIAGNOSTIC_LABEL" in
  ""|*[!A-Za-z0-9._-]*) die "invalid SPP_DIAGNOSTIC_LABEL: $DIAGNOSTIC_LABEL" ;;
esac
DIAGNOSTIC_DIR="$BUILD_ROOT/diagnostics/$DIAGNOSTIC_LABEL"
WRAPPER_DIR="$BUILD_ROOT/wrappers"
SPP_WASM_TARGET="wasm32-unknown-unknown"
SPP_BUILD_PROFILE="${WASM_PROFILE:-release}"
mkdir -p "$DIAGNOSTIC_DIR" "$WRAPPER_DIR"

REAL_WASM_OPT="$SRC/target/tmp/binaryen/binaryen-version_131/bin/wasm-opt"
REAL_WASM_BINDGEN="$(command -v wasm-bindgen)"
[ -x "$REAL_WASM_OPT" ] || die "pinned wasm-opt binary missing"
[ -x "$REAL_WASM_BINDGEN" ] || die "pinned wasm-bindgen binary missing"

cat > "$WRAPPER_DIR/wasm-opt" <<'PY'
#!/usr/bin/env python3
import hashlib, json, os, subprocess, sys
from pathlib import Path

real = os.environ["SPP_REAL_WASM_OPT"]
trace = Path(os.environ["SPP_WASM_OPT_TRACE"])
args = sys.argv[1:]
if not any(arg.endswith(".wasm") for arg in args):
    raise SystemExit(subprocess.run([real, *args]).returncode)

def inspect(raw):
    path = Path(raw)
    if not path.is_file():
        return {"path": raw, "missing": True}
    data = path.read_bytes()
    return {"path": str(path), "sha256": hashlib.sha256(data).hexdigest(), "size": len(data)}

inputs = [arg for arg in args if arg.endswith(".wasm") and Path(arg).is_file()]
outputs = []
for index, arg in enumerate(args[:-1]):
    if arg == "-o" and args[index + 1].endswith(".wasm"):
        outputs.append(args[index + 1])
before = [inspect(path) for path in inputs]
result = subprocess.run([real, *args])
after = [inspect(path) for path in (outputs or inputs)]
event = {
    "tool": "wasm-opt",
    "executable": real,
    "cwd": os.getcwd(),
    "args": args,
    "input_before": before,
    "output_after": after,
    "returncode": result.returncode,
}
trace.parent.mkdir(parents=True, exist_ok=True)
with trace.open("a", encoding="utf-8") as stream:
    stream.write(json.dumps(event, sort_keys=True) + "\n")
raise SystemExit(result.returncode)
PY

cat > "$WRAPPER_DIR/wasm-bindgen" <<'PY'
#!/usr/bin/env python3
import hashlib, json, os, subprocess, sys
from pathlib import Path

real = os.environ["SPP_REAL_WASM_BINDGEN"]
trace = Path(os.environ["SPP_WASM_BINDGEN_TRACE"])
args = sys.argv[1:]
if not any(arg.endswith(".wasm") for arg in args):
    raise SystemExit(subprocess.run([real, *args]).returncode)

def inspect(raw):
    path = Path(raw)
    if not path.is_file():
        return {"path": raw, "missing": True}
    data = path.read_bytes()
    return {"path": str(path), "sha256": hashlib.sha256(data).hexdigest(), "size": len(data)}

inputs = [arg for arg in args if arg.endswith(".wasm") and Path(arg).is_file()]
out_dir = Path(args[args.index("--out-dir") + 1]) if "--out-dir" in args else None
out_name = args[args.index("--out-name") + 1] if "--out-name" in args else None
outputs = [out_dir / f"{out_name}_bg.wasm"] if out_dir and out_name else []
before = [inspect(path) for path in inputs]
result = subprocess.run([real, *args])
after = [inspect(path) for path in outputs]
event = {
    "tool": "wasm-bindgen",
    "executable": real,
    "cwd": os.getcwd(),
    "args": args,
    "input_before": before,
    "output_after": after,
    "returncode": result.returncode,
}
trace.parent.mkdir(parents=True, exist_ok=True)
with trace.open("a", encoding="utf-8") as stream:
    stream.write(json.dumps(event, sort_keys=True) + "\n")
raise SystemExit(result.returncode)
PY
chmod 755 "$WRAPPER_DIR/wasm-opt" "$WRAPPER_DIR/wasm-bindgen"

export SPP_REAL_WASM_OPT="$REAL_WASM_OPT"
export SPP_REAL_WASM_BINDGEN="$REAL_WASM_BINDGEN"
export SPP_WASM_OPT_TRACE="$DIAGNOSTIC_DIR/wasm-opt.jsonl"
export SPP_WASM_BINDGEN_TRACE="$DIAGNOSTIC_DIR/wasm-bindgen.jsonl"
export WASM_OPT="$WRAPPER_DIR/wasm-opt"
export PATH="$WRAPPER_DIR:$PATH"

python3 - "$DIAGNOSTIC_DIR/toolchain.json" "$REAL_WASM_OPT" "$REAL_WASM_BINDGEN" <<'PY'
import hashlib, json, shutil, subprocess, sys
from pathlib import Path

output = Path(sys.argv[1])
tools = {
    "wasm-opt": sys.argv[2],
    "wasm-bindgen": sys.argv[3],
    "rustc": shutil.which("rustc"),
    "cargo": shutil.which("cargo"),
    "cc": shutil.which("cc"),
    "clang": shutil.which("clang"),
    "clang-18": shutil.which("clang-18"),
    "ar": shutil.which("ar"),
    "llvm-ar": shutil.which("llvm-ar"),
    "wasm-ld": shutil.which("wasm-ld"),
    "wasm-ld-18": shutil.which("wasm-ld-18"),
}
result = {}
for name, raw in tools.items():
    if not raw:
        result[name] = None
        continue
    path = Path(raw)
    item = {"path": str(path.resolve())}
    if path.is_file():
        data = path.read_bytes()
        item["sha256"] = hashlib.sha256(data).hexdigest()
        item["size"] = len(data)
    try:
        proc = subprocess.run([raw, "--version"], capture_output=True, text=True, timeout=15)
        item["version"] = (proc.stdout or proc.stderr).strip().splitlines()[:4]
        item["versionExit"] = proc.returncode
    except Exception as exc:
        item["versionError"] = str(exc)
    result[name] = item
output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
print("recorded toolchain identities:", output)
PY

capture_spp_build_evidence() {
  local build_status="$1"
  python3 - "$CARGO_TARGET_DIR" "$SPP_WASM_TARGET" "$SPP_BUILD_PROFILE" "$DIAGNOSTIC_DIR" "$build_status" <<'PY'
import hashlib, json, shutil, sys, tarfile
from pathlib import Path

target_root, target_name, profile, diag, build_status = Path(sys.argv[1]), sys.argv[2], sys.argv[3], Path(sys.argv[4]), int(sys.argv[5])
target_root = target_root.resolve()
diag.mkdir(parents=True, exist_ok=True)

raw_dir = target_root / target_name / profile
raw_names = [
    "stellar_private_payments_web.wasm",
    "storage-worker.wasm",
    "prover-worker.wasm",
]
raw_report = {}
raw_out = diag / "raw-wasm"
raw_out.mkdir(exist_ok=True)
for name in raw_names:
    source = raw_dir / name
    if source.is_file():
        data = source.read_bytes()
        shutil.copy2(source, raw_out / name)
        raw_report[name] = {
            "sha256": hashlib.sha256(data).hexdigest(),
            "size": len(data),
            "source": str(source),
        }
    else:
        raw_report[name] = {"missing": True, "source": str(source)}
(diag / "raw-wasm.json").write_text(json.dumps(raw_report, indent=2, sort_keys=True) + "\n")

build_dirs = []
for root in (target_root / target_name / profile / "build", target_root / profile / "build"):
    if root.is_dir():
        build_dirs.extend(sorted(p for p in root.glob("sqlite-wasm-rs-*") if p.is_dir()))

report = {"targetRoot": str(target_root), "buildStatus": build_status, "directories": [], "archives": []}
archive_path = diag / "sqlite-wasm-rs-build-evidence.tar.gz"
if build_dirs:
    with tarfile.open(archive_path, "w:gz") as archive:
        for directory in build_dirs:
            archive.add(directory, arcname=directory.name)
            files = []
            for path in sorted(p for p in directory.rglob("*") if p.is_file()):
                data = path.read_bytes()
                files.append({
                    "path": str(path.relative_to(directory)),
                    "sha256": hashlib.sha256(data).hexdigest(),
                    "size": len(data),
                })
                if path.name.endswith(".a"):
                    report["archives"].append({
                        "path": str(path),
                        "name": path.name,
                        "sha256": hashlib.sha256(data).hexdigest(),
                        "size": len(data),
                    })
            item = {"directory": str(directory), "files": files}
            for log_name in ("output", "stderr", "root-output"):
                log_path = directory / log_name
                if log_path.is_file():
                    item[log_name] = log_path.read_text(errors="replace")[:500000]
            report["directories"].append(item)
else:
    report["note"] = "No sqlite-wasm-rs build-script directory found under this Cargo target."

(diag / "sqlite-build-report.json").write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
print(f"captured {len(build_dirs)} sqlite-wasm-rs build directory(ies) at {diag}")
PY
}

log "COMMAND: bash sdk/web/scripts/build.sh (with stage tracing)"
if ( cd "$SRC" && PATH="$BUILD_ROOT/date-bin:$PATH" bash sdk/web/scripts/build.sh ); then
  SPP_BUILD_STATUS=0
else
  SPP_BUILD_STATUS=$?
fi
capture_spp_build_evidence "$SPP_BUILD_STATUS"
if [ "$SPP_BUILD_STATUS" -ne 0 ]; then
  die "upstream SDK build failed with status $SPP_BUILD_STATUS; diagnostics preserved at $DIAGNOSTIC_DIR"
fi

log "COMMAND: scan shipped files for host paths and wasm memory limits"
python3 - "$SRC/sdk/web" "$SRC" "$CARGO_HOME" "$RUSTUP_HOME" "$BUILD_ROOT" \
  "$CARGO_TARGET_DIR" "$HOME" "$SRC/circuits" "$SRC/target/circuits-artifacts" \
  "$SRC/deployments/testnet/circuit_keys" <<'PY'
import os, sys
from pathlib import Path

web = Path(sys.argv[1])
needles = []
for raw in sys.argv[2:]:
    path = Path(raw)
    for candidate in (path.resolve(), Path(os.path.realpath(path))):
        text = str(candidate)
        if text and text not in needles:
            needles.append(text)
needles.append("/tmp/")

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

def memory_limits(data):
    if data[:4] != b"\0asm":
        raise SystemExit("shipped wasm is not a wasm module")
    i = 8
    while i < len(data):
        sid = data[i]
        i += 1
        size, i = leb(data, i)
        body = data[i : i + size]
        i += size
        if sid != 5:
            continue
        count, j = leb(body, 0)
        if count != 1:
            raise SystemExit(f"wasm memory count {count}")
        flags = body[j]
        j += 1
        initial, j = leb(body, j)
        maximum = None
        if flags & 1:
            maximum, j = leb(body, j)
        return flags, initial, maximum, body.hex()
    raise SystemExit("wasm has no memory section")

scan_suffixes = {".wasm", ".js", ".txt", ".json"}
scanned = []
for path in sorted(web.rglob("*")):
    if not path.is_file() or path.suffix not in scan_suffixes:
        continue
    if path.name == "source-bundle.tar.gz":
        continue
    data = path.read_bytes()
    scanned.append(path)
    for needle in needles:
        if needle.encode() in data:
            raise SystemExit(f"host path still embedded in {path}: {needle}")
    if path.suffix == ".wasm":
        flags, initial, maximum, raw = memory_limits(data)
        # .cargo/config.toml: initial 64 MiB (1024 pages), max 4 GiB (65536 pages).
        if (flags, initial, maximum) != (1, 1024, 65536):
            raise SystemExit(
                f"wasm memory {path.name} {flags},{initial},{maximum} raw {raw} "
                "is not the upstream 64 MiB / 4 GiB limit"
            )
        print(f"memory {path.name}: flags={flags} initial_pages={initial} max_pages={maximum} raw={raw}")
    if path.name == "stellar_private_payments_web_bg.wasm":
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
print(f"host paths absent from {len(scanned)} shipped files")
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
