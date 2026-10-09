#!/usr/bin/env python3
"""
AuraFlow brand asset generator.

Draws the AuraFlow "dagger cross" mark (a gothic double-edged blade with a
hilt guard, rendered in blood red) and writes every icon the app needs:

  build/icon.png              1024px master (Linux, electron-builder source)
  build/icon.icns             macOS application icon (all standard sizes)
  build/icon.ico              Windows application icon (16/24/32/48/64/128/256)
  build/icons/<N>x<N>.png     Linux icon set
  assets/tray/tray_icon*.png  macOS template (monochrome) menu-bar icon, 22px + @2x
  assets/tray/tray_color*.png Windows/Linux tray idle icon (black disc, blood-red blade), 16px + @2x
  assets/tray/tray_recording_<k>*.png        macOS pulsing-glow frames (22px + @2x)
  assets/tray/tray_recording_win_<k>*.png    Windows/Linux pulsing-glow frames (16px + @2x)
  assets/brand/aura-icon-1024.png
  assets/brand/logo-dagger.svg, assets/brand/logo-disc.svg

Requirements: Python 3.9+ and Pillow (pip install pillow).
Run from the repository root:  python3 scripts/generate_icons.py
"""

from __future__ import annotations

import math
import pathlib

from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = pathlib.Path(__file__).resolve().parent.parent

# --- Brand palette (matches the CSS design tokens in src/renderer/styles) ----
BLACK = (10, 10, 10)            # #0A0A0A
CHARCOAL = (18, 18, 18)         # #121212
BLOOD = (229, 9, 20)            # #E50914
BLOOD_DEEP = (139, 0, 0)        # #8B0000
BLOOD_HOT = (255, 62, 62)

# --- Geometry in a 1024 x 1024 design grid (shared with the SVG logo) -------
BLADE = [(512, 232), (548, 360), (556, 430), (548, 520), (512, 792),
         (476, 520), (468, 430), (476, 360)]
GUARD = [(292, 372), (346, 352), (476, 352), (548, 352), (678, 352),
         (732, 372), (678, 392), (548, 392), (476, 392), (346, 392)]
GEM = [(512, 356), (524, 372), (512, 388), (500, 372)]
DISC_CENTER = 512
DISC_RADIUS = 412


def transform(points, scale: float, dx: float, dy: float):
    return [(x * scale + dx, y * scale + dy) for x, y in points]


def fit(size: int, pad: float):
    """Scale + offset that fits the dagger (560 units tall) inside `size` px."""
    scale = (size - 2 * pad) / 560.0
    dx = size / 2.0 - 512 * scale
    dy = pad - 232 * scale
    return scale, dx, dy


def dagger_mask(size: int, scale: float, dx: float, dy: float) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.polygon(transform(BLADE, scale, dx, dy), fill=255)
    draw.polygon(transform(GUARD, scale, dx, dy), fill=255)
    return mask


def vertical_gradient(size: int, top_y: float, bottom_y: float) -> Image.Image:
    """RGBA gradient: hot red at the tip, deep blood at the base."""
    grad = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(grad)
    stops = [(0.0, BLOOD_HOT), (0.45, BLOOD), (1.0, BLOOD_DEEP)]
    for y in range(size):
        t = (y - top_y) / max(1.0, bottom_y - top_y)
        t = min(1.0, max(0.0, t))
        for i in range(len(stops) - 1):
            t0, c0 = stops[i]
            t1, c1 = stops[i + 1]
            if t0 <= t <= t1:
                k = (t - t0) / (t1 - t0)
                color = tuple(int(c0[j] + (c1[j] - c0[j]) * k) for j in range(3))
                break
        else:
            color = stops[-1][1]
        draw.line([(0, y), (size, y)], fill=color + (255,))
    return grad


def scaled_alpha(mask: Image.Image, factor: float) -> Image.Image:
    return mask.point(lambda v: min(255, int(v * factor)))


def colored_layer(size: int, color, alpha_mask: Image.Image) -> Image.Image:
    layer = Image.new("RGBA", (size, size), color + (0,))
    layer.putalpha(alpha_mask)
    return layer


