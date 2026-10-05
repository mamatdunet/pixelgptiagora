"""Pre-generate the example compositions shipped in static/compositions.json (positions are card fractions)."""
import json, urllib.request
from pathlib import Path
from PIL import Image

COMPOSITIONS = [
    {"id": "mer", "title": "Bord de mer la nuit", "orientation": "landscape", "background": "#1b2440",
     "palette": ["#101820", "#f4f1de", "#f2c14e", "#4f7cac", "#c0504d"],
     "sprites": [("pleine lune", 3, .84, .22, .34), ("étoile", 2, .5, .13, .12), ("étoile", 2, .42, .38, .08),
                 ("étoile", 2, .65, .3, .08), ("mouette", 3, .62, .52, .18), ("phare", 2, .17, .56, .62),
                 ("maison en bois", 3, .44, .74, .4), ("bateau à voile", 3, .76, .72, .42)]},
    {"id": "foret", "title": "Forêt enchantée", "orientation": "portrait", "background": "#1e2d24",
     "palette": ["#142019", "#f4ecd6", "#d1495b", "#6a994e", "#8b5e3c"],
     "sprites": [("chouette", 1, .5, .2, .3), ("fleur", 3, .16, .4, .13), ("fleur", 3, .86, .36, .11),
                 ("renard", 3, .64, .52, .3), ("champignon rouge", 1, .26, .6, .26), ("champignon rouge", 1, .86, .74, .13),
                 ("hérisson", 2, .3, .85, .2), ("escargot", 2, .68, .87, .16)]},
    {"id": "quete", "title": "La quête du chevalier", "orientation": "landscape", "background": "#2b1d2e",
     "palette": ["#1a1220", "#e8e4dc", "#e9b949", "#b83b3b", "#7a6c9e"],
     "sprites": [("château", 2, .17, .5, .56), ("couronne en or", 3, .48, .18, .22), ("dragon", 4, .8, .34, .52),
                 ("chevalier en armure", 4, .5, .58, .4), ("potion magique", 2, .34, .86, .18),
                 ("épée", 4, .66, .86, .18), ("coffre au trésor", 2, .84, .82, .26)]},
]
cache = {}
def generate(prompt, seed, palette):
    key = (prompt, seed, tuple(palette))
    if key not in cache:
        rgb = [[int(h[i:i + 2], 16) for i in (1, 3, 5)] for h in palette]
        body = json.dumps({"prompt": prompt, "seed": seed, "palette": rgb, "temperature": 0.9}).encode()
        req = urllib.request.Request("http://127.0.0.1:8000/api/generate", body, {"Content-Type": "application/json"})
        cache[key] = "".join(map(str, json.load(urllib.request.urlopen(req))["tokens"]))
    return cache[key]

out = []
for comp in COMPOSITIONS:
    sprites = [{"name": p, "seed": s, "cx": cx, "cy": cy, "size": size, "tokens": generate(p, s, comp["palette"])}
               for p, s, cx, cy, size in comp["sprites"]]
    out.append({**comp, "sprites": sprites})
    W, H = (900, 600) if comp["orientation"] == "landscape" else (600, 900)
    card = Image.new("RGB", (W, H), comp["background"])
    for sp in sprites:
        side = max(2, round(sp["size"] * H / 24)) * 24
        img = Image.new("RGBA", (24, 24)); px = img.load()
        for k, t in enumerate(sp["tokens"]):
            if t != "0": px[k % 24, k // 24] = Image.new("RGB", (1, 1), comp["palette"][int(t)]).getpixel((0, 0)) + (255,)
        img = img.resize((side, side), Image.NEAREST)
        card.paste(img, (round(sp["cx"] * W - side / 2), round(sp["cy"] * H - side / 2)), img)
    card.save(f"preview_{comp['id']}.png")
path = Path(__file__).resolve().parent.parent / "static" / "data" / "compositions.json"
json.dump(out, open(path, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print("ok")
