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
    x0, y0, x1, y1 = (int(round(v)) for v in (x0, y0, x1, y1))
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
    """Rock island: abbey church and spire with Saint Michael on top, village houses, ramparts, the bay."""
    g = rows([
        "............2...........", "............1...........", "...........131..........", "...........131..........",
        "..........13331.........", "..........13331.........", ".......1111133311111....", ".......1232322232321....",
        ".......1222222222221....", "......112323232323211...", "......122222222222221...", ".....11222322232223211..",
        ".....12222222222222221..", "....113331133311333111..", "....122321223212232211..", "...11333113331133311111.",
        "...12232122321223212221.", "..1133333333333333333311", ".1212121212121212121212.", ".1222222222222222222221.",
        ".1221222122212221222121.", "11111111111111111111111.", "........................", "........................",
    ])
    for x in range(N):
        if x % 3 != 1:
            g[22][x] = 4
        if x % 3 != 2:
            g[23][x] = 4
    return g


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


# ---------------------------------------------------------------- second series (cards feedback)

def chaise_bleue():
    """The blue chair of the Promenade des Anglais in Nice."""
    g = blank()
    for y in range(3, 12):
        rect(g, 6, y, 17, y, 2 if y % 2 else 3)
    rect(g, 6, 3, 6, 21, 4)
    rect(g, 17, 3, 17, 21, 4)
    rect(g, 3, 12, 20, 12, 2)
    rect(g, 3, 13, 20, 14, 3)
    rect(g, 4, 15, 5, 21, 2)
    rect(g, 18, 15, 19, 21, 2)
    return outline(g)


def palmier():
    g = blank()
    for i in range(14):
        t = i / 13
        x, y = 11 + 3 * t * t, 22 - 13 * t
        ellipse(g, x, y, 1.6, .9, 3 if i % 2 else 4)
    tops = [(2, 11), (4, 5), (11, 2), (19, 3), (23, 9), (20, 13), (7, 12)]
    for tx, ty in tops:
        line(g, 14, 9, (14 + tx) / 2, min(ty, 9) - 2.5, 2, width=2)
        line(g, (14 + tx) / 2, min(ty, 9) - 2.5, tx, ty, 2, width=2)
    ellipse(g, 13.5, 10, 1.4, 1.2, 4)
    ellipse(g, 15.5, 10.5, 1.2, 1.1, 4)
    return outline(g)


def tapis_rouge():
    """Red carpet up the white steps of the Palais des Festivals, gold posts and velvet ropes in front."""
    g = blank()
    rect(g, 8, 1, 15, 4, 1)
    for y in range(5, 22):
        half = 4 + (y - 5) * .5
        rect(g, 12 - half, y, 11 + half, y, 3)
        carpet = 1.6 + (y - 5) * .22
        rect(g, 12 - carpet, y, 11 + carpet, y, 2)
    g = outline(g)
    for y in range(7, 22, 3):
        for x in range(N):
            if g[y][x] == 3:
                g[y][x] = 1
            elif g[y][x] == 2:
                g[y][x] = 4 if False else 2
    for x0, x1 in ((1, 6), (17, 22)):
        for x in (x0, x1):
            rect(g, x, 15, x, 23, 4)
            g[14][x] = 4
        mid = (x0 + x1) / 2
        line(g, x0, 15.5, mid, 18, 2)
        line(g, mid, 18, x1, 15.5, 2)
    return g


def palme_d_or():
    g = blank()
    rect(g, 6, 20, 15, 22, 4)
    points = [(10, 20), (11, 15), (13, 10), (16, 5), (18, 2)]
    for (ax, ay), (bx, by) in zip(points, points[1:]):
        line(g, ax, ay, bx, by, 2, width=1)
    for i, (x, y) in enumerate(points[:-1]):
        for k in (0, 1):
            px, py = x + (bx - x) * k * .5 if False else x, y
            line(g, x + .5, y - 1.5 * k, x - 4 + i * .6, y - 3 - 1.5 * k, 2 if k else 3)
            line(g, x + .5, y - 1.5 * k, x + 4 - i * .2, y - 1 - 1.5 * k, 3 if k else 2)
    return outline(g)


