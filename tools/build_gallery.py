"""Build static/gallery.json from the PixelGPT 24x24 20K dataset.

Download data/{train,validation,test}-00000-of-00001.parquet from
https://huggingface.co/datasets/unstonio/pixelgpt-24x24-20k into the current directory first
(saved here as train.parquet, val.parquet, test.parquet).
"""
import io, json
from pathlib import Path
import pyarrow.parquet as pq
from PIL import Image
LABELS = {"01_animals":"Animaux","02_fantasy_creatures":"Créatures fantastiques","03_people_and_characters":"Personnages",
"04_plants_and_fungi":"Plantes et champignons","05_food_and_drink":"Nourriture et boissons","06_containers_and_storage":"Contenants",
"07_clothing_and_accessories":"Vêtements et accessoires","08_treasure_magic_and_relics":"Trésors et magie","09_tools_and_crafting":"Outils",
"10_weapons_and_defenses":"Armes et armures","11_machines_and_technology":"Machines et technologie","12_science_and_medicine":"Sciences et médecine",
"13_vehicles_and_transport":"Véhicules","14_places_and_structures":"Lieux et bâtiments","15_household_furniture_and_everyday":"Maison et objets du quotidien",
"16_nature_and_landscapes":"Nature et paysages","17_materials_and_components":"Matériaux","18_effects_and_celestial":"Effets et ciel",
"19_symbols_and_documents":"Symboles et documents"}
PER_FAMILY = 80
rows = []
for f in ["train.parquet","val.parquet","test.parquet"]:
    rows += pq.read_table(f, columns=["image","caption","family","quality_score","palette"]).to_pylist()
families = sorted(LABELS)
out = []
for fam in families:
    seen = set(); picked = 0
    for r in sorted((r for r in rows if r["family"] == fam), key=lambda r: -r["quality_score"]):
        cap = r["caption"].strip()
        if cap.lower() in seen: continue
        pal = [tuple(c) for c in json.loads(r["palette"])]
        img = Image.open(io.BytesIO(r["image"]["bytes"])).convert("RGB")
        try:
            tokens = "".join(str(pal.index(p)) for p in img.get_flattened_data())
        except ValueError:
            continue
        if tokens.count("0") > 560: continue
        seen.add(cap.lower()); picked += 1
        out.append([families.index(fam), cap, "".join("%02x%02x%02x" % c for c in pal), tokens])
        if picked == PER_FAMILY: break
data = {"source": "PixelGPT 24×24 — 20K, unstonio, CC BY 4.0", "url": "https://huggingface.co/datasets/unstonio/pixelgpt-24x24-20k",
        "families": [LABELS[f] for f in families], "sprites": out}
path = Path(__file__).resolve().parent.parent / "static" / "data" / "library.json"
json.dump(data, open(path, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print(len(out), "sprites")
