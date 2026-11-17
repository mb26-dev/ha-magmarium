"""Generate the Magmarium brand images (icon, logo, dark variants)."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont
import math

OUT = Path(__file__).resolve().parents[1] / "custom_components" / "magmarium" / "brand"
OUT.mkdir(parents=True, exist_ok=True)
S = 1024


def globe_layer(size):
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    cx, cy, r = size * 0.5, size * 0.6, size * 0.38
    # ocean globe with night-side shading
    for i in range(int(r), 0, -2):
        f = i / r
        col = (int(14 + 30 * (1 - f)), int(44 + 70 * (1 - f)), int(92 + 90 * (1 - f)), 255)
        d.ellipse([cx - i, cy - i, cx + i, cy + i], fill=col)
    # atmosphere rim
    rim = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(rim).ellipse([cx - r - 10, cy - r - 10, cx + r + 10, cy + r + 10], outline=(120, 185, 255, 210), width=14)
    rim = rim.filter(ImageFilter.GaussianBlur(10))
    im = Image.alpha_composite(rim, im)
    return im, (cx, cy, r)


def volcano(size, cx, base_y, w, h):
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    top = base_y - h
    tw = w * 0.28
    poly = [(cx - w, base_y), (cx - tw, top), (cx + tw, top), (cx + w, base_y)]
    # body with a horizontal light gradient
    body = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    bd = ImageDraw.Draw(body)
    for x in range(int(cx - w), int(cx + w) + 1):
        f = (x - (cx - w)) / (2 * w)
        col = (int(160 - 120 * f), int(124 - 100 * f), int(94 - 78 * f), 255)
        bd.line([(x, top), (x, base_y)], fill=col)
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).polygon(poly, fill=255)
    im.paste(body, (0, 0), mask)
    # lava streaks
    lava = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ld = ImageDraw.Draw(lava)
    for f, wd in ((-0.4, 22), (0.25, 18)):
        pts = []
        for k in range(30):
            u = k / 29
            pts.append((cx + tw * f * 1.2 + (w * f * 0.85 - tw * f * 1.2) * u + math.sin(u * 5) * 8, top + 8 + (h * 0.85) * u))
        ld.line(pts, fill=(255, 140, 40, 255), width=wd, joint="curve")
    glow = lava.filter(ImageFilter.GaussianBlur(14))
    im = Image.alpha_composite(im, glow)
    lava_masked = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    lava_masked.paste(lava, (0, 0), mask)
    im = Image.alpha_composite(im, lava_masked)
    # crater
    d = ImageDraw.Draw(im)
    d.ellipse([cx - tw * 1.05, top - h * 0.06, cx + tw * 1.05, top + h * 0.06], fill=(255, 196, 90, 255))
    return im, top


def plume(size, cx, top):
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    puffs = [(0, 0, 46), (-10, -48, 56), (8, -98, 64), (-22, -146, 72), (12, -192, 76), (-40, -224, 64), (46, -230, 62), (0, -258, 56)]
    for i, (dx, dy, r) in enumerate(puffs):
        f = i / (len(puffs) - 1)
        col = (int(90 + 140 * f), int(84 + 140 * f), int(80 + 140 * f), 255)
        d.ellipse([cx + dx - r, top + dy - r, cx + dx + r, top + dy + r], fill=col)
    im = im.filter(ImageFilter.GaussianBlur(4))
    return im


def icon(size_out, dark=False):
    g, (cx, cy, r) = globe_layer(S)
    base_y = cy + r * 0.32
    v, top = volcano(S, cx, base_y, r * 0.78, r * 0.95)
    p = plume(S, cx, top - 40)
    glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse([cx - 170, top - 170, cx + 170, top + 150], fill=(255, 120, 30, 170))
    glow = glow.filter(ImageFilter.GaussianBlur(70))
    im = Image.alpha_composite(g, glow)
    im = Image.alpha_composite(im, p)
    im = Image.alpha_composite(im, v)
    # keep everything inside the globe circle except the plume top
    return im.resize((size_out, size_out), Image.LANCZOS)


def logo(height_out, dark=False):
    ic = icon(1024)
    w = int(1024 * 4.6)
    im = Image.new("RGBA", (w, 1024), (0, 0, 0, 0))
    im.paste(ic, (0, 0), ic)
    d = ImageDraw.Draw(im)
    font = None
    for name in ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"):
        try:
            font = ImageFont.truetype(name, 400)
            break
        except OSError:
            continue
    text_col = (240, 238, 234, 255) if dark else (34, 30, 28, 255)
    d.text((1060, 290), "Magma", font=font, fill=text_col)
    mw = d.textlength("Magma", font=font)
    d.text((1060 + mw, 290), "rium", font=font, fill=(255, 140, 40, 255))
    bbox = im.getbbox()
    im = im.crop(bbox)
    ratio = height_out / im.height
    return im.resize((int(im.width * ratio), height_out), Image.LANCZOS)


icon(256).save(OUT / "icon.png")
icon(512).save(OUT / "icon@2x.png")
logo(128).save(OUT / "logo.png")
logo(256).save(OUT / "logo@2x.png")
logo(128, dark=True).save(OUT / "dark_logo.png")
logo(256, dark=True).save(OUT / "dark_logo@2x.png")
print("brand images written to", OUT)