def carcassonne():
    """The Cité: walls with crenels and round towers under pointed slate roofs."""
    g = blank()
    rect(g, 1, 14, 22, 21, 2)
    for x in range(1, 23, 2):
        g[13][x] = 2
    for cx, top, width in ((3.5, 8, 2), (9, 10, 1.5), (15, 10, 1.5), (20.5, 8, 2), (12, 4, 2)):
        rect(g, int(cx - width), top + 3, int(cx + width), 21, 2)
        polygon(g, [(cx - width - 1.2, top + 3.5), (cx + .5, top - 2.5), (cx + width + 2.2, top + 3.5)], 3)
        g[top + 5][int(cx)] = 1
    g[0][12] = 4
    g[1][12], g[1][13] = 4, 4
    polygon(g, [(10, 21.5), (10, 18), (12, 16), (14, 18), (14, 21.5)], 1)
    for y in range(16, 21, 2):
        for x in (3, 7, 17, 20):
            g[y][x] = 3
    return outline(g)


def chateau_de_versailles():
    g = blank()
    rect(g, 0, 10, 23, 19, 2)
    rect(g, 1, 7, 22, 9, 3)
    rect(g, 7, 4, 16, 9, 3)
    polygon(g, [(8, 10), (12, 6.5), (16, 10)], 2)
    for x in range(1, 23):
        g[7][x] = 4
    for x in range(7, 17):
        g[4][x] = 4
    for x in range(1, 23, 2):
        for y in (11, 12, 15, 16):
            if not 10 <= x <= 13 or y > 13:
                g[y][x] = 3
    rect(g, 11, 15, 12, 19, 1)
    for x in range(0, 24, 2):
        rect(g, x, 20, x, 22, 4)
    rect(g, 0, 20, 23, 20, 4)
    g = outline(g)
    return g


def notre_dame():
    """West facade: two square towers, rose window, gallery of kings, three portals, spire behind."""
    g = blank()
    line(g, 12, 0, 12, 7, 3)
    rect(g, 3, 3, 8, 21, 2)
    rect(g, 15, 3, 20, 21, 2)
    rect(g, 9, 7, 14, 21, 2)
    for tower in (3, 15):
        for x in (tower + 1, tower + 4):
            rect(g, x, 4, x, 8, 3)
        rect(g, tower, 10, tower + 5, 10, 3)
    ellipse(g, 11.5, 11.5, 2.6, 2.6, 3)
    ellipse(g, 11.5, 11.5, 1.6, 1.6, 4)
    for x in range(3, 21, 2):
        g[14][x] = 3
    for cx in (5.5, 11.5, 17.5):
        polygon(g, [(cx - 2, 21.5), (cx - 2, 18), (cx, 16), (cx + 2, 18), (cx + 2, 21.5)], 3)
    return outline(g)


def capitole_toulouse():
    """Pink brick facade with white stone columns (place du Capitole)."""
    g = blank()
    rect(g, 0, 9, 23, 20, 2)
    rect(g, 0, 7, 23, 8, 3)
    rect(g, 1, 5, 22, 6, 4)
    polygon(g, [(7, 7.5), (12, 3), (17, 7.5)], 3)
    for x in range(2, 23, 3):
        rect(g, x, 9, x, 19, 3)
    for x in range(3, 22, 3):
        rect(g, x, 11, x + 1, 12, 1)
        rect(g, x, 15, x + 1, 16, 1)
    rect(g, 0, 20, 23, 21, 3)
    return outline(g)


def avion_de_ligne():
    g = blank()
    ellipse(g, 12, 12, 10.8, 2.4, 2)
    polygon(g, [(1.5, 12), (2, 4), (5.5, 10.5)], 3)
    polygon(g, [(10, 13), (14, 13), (8, 20.5), (5.5, 20.5)], 2)
    ellipse(g, 9.5, 16, 1.6, 1, 4)
    for x in range(6, 20, 2):
        g[11][x] = 4
    g[11][21], g[11][22] = 3, 3
    rect(g, 3, 13, 20, 13, 3)
    return outline(g)