def render_app_icon(size: int = 2048) -> Image.Image:
    """Full-colour app icon on a transparent square, with a black disc."""
    k = size / 1024.0
    base = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(base)

    # Disc background
    c = DISC_CENTER * k
    r = DISC_RADIUS * k
    disc_box = (c - r, c - r, c + r, c + r)
    disc_mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(disc_mask).ellipse(disc_box, fill=255)
    draw.ellipse(disc_box, fill=BLACK + (255,))

    # Subtle central blood haze inside the disc
    haze = Image.radial_gradient("L").resize((size, size), Image.BILINEAR)
    haze = ImageChops.invert(haze).point(lambda v: int(v * 0.30))
    haze = ImageChops.multiply(haze, disc_mask)
    base = Image.alpha_composite(base, colored_layer(size, BLOOD_DEEP, haze))

    # Rings
    ring = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    rd = ImageDraw.Draw(ring)
    rd.ellipse((c - r + 6 * k, c - r + 6 * k, c + r - 6 * k, c + r - 6 * k),
               outline=BLOOD_DEEP + (255,), width=max(2, int(12 * k)))
    rd.ellipse((c - r * 0.94, c - r * 0.94, c + r * 0.94, c + r * 0.94),
               outline=BLOOD + (110,), width=max(1, int(3 * k)))
    base = Image.alpha_composite(base, ring)

    # Dagger glow (wide + tight)
    scale, dx, dy = k, 0.0, 0.0
    mask = dagger_mask(size, scale, dx, dy)
    wide = scaled_alpha(mask.filter(ImageFilter.GaussianBlur(26 * k)), 0.95)
    tight = scaled_alpha(mask.filter(ImageFilter.GaussianBlur(9 * k)), 0.70)
    base = Image.alpha_composite(base, colored_layer(size, BLOOD, wide))
    base = Image.alpha_composite(base, colored_layer(size, BLOOD, tight))

    # Dagger body with a vertical blood gradient, then the hilt gem
    core = vertical_gradient(size, 232 * k, 792 * k)
    core_mask = mask
    body = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    body.paste(core, (0, 0), core_mask)
    gem = [(x * k, y * k) for x, y in GEM]
    ImageDraw.Draw(body).polygon(gem, fill=BLACK + (255,))
    base = Image.alpha_composite(base, body)
    return base


def render_disc_mark(size: int) -> Image.Image:
    """Smaller, mono-disc version used for tray icons (red blade on black disc)."""
    ss = 8
    big = size * ss
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    inset = 0.5 * ss
    draw.ellipse((inset, inset, big - inset, big - inset), fill=BLACK + (255,))
    scale, dx, dy = fit(big, pad=big * 0.20)
    mask = dagger_mask(big, scale, dx, dy)
    img = Image.alpha_composite(img, colored_layer(big, BLOOD, mask))
    return img.resize((size, size), Image.LANCZOS)


def render_template(size: int) -> Image.Image:
    """macOS template image: black pixels only, alpha carries the shape."""
    ss = 8
    big = size * ss
    scale, dx, dy = fit(big, pad=big * 0.06)
    mask = dagger_mask(big, scale, dx, dy)
    small_mask = mask.resize((size, size), Image.LANCZOS)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.putalpha(small_mask)
    return out


def render_recording_frame(size: int, phase: float, mac: bool) -> Image.Image:
    """Pulsing glow frame. phase in [0, 1). Brightness follows a cosine."""
    ss = 8
    big = size * ss
    pulse = 0.5 - 0.5 * math.cos(2 * math.pi * phase)  # 0 -> 1 -> 0
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    inset = 0.5 * ss
    draw.ellipse((inset, inset, big - inset, big - inset), fill=BLACK + (255,))

    # Outer ring that breathes in brightness
    ring_alpha = int(120 + 135 * pulse)
    ring_w = max(ss, int(big * (0.035 + 0.02 * pulse)))
    draw.ellipse((inset + ring_w / 2, inset + ring_w / 2,
                  big - inset - ring_w / 2, big - inset - ring_w / 2),
                 outline=BLOOD + (ring_alpha,), width=ring_w)

    scale, dx, dy = fit(big, pad=big * 0.20)
    mask = dagger_mask(big, scale, dx, dy)
    glow_radius = big * (0.035 + 0.035 * pulse)
    glow = scaled_alpha(mask.filter(ImageFilter.GaussianBlur(glow_radius)), 0.55 + 0.45 * pulse)
    img = Image.alpha_composite(img, colored_layer(big, BLOOD, glow))

    # Blade colour shifts between deep blood and hot red
    hot = [int(BLOOD_DEEP[i] + (BLOOD_HOT[i] - BLOOD_DEEP[i]) * pulse) for i in range(3)]
    img = Image.alpha_composite(img, colored_layer(big, tuple(hot), mask))
    return img.resize((size, size), Image.LANCZOS)


