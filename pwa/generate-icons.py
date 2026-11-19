"""Regenerate the PNG app icons in pwa/icons (requires Pillow).

    python3 pwa/generate-icons.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).parent / "icons"
SCALE = 4
TOP = (10, 29, 61)
BOTTOM = (22, 58, 107)
WHITE = (255, 255, 255)
NAVY = (10, 29, 61)
YELLOW = (245, 195, 36)


def background(size: int) -> Image.Image:
    img = Image.new("RGB", (size, size), TOP)
    draw = ImageDraw.Draw(img)
    for y in range(size):
        t = y / (size - 1)
        color = tuple(round(TOP[i] + (BOTTOM[i] - TOP[i]) * t) for i in range(3))
        draw.line([(0, y), (size, y)], fill=color)
    return img


def chat_bubble(size: int, scale: float) -> None:
    draw = ImageDraw.Draw(_canvas)
    bubble_w = size * scale
    bubble_h = bubble_w * 0.72
    left = (size - bubble_w) / 2
    top = (size - bubble_h) / 2 - size * 0.02
    radius = bubble_h * 0.28
    draw.rounded_rectangle([left, top, left + bubble_w, top + bubble_h], radius=radius, fill=WHITE)

    tail = bubble_w * 0.11
    tail_x = left + bubble_w * 0.18
    tail_y = top + bubble_h - radius * 0.2
    draw.polygon(
        [(tail_x, tail_y), (tail_x + tail * 1.6, tail_y), (tail_x + tail * 0.4, tail_y + tail * 1.25)],
        fill=WHITE,
    )

    dot_r = bubble_h * 0.085
    dot_y = top + bubble_h * 0.52
    for i, color in enumerate((NAVY, NAVY, YELLOW)):
        cx = left + bubble_w * (0.34 + i * 0.165)
        draw.ellipse([cx - dot_r, dot_y - dot_r, cx + dot_r, dot_y + dot_r], fill=color)


def build(size: int, maskable: bool) -> Image.Image:
    global _canvas
    big = size * SCALE
    _canvas = background(big)
    # Maskable icons keep their content inside the 80% safe zone.
    chat_bubble(big, 0.44 if maskable else 0.56)
    return _canvas.resize((size, size), Image.LANCZOS)


def build_apple(size: int) -> Image.Image:
    global _canvas
    big = size * SCALE
    _canvas = background(big)
    chat_bubble(big, 0.58)
    return _canvas.resize((size, size), Image.LANCZOS)


_canvas: Image.Image

if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for size in (192, 512):
        build(size, maskable=False).save(OUT / f"icon-{size}.png")
        build(size, maskable=True).save(OUT / f"maskable-{size}.png")
    build_apple(180).save(OUT / "apple-touch-icon.png")
    print("wrote", ", ".join(sorted(p.name for p in OUT.glob("*.png"))))
