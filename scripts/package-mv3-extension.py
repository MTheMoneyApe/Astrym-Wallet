#!/usr/bin/env python3
"""Create and verify a browser-installable ZIP from a built MV3 extension."""
from __future__ import annotations

import json
import os
import sys
import zipfile
from pathlib import Path

def fail(message: str) -> None:
    raise SystemExit(f"package-mv3-extension: {message}")

if len(sys.argv) != 3:
    fail("usage: package-mv3-extension.py <extension-dist> <output-zip>")

source = Path(sys.argv[1]).resolve()
destination = Path(sys.argv[2]).resolve()
if not source.is_dir():
    fail(f"extension build directory does not exist: {source}")

manifest_path = source / "manifest.json"
if not manifest_path.is_file():
    fail("manifest.json is missing")
manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
if manifest.get("manifest_version") != 3:
    fail("manifest_version must be 3")
if not manifest.get("background", {}).get("service_worker"):
    fail("background service worker is missing")

destination.parent.mkdir(parents=True, exist_ok=True)
files = sorted(path for path in source.rglob("*") if path.is_file())
if not files:
    fail("extension build directory is empty")

with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=1, allowZip64=True) as archive:
    for path in files:
        relative = path.relative_to(source)
        if relative.is_absolute() or ".." in relative.parts:
            fail(f"unsafe archive path: {relative}")
        if path.is_symlink():
            fail(f"symlink is not allowed in extension package: {relative}")
        archive.write(path, relative.as_posix())

with zipfile.ZipFile(destination, "r") as archive:
    bad = archive.testzip()
    if bad is not None:
        fail(f"archive integrity check failed at {bad}")
    names = set(archive.namelist())
    if "manifest.json" not in names:
        fail("manifest.json is not at the archive root")
    if manifest["background"]["service_worker"] not in names:
        fail("background service worker is absent from archive")
    if "spp/SPP_ASSET_META.json" not in names:
        fail("SPP full asset metadata is absent from archive")
    zipped_manifest = json.loads(archive.read("manifest.json").decode("utf-8"))
    if zipped_manifest != manifest:
        fail("manifest changed while packaging")

print(json.dumps({
    "ok": True,
    "files": len(files),
    "bytes": destination.stat().st_size,
    "manifestVersion": manifest["manifest_version"],
    "serviceWorker": manifest["background"]["service_worker"],
}, indent=2))
