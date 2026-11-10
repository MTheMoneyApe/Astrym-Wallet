#!/usr/bin/env python3
"""Hash the 65 distributed SPP files and require the repinned main wasm."""

import hashlib
import json
import sys
from pathlib import Path

MAIN = "dist/stellar_private_payments_web_bg.wasm"
EXPECT_SHA = "8280c686ffc2d55c06a23aec92defb3e21850dd695bcb47a69ac45018b721027"
EXPECT_SIZE = 2445784


def main() -> None:
    manifest_path, root_s, out_path = sys.argv[1:]
    manifest = json.loads(Path(manifest_path).read_text(encoding="utf-8"))
    root = Path(root_s)
    files = manifest["files"]
    if len(files) != 65:
        raise SystemExit(f"manifest has {len(files)} files, want 65")
    lines = []
    for rel, expect in files.items():
        path = root / rel
        data = path.read_bytes()
        got = hashlib.sha256(data).hexdigest()
        if got != expect["sha256"] or len(data) != expect["size"]:
            raise SystemExit(
                f"mismatch {rel}: got {got} {len(data)} "
                f"expected {expect['sha256']} {expect['size']}"
            )
        lines.append(f"{got}  {len(data)}  {rel}")
    data = (root / MAIN).read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    if digest != EXPECT_SHA or len(data) != EXPECT_SIZE:
        raise SystemExit(f"main wasm {digest} {len(data)} is not the repin")
    text = "\n".join(lines) + f"\nmain {digest} {len(data)}\n"
    Path(out_path).write_text(text, encoding="utf-8")
    print(f"main {digest} {len(data)}")
    print(f"files {len(files)}")


if __name__ == "__main__":
    main()
