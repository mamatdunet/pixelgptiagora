"""Hand-drawn 24x24 vignettes for French landmarks and food the model cannot draw well.

Same format as the model's output (palette index per pixel, index 0 transparent, at most 5 colours), so they
behave like any other vignette in the editor. Monuments are drawn pixel by pixel; round things are built from
simple shapes and get a dark outline automatically. Writes static/data/handmade.json.
Usage: python tools/handmade_vignettes.py [preview.png]
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "static" / "data" / "handmade.json"
N = 24


def blank():
    return [[0] * N for _ in range(N)]


def inside(x, y):
    return 0 <= x < N and 0 <= y < N


def ellipse(g, cx, cy, rx, ry, c):
    for y in range(N):
        for x in range(N):
            if ((x + .5 - cx) / rx) ** 2 + ((y + .5 - cy) / ry) ** 2 <= 1:
                g[y][x] = c


def rect(g, x0, y0, x1, y1, c):
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            if inside(x, y):
                g[y][x] = c


def line(g, x0, y0, x1, y1, c, width=1):
    steps = int(max(abs(x1 - x0), abs(y1 - y0)) * 3) + 1
    for i in range(steps + 1):
        t = i / steps
        x, y = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
        for dx in range(width):
            for dy in range(width):
                px, py = int(round(x - (width - 1) / 2 + dx)), int(round(y - (width - 1) / 2 + dy))
                if inside(px, py):
                    g[py][px] = c


def polygon(g, points, c, where=lambda x, y: True):
    for y in range(N):
        for x in range(N):
            px, py, hit = x + .5, y + .5, False
            for (ax, ay), (bx, by) in zip(points, points[1:] + points[:1]):
                if (ay > py) != (by > py) and px < (bx - ax) * (py - ay) / (by - ay) + ax:
                    hit = not hit
            if hit and where(x, y):
                g[y][x] = c


def outline(g, c=1):
    """Dark outline around the shape (pixels touching the transparent background)."""
    out = [row[:] for row in g]
    for y in range(N):
        for x in range(N):
            if g[y][x] and g[y][x] != c:
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = x + dx, y + dy
                    if not inside(nx, ny) or g[ny][nx] == 0:
                        out[y][x] = c
                        break
    return out


def rows(text_rows, mirror=False):
    """Grid from strings ('.' transparent, digits palette indices); left halves are mirrored if asked."""
    data = [r + r[::-1] if mirror else r for r in text_rows]
    assert len(data) == N and all(len(r) == N for r in data), [len(r) for r in data]
    return [[0 if ch == "." else int(ch) for ch in r] for r in data]


# ---------------------------------------------------------------- monuments (pixel by pixel)

def tour_eiffel():
    return rows([
        "...........11...........", "...........44...........", "...........11...........",
        "..........1221..........", "..........1441..........", "..........1231..........",
        "..........1321..........", ".........112311.........", ".........123231.........",
        ".........132321.........", "........11232311........", "........12323231........",
        ".......1444444441.......", ".......1123232311.......", "......112323232311......",
        "......123232323231......", ".....11232323232311.....", "....1444444444444441....",
        "....1123231111323211....", "...112321......123211...", "...12321........12321...",
        "..1232311......1132321..", "..123211........112321..", ".11111............11111.",
    ])


def arc_de_triomphe():
    return rows([
        "............", "...........4", "...........1", "...111111111", "...133333333", "...122222222",
        "..1111111111", "...123232323", "...122222222", "...122222111", "...1222221..", "...122221...",
        "...124221...", "...124221...", "...122221...", "...123221...", "...122221...", "...122221...",
        "...122221...", "...122221...", "...122221...", "..11111111..", "............", "............",
    ], mirror=True)


def sacre_coeur():
    return rows([
        "............", "...........1", "..........11", ".........133", "........1333", ".......13322",
        ".......13222", "...1...12222", "..131..12222", ".13321.12222", ".13221111111", ".12221122222",
        ".11111123232", ".12221123232", ".12221122222", "111111111111", "122222222222", "122422224222",
        "122422224222", "122222222214", "122222222214", "111111111111", "..1333333333", ".13333333333",
    ], mirror=True)


def mont_saint_michel():
    return rows([
        "...........2", "...........1", "..........11", "..........12", ".........112", ".........122",
        "........1122", "........1223", ".......11222", ".......12322", "......112222", ".....1123232",
        ".....1222222", "....11322322", "...112222222", "...123232323", "..1122222222", "..1333333333",
        ".13333333333", "133333333333", "4.44.44.44.4", ".44.44.44.44", "............", "............",
    ], mirror=True)


# ---------------------------------------------------------------- shapes + automatic outline

def pyramide_du_louvre():
    g = blank()
    rect(g, 0, 21, 23, 22, 4)
    polygon(g, [(12, 4), (23.5, 21), (.5, 21)], 2)
    for y in range(N):
        for x in range(N):
            if g[y][x] == 2 and ((x + y) % 4 == 0 or (x - y) % 4 == 0):
                g[y][x] = 3
    return outline(g)


def moulin_rouge():
    g = blank()
    for angle in (45, 135):
        a = math.radians(angle)
        dx, dy = math.cos(a) * 10, math.sin(a) * 10
        line(g, 12 - dx, 8 - dy, 12 + dx, 8 + dy, 3, width=2)
    rect(g, 8, 11, 15, 21, 2)
    polygon(g, [(7, 11.5), (12, 6), (17, 11.5)], 4)
    rect(g, 11, 17, 12, 21, 4)
    rect(g, 10, 13, 13, 14, 3)
    ellipse(g, 12, 8, 1.6, 1.6, 4)
    return outline(g)


def croissant():
    g = blank()
    cx, cy, outer = 12, 18, 10.5
    for y in range(N):
        for x in range(N):
            dx, dy = x + .5 - cx, cy - (y + .5)
            r, theta = math.hypot(dx, dy), math.atan2(dy, dx)
            if theta < -.6:
                theta += 2 * math.pi
            if not -.6 <= theta <= math.pi + .6:
                continue
            # Thick in the middle, tapering to curled tips.
            thickness = 1.6 + 5.4 * max(0, math.sin(min(max(theta, 0), math.pi))) ** .8
            if outer - thickness <= r <= outer:
                band = int((theta + .6) / .62)
                g[y][x] = 2 if band % 2 == 0 else 3
                if (theta + .6) % .62 < .12:
                    g[y][x] = 4
    return outline(g)


def baguette():
    g = blank()
    ax, ay, bx, by, radius = 3, 20, 20.5, 3.5, 2.7
    length = math.hypot(bx - ax, by - ay)
    ux, uy = (bx - ax) / length, (by - ay) / length
    for y in range(N):
        for x in range(N):
            px, py = x + .5 - ax, y + .5 - ay
            t = max(0, min(length, px * ux + py * uy))
            side = px * -uy + py * ux
            if math.hypot(px - ux * t, py - uy * t) <= radius:
                g[y][x] = 4 if side > radius * .45 else 2
    for t in (.22, .42, .62, .82):
        mx, my = ax + ux * length * t, ay + uy * length * t
        line(g, mx - 1.2, my - .4, mx + .6, my - 2, 3)
    return outline(g)


def macarons():
    g = blank()
    for cx, cy, shell in ((7, 8, 2), (17, 9, 4), (12, 17, 2)):
        ellipse(g, cx, cy + 1.6, 5.2, 2.4, 1)
        ellipse(g, cx, cy + 1.6, 4.4, 1.7, shell)
        rect(g, cx - 4, cy, cx + 3, cy, 3)
        ellipse(g, cx, cy - 1.4, 5.2, 2.6, 1)
        ellipse(g, cx, cy - 1.4, 4.4, 1.9, shell)
    return outline(g)


def grappe_de_raisin():
    g = blank()
    line(g, 12, 2, 12, 6, 4, width=2)
    ellipse(g, 16, 4, 3.4, 2, 4)
    for cy, xs in ((8, (8, 12, 16)), (11, (6, 10, 14, 18)), (14, (8, 12, 16)), (17, (10, 14)), (20, (12,))):
        for cx in xs:
            ellipse(g, cx, cy, 2.5, 2.5, 1)
            ellipse(g, cx, cy, 1.8, 1.8, 2)
            g[int(cy - 1)][int(cx - 1)] = 3
    return outline(g)


def camembert():
    g = blank()
    ellipse(g, 12, 16, 10.5, 4.5, 4)
    rect(g, 2, 11, 21, 16, 4)
    ellipse(g, 12, 11, 10.5, 4.5, 3)
    polygon(g, [(12, 11), (22.5, 9), (22.5, 15)], 2, where=lambda x, y: g[y][x] in (3, 4))
    return outline(g)


def crepe():
    g = blank()
    ellipse(g, 12, 17, 11.5, 5, 3)
    ellipse(g, 12, 17, 9.5, 3.6, 4)
    ellipse(g, 12, 17, 9, 3.2, 3)
    polygon(g, [(4, 18), (20, 18), (15, 8)], 2)
    for x, y in ((9, 16), (13, 14), (15, 16), (12, 17), (16, 12), (11, 15)):
        g[y][x] = 4
    return outline(g)


def beret():
    g = blank()
    rect(g, 11, 5, 12, 7, 2)
    ellipse(g, 12, 13, 10.5, 5.2, 2)
    ellipse(g, 11, 11.5, 7.5, 2.4, 3)
    rect(g, 3, 16, 20, 17, 4)
    return outline(g)


def mariniere():
    g = blank()
    polygon(g, [(5, 5), (9, 3.5), (12, 6), (15, 3.5), (19, 5), (23, 10), (19.5, 12.5), (18, 11), (18, 21.5),
                (6, 21.5), (6, 11), (4.5, 12.5), (1, 10)], 3)
    for y in range(N):
        for x in range(N):
            if g[y][x] == 3 and y % 3 == 0 and y > 4:
                g[y][x] = 2
    rect(g, 11, 4, 12, 5, 0)
    return outline(g)


def accordeon():
    g = blank()
    for x in range(6, 18):
        rect(g, x, 7, x, 20, 2 if x % 2 == 0 else 3)
    rect(g, 1, 8, 5, 19, 4)
    rect(g, 18, 8, 22, 19, 4)
    for y in range(9, 19, 2):
        g[y][2], g[y][4] = 3, 3
    for y in range(10, 18, 3):
        g[y][20] = 3
    return outline(g)


def drapeau_francais():
    g = blank()
    for x in range(4, 22):
        wave = round(math.sin((x - 4) / 3.2) * 1.2)
        for y in range(4, 16):
            g[y + wave][x] = 2 if x < 10 else 3 if x < 16 else 4
    g = outline(g)
    line(g, 3, 3, 3, 22, 1, width=1)
    g[2][3] = 4
    return g


def boules_de_petanque():
    g = blank()
    for cx, cy in ((8, 13), (15.5, 15)):
        ellipse(g, cx, cy, 5.6, 5.6, 1)
        ellipse(g, cx, cy, 4.8, 4.8, 2)
        for angle in range(200, 341, 12):  # engraved groove, a curve across the ball
            a = math.radians(angle)
            x, y = int(cx + math.cos(a) * 3.2), int(cy + 2.6 + math.sin(a) * 3.2)
            if g[y][x] == 2:
                g[y][x] = 1
        ellipse(g, cx - 1.8, cy - 2, 1.4, 1.1, 3)
    ellipse(g, 20.5, 20.5, 1.9, 1.9, 4)
    return outline(g)


def velo():
    g = blank()
    for cx in (6, 17):
        ellipse(g, cx, 16, 5, 5, 2)
        ellipse(g, cx, 16, 3.6, 3.6, 0)
        line(g, cx - 3, 16, cx + 3, 16, 3)
        line(g, cx, 13, cx, 19, 3)
    for a, b in (((6, 16), (11, 16)), ((11, 16), (15, 10)), ((15, 10), (9, 10)), ((9, 10), (6, 16)), ((9, 10), (11, 16)),
                 ((15, 10), (17, 16)), ((9, 10), (8, 7)), ((15, 10), (16, 6))):
        line(g, *a, *b, 4, width=1)
    rect(g, 7, 6, 10, 6, 1)
    rect(g, 15, 6, 18, 6, 1)
    return g


VIGNETTES = [
    ("tour Eiffel", "Eiffel tower", tour_eiffel, ["#1b2440", "#2b2320", "#7a5a3c", "#b98c55", "#ffd76a"]),
    ("Arc de Triomphe", "Arc de Triomphe", arc_de_triomphe, ["#000000", "#4a4036", "#e8dcc4", "#c9b892", "#2f4a9a"]),
    ("Sacré-Cœur", "Sacre-Coeur basilica", sacre_coeur, ["#000000", "#6b6b78", "#f7f3ea", "#d9d1bf", "#3d4a8f"]),
    ("Mont-Saint-Michel", "Mont-Saint-Michel", mont_saint_michel, ["#000000", "#2e3440", "#e6dcc8", "#7b8494", "#4f86c6"]),
    ("pyramide du Louvre", "Louvre glass pyramid", pyramide_du_louvre, ["#000000", "#26334d", "#8fb8de", "#dbeefc", "#c9b892"]),
    ("Moulin Rouge", "Moulin Rouge windmill", moulin_rouge, ["#000000", "#2b1a1a", "#d62828", "#f1e3c8", "#6b2a2a"]),
    ("croissant", "croissant", croissant, ["#000000", "#5a3210", "#d9a441", "#f2c66d", "#8c4a1e"]),
    ("baguette", "baguette", baguette, ["#000000", "#5a3210", "#d9a441", "#fff1c9", "#a8641f"]),
    ("macarons", "macarons", macarons, ["#000000", "#5b3a4a", "#f4a6c4", "#fff4e6", "#9ccc65"]),
    ("grappe de raisin", "bunch of grapes", grappe_de_raisin, ["#000000", "#2a1530", "#7b3f8c", "#c9a0dc", "#5b8e3b"]),
    ("camembert", "camembert cheese", camembert, ["#000000", "#5b4630", "#f2d06b", "#faf6ec", "#c58b4a"]),
    ("crêpe", "crepe", crepe, ["#000000", "#5a3210", "#e3a94f", "#f4f4f8", "#7b3f1d"]),
    ("béret", "beret", beret, ["#000000", "#05070f", "#1d2238", "#3a4466", "#2b2f45"]),
    ("marinière", "breton striped shirt", mariniere, ["#000000", "#14213d", "#1d3fbb", "#ffffff", "#e63946"]),
    ("accordéon", "accordion", accordeon, ["#000000", "#1a1a20", "#2b2b33", "#f5f5f5", "#d62828"]),
    ("drapeau français", "French flag", drapeau_francais, ["#000000", "#2b2320", "#1d3fbb", "#ffffff", "#e63946"]),
    ("boules de pétanque", "petanque balls", boules_de_petanque, ["#000000", "#30363d", "#9aa3ad", "#e8edf2", "#d1495b"]),
    ("vélo", "bicycle", velo, ["#000000", "#1a1a20", "#2b2b33", "#9aa3ad", "#e63946"]),
]


def main():
    entries = []
    for name, english, draw, palette in VIGNETTES:
        grid = draw()
        tokens = "".join(str(v) for row in grid for v in row)
        assert len(tokens) == 576 and set(tokens) <= set("01234")
        entries.append([name, english, "".join(h[1:] for h in palette), tokens])
    OUT.write_text(json.dumps({"family": "Patrimoine dessiné à la main", "sprites": entries}, ensure_ascii=False,
                              separators=(",", ":")), encoding="utf-8")
    print(f"{len(entries)} vignettes -> {OUT}")
    if len(sys.argv) > 1:
        from PIL import Image, ImageDraw
        scale, cell = 8, 24 * 8 + 10
        sheet = Image.new("RGB", (6 * cell, 3 * (cell + 16)), (230, 230, 235))
        draw = ImageDraw.Draw(sheet)
        for i, (name, _, palette_hex, tokens) in enumerate(entries):
            colours = [tuple(int(palette_hex[k * 6 + j:k * 6 + j + 2], 16) for j in (0, 2, 4)) for k in range(5)]
            image = Image.new("RGB", (24, 24), (200, 214, 230))
            for k, t in enumerate(tokens):
                if t != "0":
                    image.putpixel((k % 24, k // 24), colours[int(t)])
            x, y = (i % 6) * cell, (i // 6) * (cell + 16)
            sheet.paste(image.resize((24 * scale, 24 * scale), Image.NEAREST), (x + 5, y + 5))
            draw.text((x + 5, y + cell - 2), name, fill=(20, 20, 30))
        sheet.save(sys.argv[1])


if __name__ == "__main__":
    main()