def violettes():
    g = blank()
    for x0, x1 in ((12, 6), (12, 12), (12, 18), (12, 9), (12, 15)):
        line(g, x0, 22, x1, 10, 4)
    ellipse(g, 7, 19, 3, 1.5, 4)
    ellipse(g, 17, 19, 3, 1.5, 4)
    for cx, cy in ((6, 8), (12, 6), (18, 8), (9, 11), (15, 11)):
        for dx, dy in ((-1.5, 0), (1.5, 0), (0, -1.5), (-1, 1.2), (1, 1.2)):
            ellipse(g, cx + dx, cy + dy, 1.3, 1.3, 2)
        g[int(cy)][int(cx)] = 3
    return outline(g)


def lac_d_annecy():
    """Mountains reflected in a blue lake."""
    g = blank()
    polygon(g, [(0, 15), (6, 5), (10, 10), (15, 3), (24, 15)], 2)
    polygon(g, [(4.2, 8), (6, 5), (7.8, 8)], 3)
    polygon(g, [(12.8, 6.5), (15, 3), (17.4, 6.5)], 3)
    g = outline(g)
    rect(g, 0, 15, 23, 22, 4)
    for x in range(2, 22, 4):
        g[18][x], g[18][x + 1] = 3, 3
    for x in range(4, 20, 5):
        g[20][x] = 3
    return g


def chambord():
    """Renaissance château: corner towers, central keep and its forest of chimneys and lanterns."""
    g = blank()
    rect(g, 0, 13, 23, 21, 2)
    rect(g, 6, 9, 17, 21, 2)
    for cx in (2, 21):
        ellipse(g, cx, 11.5, 2.4, 2, 3)
        rect(g, cx - 2, 11, cx + 2, 21, 2)
    rect(g, 6, 6, 17, 9, 3)
    rect(g, 1, 11, 22, 12, 3)
    for x in (7, 9, 14, 16):
        rect(g, x, 3, x, 6, 3)
    rect(g, 11, 1, 12, 6, 2)
    g[0][11], g[0][12] = 3, 3
    for x in range(1, 23, 2):
        for y in (15, 18):
            g[y][x] = 4
    return outline(g)


def pont_d_avignon():
    """Pont Saint-Bénézet: round arches on thick piers, cut off in the middle of the Rhône, chapel on top."""
    g = rows([
        "........................", ".......111..............", "......13331.............", "......13131.............",
        "......13331.............", "2.2.2.2.2.2.2.2.2.2.2...", "222222222222222222222...", "333333333333333333333...",
        "222222222222222222222...", "222222222222222222222...", "222222222222222222222...", "2222...22222...22222....",
        "222.....222.....222.....", "222.....222.....222.....", "222.....222.....222.....", "222.....222.....222.....",
        "222.....222.....222.....", "222.....222.....222.....", "2222...22222...22222....", "........................",
        "........................", "........................", "........................", "........................",
    ])
    g = outline(g)
    for y in range(19, 24):
        for x in range(N):
            if (x + y) % 4:
                g[y][x] = 4
    return g


def huitre():
    """Open oyster: rough teardrop shell, pearly inside, grey flesh with its dark frill."""
    g = blank()
    polygon(g, [(2, 9), (8, 4), (16, 3.5), (22, 7), (22.5, 13), (18, 19), (11, 21), (4, 17)], 2)
    for x, y in ((3, 9), (21, 8), (22, 13), (5, 17), (12, 21), (18, 19), (9, 4), (16, 4)):
        if inside(x, y):
            g[y][x] = 0
    polygon(g, [(5, 9.5), (9, 6), (16, 5.5), (20, 8.5), (20, 13), (16.5, 17.5), (11, 19), (6, 16)], 3)
    ellipse(g, 12.5, 12, 6, 4, 4)
    ellipse(g, 12.5, 12, 4.6, 2.8, 1)
    ellipse(g, 12.5, 12, 3.8, 2.1, 4)
    ellipse(g, 11.5, 11.5, 1.4, .8, 3)
    return outline(g)


