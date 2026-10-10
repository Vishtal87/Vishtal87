# Генерирует иконки приложения в стиле neo-brutalism: жёлтый фон, чёрная рамка, розовое сердце с линией пульса.
# Запуск: python3 scripts/make-icons.py (из папки bp-tracker). Нужен Pillow.
import math
import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, '..', 'assets')
YELLOW = (255, 230, 0, 255)
PINK = (255, 61, 139, 255)
INK = (0, 0, 0, 255)
SS = 4  # супер-сэмплинг для ровных краёв


def heart_points(cx, cy, scale, n=240):
    pts = []
    for i in range(n):
        t = 2 * math.pi * i / n
        x = 16 * math.sin(t) ** 3
        y = 13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)
        pts.append((cx + x * scale, cy - y * scale))
    return pts


def pulse_points(cx, cy, half_w, half_h):
    # Линия ЭКГ: ровная, один острый пик, ровная. Координаты в долях полуширины и полувысоты.
    steps = [(-1.0, 0), (-0.45, 0), (-0.3, -0.15), (-0.18, 0.2), (-0.06, -1.0), (0.08, 0.55), (0.2, 0), (0.45, 0), (1.0, 0)]
    return [(cx + sx * half_w, cy + sy * half_h) for sx, sy in steps]


# scale — пикселей на одну единицу сердца (его ширина ≈ 32 единицы).
def draw_glyph(d, cx, cy, scale, ink, fill, border, pulse_color, shadow=None):
    if shadow:
        off = int(scale * 0.9)
        d.polygon([(x + off, y + off) for x, y in heart_points(cx, cy, scale)], fill=shadow)
    d.polygon(heart_points(cx, cy, scale), fill=fill)
    d.line(heart_points(cx, cy, scale) + [heart_points(cx, cy, scale)[0]], fill=ink, width=int(scale * 0.9), joint='curve')
    d.line(pulse_points(cx, cy + scale * 1.5, scale * 13, scale * 4.5), fill=pulse_color, width=int(scale * 1.6), joint='curve')


def icon_full(size):
    big = size * SS
    img = Image.new('RGBA', (big, big), YELLOW)
    d = ImageDraw.Draw(img)
    border = int(big * 0.035)
    d.rectangle([border / 2, border / 2, big - border / 2, big - border / 2], outline=INK, width=border)
    draw_glyph(d, big / 2, big * 0.47, big * 0.0175, INK, PINK, INK, INK, shadow=INK)
    return img.resize((size, size), Image.LANCZOS).convert('RGB')


def foreground(size):
    big = size * SS
    img = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    draw_glyph(d, big / 2, big * 0.5, big * 0.0150, INK, PINK, INK, INK, shadow=INK)
    return img.resize((size, size), Image.LANCZOS)


def monochrome(size):
    big = size * SS
    img = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    draw_glyph(d, big / 2, big * 0.5, big * 0.0150, (0, 0, 0, 255), (0, 0, 0, 255), (0, 0, 0, 255), (255, 255, 255, 255))
    return img.resize((size, size), Image.LANCZOS)


def background(size):
    return Image.new('RGBA', (size, size), YELLOW)


def main():
    icon_full(1024).save(os.path.join(ASSETS, 'icon.png'), optimize=True)
    icon_full(1024).save(os.path.join(ASSETS, 'splash-icon.png'), optimize=True)
    foreground(512).save(os.path.join(ASSETS, 'android-icon-foreground.png'), optimize=True)
    background(512).save(os.path.join(ASSETS, 'android-icon-background.png'), optimize=True)
    monochrome(432).save(os.path.join(ASSETS, 'android-icon-monochrome.png'), optimize=True)
    icon_full(48).save(os.path.join(ASSETS, 'favicon.png'), optimize=True)


if __name__ == '__main__':
    main()
