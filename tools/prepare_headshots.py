#!/usr/bin/env python3
"""Resize candidate headshots for the web page.

    python3 tools/prepare_headshots.py "<unzipped Fall 2026 Elections Headshots folder>"

Reads <folder>/candidates/*.png and <folder>/sitting/*.png (the "old" folder holds superseded versions and is
skipped), writes 192 px PNGs to site/img/headshots/ and an index.json listing the slugs. Needs Pillow.
A name maps to a file by lower-casing and joining with dashes: "Majdi 'Gaith' Abuhamdieh" -> majdi-gaith-abuhamdieh.png.
"""
import json
import sys
from pathlib import Path

from PIL import Image

OUT = Path(__file__).resolve().parents[1] / "site" / "img" / "headshots"
SIZE = 192


def main(src):
    src = Path(src)
    OUT.mkdir(parents=True, exist_ok=True)
    slugs = {}
    for group in ("candidates", "sitting"):
        for f in sorted((src / group).glob("*.png")):
            im = Image.open(f).convert("RGBA")
            side = min(im.size)  # crop to a centered square, then scale
            left, top = (im.width - side) // 2, (im.height - side) // 2
            im = im.crop((left, top, left + side, top + side)).resize((SIZE, SIZE), Image.LANCZOS)
            im.save(OUT / f.name, optimize=True)
            slugs[f.stem] = group
    (OUT / "index.json").write_text(json.dumps({"slugs": slugs}, indent=1))
    total = sum(p.stat().st_size for p in OUT.glob("*.png"))
    print(f"{len(slugs)} headshots, {total / 1024:.0f} KB total -> {OUT}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