def etretat():
    """Chalk cliff of Étretat: the Porte d'Aval arch and the Aiguille needle, above the sea."""
    g = rows([
        "........................", "........................", "........................", "........................",
        "1111111111..............", "22222222221111..........", "222222222222221111......", "22222222222222222211....",
        "2222222222222222222221..", "3222222222222222222221..", "3222222223333332222221..", "322222221......3222221.1",
        "32222222.......322221.11", "3222222........32221..12", "3222222.........3221..12", "322222..........3221..12",
        "322222..........32221.12", "3222222.........32221.12", "32222222........32222.12", "........................",
        "........................", "........................", "........................", "........................",
    ])
    g = outline(g)
    for y in range(19, 24):
        for x in range(N):
            if y > 19 and (x + y) % 3 == 0:
                continue
            g[y][x] = 4
    return g


def remparts_saint_malo():
    """Granite ramparts of the walled city, tall houses with slate roofs and the cathedral spire."""
    g = blank()
    line(g, 15, 0, 15, 5, 3)
    for x0, x1, top in ((1, 6, 6), (7, 12, 5), (13, 18, 6), (19, 22, 7)):
        rect(g, x0, top + 2, x1, 12, 2)
        polygon(g, [(x0 - .5, top + 2.5), ((x0 + x1 + 1) / 2, top - 1.5), (x1 + 1.5, top + 2.5)], 3)
        for x in range(x0 + 1, x1, 2):
            for y in range(top + 4, 12, 3):
                g[y][x] = 3
    rect(g, 0, 13, 23, 19, 2)
    for x in range(0, 24, 2):
        g[12][x] = 2
    for y in (15, 17):
        for x in range(1 + y % 2 * 2, 23, 4):
            g[y][x] = 3
    g = outline(g)
    for y in range(20, 24):
        for x in range(N):
            if (x + y) % 4:
                g[y][x] = 4
    return g


def sardine():
    g = blank()
    ellipse(g, 11, 12, 9.5, 3.2, 3)
    for y in range(N):
        for x in range(N):
            if g[y][x] == 3 and y < 12:
                g[y][x] = 2
    polygon(g, [(19, 12), (23.5, 8), (22, 12), (23.5, 16)], 2)
    for x in range(8, 17, 3):
        g[11][x] = 4
    rect(g, 6, 10, 6, 13, 4)
    g = outline(g)
    g[11][4] = 1
    return g


def glaciere():
    g = blank()
    rect(g, 3, 11, 20, 21, 2)
    rect(g, 2, 8, 21, 10, 3)
    rect(g, 4, 14, 19, 14, 3)
    line(g, 7, 8, 7, 5, 4)
    line(g, 7, 5, 16, 5, 4)
    line(g, 16, 5, 16, 8, 4)
    rect(g, 11, 10, 12, 12, 4)
    return outline(g)


def tartine():
    """Slice of bread with chocolate spread."""
    g = blank()
    ellipse(g, 12, 8, 8.5, 4.5, 4)
    rect(g, 3.5, 8, 20, 21, 4)
    ellipse(g, 12, 8, 7.2, 3.4, 3)
    rect(g, 5, 8, 18, 20, 3)
    ellipse(g, 12, 8.6, 6, 2.6, 2)
    rect(g, 6, 9, 17, 16, 2)
    for x in range(6, 18):
        if x % 3 != 0:
            g[17][x] = 2
    return outline(g)


def bol_breton():
    g = blank()
    ellipse(g, 12, 10, 9.5, 9, 2)
    rect(g, 0, 0, 23, 9, 0)
    ellipse(g, 12, 10, 9.5, 2.4, 3)
    ellipse(g, 12, 10, 7.8, 1.5, 4)
    for ex in (1.6, 22.4):
        ellipse(g, ex, 13, 1.9, 1.6, 2)
    for x in range(5, 19, 2):
        g[15][x] = 3
    rect(g, 6, 17, 17, 17, 3)
    return outline(g)


def guitare_electrique():
    g = blank()
    line(g, 11, 12, 20, 3, 4, width=2)
    rect(g, 19, 1, 22, 3, 4)
    ellipse(g, 8, 16, 5.6, 4.6, 2)
    ellipse(g, 11.5, 12.5, 4, 3.4, 2)
    ellipse(g, 9, 15, 2.5, 2, 3)
    rect(g, 6, 17, 8, 17, 1)
    for i in range(3):
        g[1 + i][21] = 3
    return outline(g)


