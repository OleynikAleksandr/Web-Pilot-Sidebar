#!/usr/bin/env python3
"""Draws the app icons of the Safari container app (apple/) from the same
geometry as extension/icons. Needs Pillow; run from the project root:
    python3 scripts/apple-icons.py
macOS icons follow Apple's grid (rounded body 824/1024 with transparent margin);
the iOS icon is full-bleed and opaque, the system applies its own mask."""
from pathlib import Path
from PIL import Image, ImageDraw

TEAL, BAR, CARD, LINE = (8, 126, 128), (236, 245, 245), (94, 171, 172), (255, 255, 255)
# Glyph in units of a 120-unit body: (x0, y0, x1, y1, radius, color).
GLYPH = [(18, 26, 40, 94, 6, BAR), (48, 26, 102, 94, 6, CARD),
         (55, 40, 93, 46, 3, LINE), (55, 54, 83, 60, 3, LINE), (55, 68, 89, 74, 3, LINE)]
SS = 4  # supersampling for smooth edges

def draw(size, body, radius, opaque):
    big = size * SS
    image = Image.new('RGBA', (big, big), TEAL + (255,) if opaque else (0, 0, 0, 0))
    d = ImageDraw.Draw(image)
    x, y, w = (v * SS for v in body)
    if not opaque:
        d.rounded_rectangle((x, y, x + w - 1, y + w - 1), radius * SS, fill=TEAL)
    unit = w / 120
    for x0, y0, x1, y1, r, color in GLYPH:
        d.rounded_rectangle((x + x0 * unit, y + y0 * unit, x + x1 * unit, y + y1 * unit), r * unit, fill=color)
    image = image.resize((size, size), Image.LANCZOS)
    return image.convert('RGB') if opaque else image

def mac(size):
    return draw(size, (size * 100 / 1024, size * 100 / 1024, size * 824 / 1024), size * 185 / 1024, False)

root = Path(__file__).resolve().parent.parent / 'apple' / 'Shared (App)'
icons = root / 'Assets.xcassets' / 'AppIcon.appiconset'
for points in (16, 32, 128, 256, 512):
    for scale in (1, 2):
        mac(points * scale).save(icons / f'mac-icon-{points}@{scale}x.png')
draw(1024, (0, 0, 1024), 0, True).save(icons / 'universal-icon-1024@1x.png')
draw(256, (0, 0, 256), 56, False).save(root / 'Resources' / 'Icon.png')
print('Значки обновлены:', icons)