def write_svgs() -> None:
    dagger_paths = (
        '<path fill="currentColor" d="M512 232L548 360L556 430L548 520L512 792L476 520L468 430L476 360Z"/>'
        '<path fill="currentColor" d="M292 372L346 352H476H548H678L732 372L678 392H548H476H346Z"/>'
        '<path fill="#0A0A0A" d="M512 356L524 372L512 388L500 372Z"/>'
    )
    dagger = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" '
              'role="img" aria-label="AuraFlow">' + dagger_paths + '</svg>\n')
    disc = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" '
            'role="img" aria-label="AuraFlow">'
            '<circle cx="512" cy="512" r="412" fill="#0A0A0A" stroke="#8B0000" stroke-width="12"/>'
            '<circle cx="512" cy="512" r="388" fill="none" stroke="#E50914" stroke-opacity="0.45" stroke-width="3"/>'
            '<g fill="#E50914">'
            '<path d="M512 232L548 360L556 430L548 520L512 792L476 520L468 430L476 360Z"/>'
            '<path d="M292 372L346 352H476H548H678L732 372L678 392H548H476H346Z"/>'
            '</g>'
            '<path fill="#0A0A0A" d="M512 356L524 372L512 388L500 372Z"/>'
            '</svg>\n')
    brand = ROOT / "assets" / "brand"
    brand.mkdir(parents=True, exist_ok=True)
    (brand / "logo-dagger.svg").write_text(dagger, encoding="utf-8")
    (brand / "logo-disc.svg").write_text(disc, encoding="utf-8")


def main() -> None:
    build = ROOT / "build"
    icons_dir = build / "icons"
    tray = ROOT / "assets" / "tray"
    brand = ROOT / "assets" / "brand"
    for d in (build, icons_dir, tray, brand):
        d.mkdir(parents=True, exist_ok=True)

    # 1) Master app icon (render 2x then downsample for crisp edges)
    master = render_app_icon(2048).resize((1024, 1024), Image.LANCZOS)
    master.save(build / "icon.png", optimize=True)
    master.save(brand / "aura-icon-1024.png", optimize=True)

    # 2) macOS .icns (Pillow writes PNG-encoded entries for every standard size)
    master.save(build / "icon.icns")

    # 3) Windows .ico with multiple resolutions
    master.save(build / "icon.ico", sizes=[(16, 16), (24, 24), (32, 32),
                                           (48, 48), (64, 64), (128, 128), (256, 256)])

    # 4) Linux icon set
    for n in (16, 24, 32, 48, 64, 128, 256, 512, 1024):
        master.resize((n, n), Image.LANCZOS).save(icons_dir / f"{n}x{n}.png", optimize=True)

    # 5) macOS template menu-bar icon (monochrome) — spec file name + @2x
    render_template(22).save(tray / "tray_icon.png", optimize=True)
    render_template(44).save(tray / "tray_icon@2x.png", optimize=True)

    # 6) Windows/Linux idle tray icon (solid black disc, blood-red blade)
    render_disc_mark(16).save(tray / "tray_color.png", optimize=True)
    render_disc_mark(32).save(tray / "tray_color@2x.png", optimize=True)

    # 7) Recording animation frames (6 frames per pulse)
    frames = 6
    for k in range(frames):
        phase = k / frames
        render_recording_frame(22, phase, mac=True).save(tray / f"tray_recording_{k}.png", optimize=True)
        render_recording_frame(44, phase, mac=True).save(tray / f"tray_recording_{k}@2x.png", optimize=True)
        render_recording_frame(16, phase, mac=False).save(tray / f"tray_recording_win_{k}.png", optimize=True)
        render_recording_frame(32, phase, mac=False).save(tray / f"tray_recording_win_{k}@2x.png", optimize=True)

    # 8) Vector sources for the in-app logo + README
    write_svgs()
    print("AuraFlow icons written to build/, assets/tray/ and assets/brand/")


if __name__ == "__main__":
    main()