def batterie():
    g = blank()
    for cx, cy in ((4, 7), (20, 6)):
        line(g, cx, cy + 1, cx, 21, 1)
        ellipse(g, cx, cy, 3.8, 1.1, 4)
    ellipse(g, 5.5, 15, 3, 1.9, 2)
    ellipse(g, 5.5, 14.4, 3, 1.2, 3)
    for cx in (9, 15):
        ellipse(g, cx, 10.5, 3, 2.1, 2)
        ellipse(g, cx, 9.8, 3, 1.3, 3)
    ellipse(g, 12, 16.5, 5.8, 5.8, 2)
    ellipse(g, 12, 16.5, 4.3, 4.3, 3)
    ellipse(g, 12, 16.5, 1.6, 1.6, 2)
    return outline(g)


def micro():
    g = blank()
    rect(g, 12, 11, 12, 20, 4)
    ellipse(g, 12, 21.5, 5, 1.6, 4)
    ellipse(g, 12, 6, 3.8, 4.8, 2)
    for y in range(3, 10, 2):
        for x in range(10, 15):
            if g[y][x] == 2:
                g[y][x] = 3
    rect(g, 9, 10, 15, 10, 1)
    return outline(g)


def cigogne():
    """White stork: black flight feathers, long red beak and legs."""
    g = blank()
    line(g, 10, 13, 10, 22, 4)
    line(g, 12, 13, 14, 17, 4)
    line(g, 14, 17, 11, 18, 4)
    ellipse(g, 11.5, 10, 6.5, 3.4, 2)
    ellipse(g, 14.5, 10.5, 4.6, 2.4, 3)
    polygon(g, [(17, 9), (22.5, 12), (17, 12)], 3)
    line(g, 6.5, 9, 5.5, 4, 2, width=2)
    ellipse(g, 5, 3.4, 1.9, 1.6, 2)
    line(g, 3.5, 4, .5, 8, 4)
    line(g, 3.5, 3.5, 1, 6.5, 4)
    g = outline(g)
    g[3][5] = 1
    return g


def maison_alsacienne():
    """Half-timbered house with a steep tiled roof and flower boxes."""
    g = blank()
    rect(g, 5, 10, 18, 21, 3)
    polygon(g, [(2.5, 10.5), (11.5, .5), (20.5, 10.5)], 2)
    for x in (5, 9, 14, 18):
        rect(g, x, 10, x, 21, 4)
    for y in (10, 15):
        rect(g, 5, y, 18, y, 4)
    line(g, 9, 15, 14, 10, 4)
    line(g, 9, 10, 14, 15, 4)
    for x0 in (6, 15):
        rect(g, x0, 17, x0 + 2, 19, 1)
        rect(g, x0, 20, x0 + 2, 20, 2)
    rect(g, 11, 17, 12, 21, 1)
    rect(g, 10, 5, 13, 7, 3)
    return outline(g)


