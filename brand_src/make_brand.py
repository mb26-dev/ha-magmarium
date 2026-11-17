"""Generate the Magmarium brand images (icon, logo, dark variants) from the artwork.

The artwork lives in brand_src/magmarium_logo.jpg; this script renders the PNG sizes
Home Assistant needs. The GitHub workflow runs it on every change in brand_src.
"""
from pathlib import Path
from PIL import Image, ImageDraw

SRC = Path(__file__).resolve().parent / "magmarium_logo.jpg"
OUT = Path(__file__).resolve().parents[1] / "custom_components" / "magmarium" / "brand"
OUT.mkdir(parents=True, exist_ok=True)

art = Image.open(SRC).convert("RGBA")
W, H = art.size


def rounded(im: Image.Image, radius_frac: float) -> Image.Image:
    """Transparent rounded corners, drawn at 4x and scaled down for smooth edges."""
    w, h = im.size
    big = Image.new("L", (w * 4, h * 4), 0)
    r = int(min(w, h) * radius_frac * 4)
    ImageDraw.Draw(big).rounded_rectangle([0, 0, w * 4 - 1, h * 4 - 1], radius=r, fill=255)
    mask = big.resize((w, h), Image.LANCZOS)
    out = im.copy()
    out.putalpha(mask)
    return out


# icon: the emblem (volcano in its ring) as a square
side = H
left = round(W * 70 / 2576)  # the emblem starts about 70 px from the left in the 2576 px artwork
emblem = art.crop((left, 0, left + side, side))
for name, size in (("icon.png", 256), ("icon@2x.png", 512)):
    rounded(emblem.resize((size, size), Image.LANCZOS), 0.18).save(OUT / name, optimize=True)

# logo: the full banner, shortest side 128 / 256 px; dark background works on light and dark themes
for suffix, height in (("", 128), ("@2x", 256)):
    width = round(W * height / H)
    logo = rounded(art.resize((width, height), Image.LANCZOS), 0.14)
    for base in ("logo", "dark_logo"):
        logo.save(OUT / f"{base}{suffix}.png", optimize=True)

print("brand images written to", OUT)
