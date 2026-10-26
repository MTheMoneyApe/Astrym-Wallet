"""Generate Astrym wallet icons from scripts/astrym-source.jpg."""
from __future__ import annotations

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "scripts" / "astrym-source.jpg"
ICONS = ROOT / "packages" / "extension" / "public" / "icons"
BRAND_BG = (18, 18, 18, 255)


def to_square(img: Image.Image) -> Image.Image:
    rgba = img.convert("RGBA")
    w, h = rgba.size
    side = max(w, h)
    canvas = Image.new("RGBA", (side, side), BRAND_BG)
    canvas.paste(rgba, ((side - w) // 2, (side - h) // 2), rgba)
    return canvas


def save_resized(canvas: Image.Image, path: Path, size: int) -> None:
    out = canvas.resize((size, size), Image.Resampling.LANCZOS)
    bg = Image.new("RGBA", (size, size), BRAND_BG)
    bg.alpha_composite(out)
    path.parent.mkdir(parents=True, exist_ok=True)
    bg.convert("RGB").save(path, format="PNG", optimize=True)
    print(f"wrote {path.relative_to(ROOT)} ({size}x{size}, {path.stat().st_size} bytes)")


def main() -> None:
    if not SRC.exists():
        raise SystemExit(f"missing source logo: {SRC}")
    canvas = to_square(Image.open(SRC))
    save_resized(canvas, ICONS / "sym-logo.png", 512)
    save_resized(canvas, ICONS / "icon128.png", 128)
    save_resized(canvas, ICONS / "icon48.png", 48)
    save_resized(canvas, ICONS / "icon16.png", 16)
    save_resized(canvas, ROOT / "sym-logo.png", 512)
    print(f"canvas={canvas.size}")


if __name__ == "__main__":
    main()