def corbeau():
    """Master Crow on his branch, holding the cheese in his beak (La Fontaine)."""
    g = blank()
    line(g, 0, 20, 23, 17, 3, width=2)
    line(g, 17, 18, 21, 14, 3)
    line(g, 10, 15, 10, 19, 1)
    line(g, 13, 15, 13, 18, 1)
    polygon(g, [(14, 12), (22, 17), (20.5, 11.5)], 2)
    ellipse(g, 11.5, 11.5, 5.5, 4, 2)
    ellipse(g, 7, 7.5, 3.1, 2.7, 2)
    polygon(g, [(4.4, 7), (.8, 8.6), (4.4, 9.2)], 1)
    polygon(g, [(0, 9), (3.6, 9.4), (1.5, 12.5)], 4)
    g = outline(g)
    g[6][7] = 4
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
    ("chaise bleue", "blue chair of Nice", chaise_bleue, ["#000000", "#10243f", "#2f6fb5", "#5aa0e6", "#1d4a80"]),
    ("palmier", "palm tree", palmier, ["#000000", "#1e2a14", "#3f8f3a", "#8b5e3c", "#a7713f"]),
    ("tapis rouge", "red carpet", tapis_rouge, ["#000000", "#3a0d12", "#d62828", "#e0b13a", "#9d1c22"]),
    ("Palme d'or", "Palme d'Or", palme_d_or, ["#000000", "#5a3d0a", "#e0b13a", "#fff0a8", "#4a6fa5"]),
    ("Cité de Carcassonne", "Carcassonne medieval city", carcassonne, ["#000000", "#2b2b33", "#d8c9a8", "#4a5a78", "#c0392b"]),
    ("château de Versailles", "Palace of Versailles", chateau_de_versailles, ["#000000", "#3a3326", "#efe3c8", "#4b5a75", "#e0b13a"]),
    ("Notre-Dame de Paris", "Notre-Dame de Paris", notre_dame, ["#000000", "#3b3a36", "#d9cfba", "#9c9280", "#3d5aa8"]),
    ("Capitole de Toulouse", "Capitole de Toulouse", capitole_toulouse, ["#000000", "#4a2a24", "#e07a6a", "#f6eadf", "#4a5a78"]),
    ("avion de ligne", "airliner", avion_de_ligne, ["#000000", "#1e2a3a", "#f4f6fa", "#3045d1", "#9aa3ad"]),
    ("violettes", "violets", violettes, ["#000000", "#2a1830", "#7b4bbd", "#e8d9ff", "#5b8e3b"]),
    ("lac d'Annecy", "lake Annecy", lac_d_annecy, ["#000000", "#1f2d3d", "#5d7a8c", "#f4f6f8", "#3a86c8"]),
    ("château de Chambord", "Chambord castle", chambord, ["#000000", "#2f3440", "#efe8d8", "#4e5b70", "#8aa6c8"]),
    ("pont d'Avignon", "Avignon bridge", pont_d_avignon, ["#000000", "#3a3226", "#d8c39a", "#a88f62", "#3a86c8"]),
    ("huître", "oyster", huitre, ["#000000", "#3a3530", "#8d8577", "#eceae4", "#c9c2a8"]),
    ("falaises d'Étretat", "Etretat cliffs", etretat, ["#000000", "#3d4450", "#ede9df", "#b9b5aa", "#3a86c8"]),
    ("remparts de Saint-Malo", "Saint-Malo ramparts", remparts_saint_malo, ["#000000", "#2b2f38", "#c9c3b6", "#4e586a", "#3a86c8"]),
    ("sardine", "sardine", sardine, ["#000000", "#1d2b3a", "#3d6e9c", "#dfe6ee", "#2a4a6a"]),
    ("glacière", "cool box", glaciere, ["#000000", "#1d2b3a", "#2f80c4", "#f4f6fa", "#e63946"]),
    ("tartine chocolatée", "bread with chocolate spread", tartine, ["#000000", "#3b2414", "#6b3a1e", "#f3d7a3", "#c48a45"]),
    ("bol breton", "breton bowl", bol_breton, ["#000000", "#1d2b3a", "#f6f3ea", "#2f5fb3", "#7b3f1d"]),
    ("guitare électrique", "electric guitar", guitare_electrique, ["#000000", "#1a1a20", "#d62828", "#f4efe6", "#a0632e"]),
    ("batterie", "drum kit", batterie, ["#000000", "#1a1a20", "#d62828", "#f4f4f4", "#e0b13a"]),
    ("micro", "microphone", micro, ["#000000", "#1a1a20", "#9aa3ad", "#e8edf2", "#2b2b33"]),
    ("cigogne", "white stork", cigogne, ["#000000", "#1a1a1a", "#f6f6f4", "#26262b", "#e2572b"]),
    ("maison alsacienne", "Alsatian half-timbered house", maison_alsacienne, ["#000000", "#2b1d14", "#b8432f", "#f3e6c8", "#6b3e22"]),
    ("corbeau", "crow", corbeau, ["#000000", "#000000", "#2d2d38", "#7a4a2a", "#f2c94c"]),
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
        sheet = Image.new("RGB", (6 * cell, ((len(entries) + 5) // 6) * (cell + 16)), (230, 230, 235))
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
