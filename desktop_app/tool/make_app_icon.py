#!/usr/bin/env python3
"""Build the macOS AppIcon asset set from assets/vaultIcon.png.

The source art is already composed on the macOS icon grid — a warm near-black
squircle body with the vault dial centered inside it — but it was exported
without an alpha channel: the "transparent" surround is a literal painted
checkerboard, and the body's own corners are slightly squarer than Apple's.

This script lifts the body out of the checkerboard, reshapes it to the exact
Apple superellipse, gives it real transparency, and emits every size the asset
catalog declares.

Run from desktop_app/:  python3 tool/make_app_icon.py
"""

from pathlib import Path

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "assets" / "vaultIcon.png"
OUT_DIR = ROOT / "macos" / "Runner" / "Assets.xcassets" / "AppIcon.appiconset"
SIZES = (16, 32, 64, 128, 256, 512, 1024)

CANVAS = 1024
BODY = 822  # squircle side, measured from Apple's own template icon
SQUIRCLE_N = 5.0  # superellipse exponent, fitted to the same template
SUPERSAMPLE = 4

# The source body spans 102..921, but its outermost pixels are antialiased
# against the checkerboard and read as a light halo. Crop inside that halo and
# scale back up; the source corners are squarer than SQUIRCLE_N everywhere, so
# the mask only ever cuts into solid art.
BODY_BOX = (104, 104, 920, 920)

SHADOW_BLUR = 10
SHADOW_OFFSET = 10
SHADOW_ALPHA = 90


def squircle_mask(side: int) -> Image.Image:
    """Antialiased alpha mask for a superellipse of the given side length."""
    hi_res = side * SUPERSAMPLE
    mask = Image.new("L", (hi_res, hi_res), 0)
    pixels = mask.load()
    radius = hi_res / 2
    for y in range(hi_res):
        ny = abs((y + 0.5 - radius) / radius) ** SQUIRCLE_N
        if ny >= 1.0:
            continue
        # Solve |x|^n = 1 - |y|^n for the row's half width.
        half = radius * (1.0 - ny) ** (1.0 / SQUIRCLE_N)
        lo = max(0, int(radius - half))
        end = min(hi_res - 1, int(radius + half))
        for x in range(lo, end + 1):
            pixels[x, y] = 255
    return mask.resize((side, side), Image.LANCZOS)


def build_master() -> Image.Image:
    art = Image.open(SOURCE).convert("RGB")
    body = art.crop(BODY_BOX).resize((BODY, BODY), Image.LANCZOS).convert("RGBA")
    body.putalpha(squircle_mask(BODY))

    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    inset = (CANVAS - BODY) // 2
    canvas.paste(body, (inset, inset), body)

    shadow = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    shadow.paste((0, 0, 0, SHADOW_ALPHA), (0, SHADOW_OFFSET), canvas.getchannel("A"))
    shadow = shadow.filter(ImageFilter.GaussianBlur(SHADOW_BLUR))

    return Image.alpha_composite(shadow, canvas)


def main() -> None:
    master = build_master()
    for size in SIZES:
        master.resize((size, size), Image.LANCZOS).save(OUT_DIR / f"app_icon_{size}.png")
        print(f"wrote app_icon_{size}.png")


if __name__ == "__main__":
    main()
