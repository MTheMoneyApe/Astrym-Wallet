#!/usr/bin/env python3
"""Keep Import, Memory, and Export details from `wasm-objdump -x`."""

import sys

HEADINGS = ("Import[", "Memory[", "Export[")


def main() -> None:
    lines = sys.stdin.read().splitlines()
    blocks: list[str] = []
    keep = False
    for line in lines:
        if line.startswith(HEADINGS):
            keep = True
            blocks.append(line)
            continue
        if keep and line and line[0].isalpha() and "[" in line and line.endswith(":"):
            keep = False
            continue
        if keep:
            blocks.append(line)
    if not any(line.startswith("Import[") for line in blocks):
        raise SystemExit("wasm-objdump output has no Import section")
    if not any(line.startswith("Memory[") for line in blocks):
        raise SystemExit("wasm-objdump output has no Memory section")
    if not any(line.startswith("Export[") for line in blocks):
        raise SystemExit("wasm-objdump output has no Export section")
    sys.stdout.write("\n".join(blocks).rstrip() + "\n")


if __name__ == "__main__":
    main()
