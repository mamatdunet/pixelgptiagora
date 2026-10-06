"""Build static/data/compositions.json: example postcards for the library ("Compositions" tab).

Sprites are generated with PixelGPT through the local Python server of the original project
(http://127.0.0.1:8000, see README), with one shared palette per card so each scene looks coherent.
Positions are fractions of the card (cx, cy) and sizes fractions of its height, so cards adapt to any
screen. Usage: python tools/build_compositions.py [--preview previews/]
"""
from __future__ import annotations

import json
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "static" / "data" / "compositions.json"
CACHE = Path(__file__).resolve().parent / ".sprite-cache.json"
# Hand-drawn vignettes (tools/handmade_vignettes.py), used as "main:<name>" in the cards below.
HANDMADE = {entry[0]: entry for entry in json.loads((ROOT / "static" / "data" / "handmade.json").read_text())["sprites"]}
SERVER = "http://127.0.0.1:8000/api/generate"

# French name shown in the editor -> English prompt the model understands (each one checked visually).
VOCAB = {
    "tour Eiffel": "iron lattice tower", "moulin": "windmill", "château": "castle", "cathédrale": "cathedral",
    "arche de pierre": "stone arch", "pyramide de verre": "glass pyramid", "phare": "lighthouse",
    "voilier": "sailboat", "bateau pirate": "pirate ship", "huître": "oyster", "escargot": "escargot snail",
    "grenouille": "green frog", "tournesol": "sunflower", "montagne": "snowy mountain",
    "gâteau au chocolat": "chocolate cake", "bouteille de vin": "wine bottle", "champagne": "champagne bottle",
    "coq": "rooster", "lavande": "lavender flowers", "fromage": "wheel of cheese", "part de fromage": "cheese wedge",
    "pain": "long bread loaf", "palmier": "palm tree", "montgolfière": "hot air balloon",
    "cheval de manège": "carousel horse", "grande roue": "ferris wheel", "couronne": "crown", "cigogne": "stork",
    "cygne": "swan", "caniche": "poodle dog", "chat noir": "black cat", "vache": "cow", "mouton": "sheep",
    "taureau": "black bull", "verre de vin": "wine glass", "marmite": "cooking pot", "théière": "teapot",
    "tasse de café": "coffee cup", "cerises": "cherries", "ail": "garlic bulb", "pot de miel": "honey jar",
    "glace": "ice cream cone", "vélo": "red bicycle", "mouette": "seagull", "poisson": "fish", "crabe": "crab",
    "étoile de mer": "starfish", "coquillage": "seashell", "ancre": "anchor", "parasol": "beach umbrella",
    "sapin": "pine tree", "chêne": "oak tree", "champignon": "red mushroom", "cerf": "deer", "renard": "fox",
    "papillon": "butterfly", "chouette": "owl", "cheval": "horse", "parfum": "perfume bottle",
    "locomotive": "steam locomotive", "voiture ancienne": "vintage car", "avion": "airplane", "cadeau": "gift box",
    "cloche": "bell", "fontaine": "fountain", "bonhomme de neige": "snowman", "soleil": "sun", "nuage": "cloud",
    "cœur": "red heart", "fraise": "strawberry", "pomme": "red apple", "arc-en-ciel": "rainbow", "aigle": "eagle",
    "lanterne": "lantern", "lettre": "love letter envelope", "masque": "theater mask", "tambour": "drum",
    "trophée": "golden trophy", "tente": "tent", "feu de camp": "campfire", "lune": "full moon",
    "croissant de lune": "crescent moon", "étoile filante": "shooting star", "étoile": "star",
    "bougie": "candle lit", "clé ancienne": "old key", "lapin": "rabbit", "tortue": "turtle",
    "œuf de Pâques": "easter egg", "souris": "mouse", "horloge": "clock", "planète": "planet",
    "fantôme": "ghost", "dragon": "dragon", "chevalier": "knight in armor", "potion": "magic potion",
    "maison": "wooden house", "hérisson": "hedgehog", "tomate": "tomato", "chandelier": "candlestick",
    "abeille": "bee", "épée": "sword", "coffre au trésor": "treasure chest", "fusée": "rocket",
    "drapeau": "french flag", "rose": "red rose", "flamant rose": "flamingo",
}

PALETTES = {  # index 0 is the sprite background (transparent on the card)
    "nuit": ["#101820", "#f4f1de", "#f2c14e", "#4f7cac", "#c0504d"],
    "tricolore": ["#14141a", "#ffffff", "#e63946", "#1d3fbb", "#f1c453"],
    "provence": ["#2a1b3d", "#f6efe0", "#9b72cf", "#f2c14e", "#6a994e"],
    "bretagne": ["#0d1b2a", "#f8f9fa", "#e63946", "#1d6fa3", "#ffd166"],
    "riviera": ["#1b1b2f", "#fff4e0", "#ff6f59", "#2ec4b6", "#ffbf69"],
    "alpes": ["#1d2d44", "#ffffff", "#3e5c76", "#c1121f", "#a7c957"],
    "bordeaux": ["#1a0f14", "#f3e9dc", "#8c1c3c", "#c9a227", "#5b8e3b"],
    "foret": ["#142019", "#f4ecd6", "#d1495b", "#6a994e", "#8b5e3c"],
    "boulangerie": ["#2b1a10", "#fff3d6", "#d9a441", "#8c4a1e", "#e85d4a"],
    "noel": ["#0f1d17", "#ffffff", "#d62828", "#2a9d8f", "#f4d35e"],
    "ete": ["#103045", "#ffffff", "#f25c54", "#3a86ff", "#ffd60a"],
    "campagne": ["#1e1e14", "#fffdf5", "#e76f51", "#2a9d8f", "#e9c46a"],
    "iagora": ["#14141a", "#ffffff", "#ff50be", "#3045d1", "#ffc94d"],
    "automne": ["#1c120c", "#fff1e0", "#d35400", "#8e5b2a", "#f1c40f"],
    "fete": ["#1a1033", "#ffffff", "#ff4d6d", "#4cc9f0", "#ffd60a"],
    "chocolat": ["#1a0e08", "#fde8d0", "#7b3f1d", "#c96f3b", "#e63946"],
    "quete": ["#1a1220", "#e8e4dc", "#e9b949", "#b83b3b", "#7a6c9e"],
}
BACKGROUNDS = {  # chosen to contrast with the palette's lightest colour, which sprites use a lot
    "nuit": "#1b2440", "tricolore": "#8ecae6", "provence": "#c8b6e2", "bretagne": "#a8d0e6", "riviera": "#264653",
    "alpes": "#9fb8d1", "bordeaux": "#2b1220", "foret": "#1e2d24", "boulangerie": "#7fb3a3", "noel": "#13312a",
    "ete": "#8ecae6", "campagne": "#b7d7a8", "iagora": "#bfc7f5", "automne": "#a3b18a", "fete": "#241654",
    "chocolat": "#a8dadc", "quete": "#2b1d2e",
}

# Slots (cx, cy, size) filled in order by the sprites of a card. "t" variants leave room for a text.
LAYOUTS = {
    "hero": [(.22, .56, .62), (.56, .66, .38), (.83, .62, .4), (.6, .2, .16), (.86, .18, .18)],
    "row": [(.18, .62, .42), (.5, .6, .48), (.82, .62, .42), (.32, .18, .15), (.7, .16, .17)],
    "center": [(.5, .56, .64), (.15, .7, .3), (.85, .7, .3), (.15, .2, .15), (.85, .2, .15)],
    "hero_t": [(.24, .64, .54), (.57, .7, .34), (.83, .68, .36), (.62, .42, .14)],
    "row_t": [(.2, .67, .4), (.5, .66, .44), (.8, .67, .4)],
    "center_tb": [(.5, .44, .56), (.16, .52, .3), (.84, .52, .3)],
    "portrait": [(.5, .4, .42), (.26, .78, .24), (.74, .78, .24), (.2, .12, .1), (.8, .12, .1)],
    "portrait_t": [(.5, .48, .38), (.27, .82, .22), (.73, .82, .22), (.82, .26, .1)],
    "portrait_tb": [(.5, .36, .4), (.26, .68, .22), (.74, .68, .22)],
}
TEXT_POSITION = {"top": .15, "bottom": .87}


def card(title, category, orientation, palette, layout, sprites, text=None, background=None):
    return {"title": title, "category": category, "orientation": orientation, "palette": palette,
            "layout": layout, "sprites": sprites, "text": text, "background": background}


def T(text, font="Lobster", style="uni", shape="droit", color="#3045D1", where="top", size=None, bold=False):
    return {"text": text, "font": font, "style": style, "shape": shape, "color": color, "where": where,
            "size": size, "bold": bold}


L, P = "landscape", "portrait"
VILLES, MER, NATURE, GASTRO, FETES, CAMPAGNE, CONTES = (
    "Villes et monuments", "Mer et côtes", "Montagne et nature", "Gastronomie", "Fêtes et traditions",
    "Campagne et animaux", "Contes et imaginaire")

CARDS = [
    # Villes et monuments
    card("Paris la nuit", VILLES, L, "nuit", "hero", ["main:tour Eiffel", "chat noir", "lanterne", "lune", "étoile"]),
    card("Bons baisers de Paris", VILLES, L, "tricolore", "hero_t", ["main:tour Eiffel", "caniche", "tasse de café", "cœur"],
         T("Bons baisers de Paris", "Lobster", "arcenciel", "arche")),
    card("Montmartre", VILLES, L, "nuit", "row", ["main:Moulin Rouge", "chat noir", "main:Sacré-Cœur", "lune", "étoile"]),
    card("Le Louvre", VILLES, L, "iagora", "center", ["main:pyramide du Louvre", "couronne", "parfum@4", "étoile", "étoile"]),
    card("Notre-Dame", VILLES, P, "nuit", "portrait", ["cathédrale", "cloche", "chouette", "lune", "étoile"]),
    card("Souvenir de Versailles", VILLES, L, "quete", "row_t", ["fontaine", "château", "cygne"],
         T("Souvenir de Versailles", "Pacifico", "or", "droit")),
    card("L'Arc de Triomphe", VILLES, L, "tricolore", "center", ["main:Arc de Triomphe", "voiture ancienne@8", "main:drapeau français", "étoile", "étoile"]),
    card("Bisous d'Alsace", VILLES, P, "campagne", "portrait_t", ["cathédrale", "cigogne@3", "cœur", "maison"],
         T("Bisous d'Alsace !", "Lobster", "relief", "vague", "#e76f51")),
    card("Fête des Lumières à Lyon", VILLES, L, "fete", "row_t", ["lanterne", "bougie", "lanterne"],
         T("Fête des Lumières", "Pacifico", "neon", "droit", "#ffd60a")),
    card("Salut de Marseille", VILLES, L, "ete", "hero_t", ["voilier", "marmite", "poisson", "mouette"],
         T("Salut de Marseille !", "Bangers", "bd", "vague")),
    card("Promenade des Anglais", VILLES, L, "riviera", "row", ["palmier", "parasol", "palmier", "soleil", "mouette"]),
    card("Festival de Cannes", VILLES, L, "fete", "center_tb", ["trophée", "palmier", "étoile filante"],
         T("Festival de Cannes", "Anton", "or", "droit", where="bottom")),
    card("Mont-Saint-Michel", VILLES, P, "bretagne", "portrait", ["main:Mont-Saint-Michel", "mouette", "coquillage", "lune", "nuage"]),
    card("Carcassonne", VILLES, L, "quete", "hero_t", ["château", "chevalier", "épée", "couronne"],
         T("Carcassonne", "Anton", "chrome", "arche")),
    card("Toulouse, la ville rose", VILLES, L, "iagora", "row_t", ["avion", "fusée", "planète"],
         T("Toulouse la ville rose", "Pacifico", "iagora", "vague")),
    card("Annecy", VILLES, L, "alpes", "hero", ["montagne", "cygne", "voilier", "nuage", "soleil"]),
    card("Chambord", VILLES, L, "foret", "hero", ["château", "cerf", "renard", "lune", "étoile"]),
    card("Paris vu d'en haut", VILLES, P, "ete", "portrait_t", ["montgolfière", "main:tour Eiffel", "nuage", "mouette"],
         T("Paris vu d'en haut", "Pacifico", "uni", "sourire", "#f25c54")),
    card("Sur le pont d'Avignon", VILLES, L, "provence", "row_t", ["lavande", "arche de pierre", "soleil"],
         T("Sur le pont d'Avignon", "Lobster", "relief", "arche", "#9b72cf")),

    # Mer et côtes
    card("Kenavo la Bretagne", MER, P, "bretagne", "portrait_t", ["phare", "voilier", "crabe", "mouette"],
         T("Kenavo !", "Bangers", "bd", "arche")),
    card("Vive les vacances", MER, L, "ete", "row_t", ["parasol", "glace", "étoile de mer"],
         T("Vive les vacances !", "Bangers", "arcenciel", "vague")),
    card("Huîtres d'Arcachon", MER, L, "bretagne", "row", ["huître", "verre de vin", "coquillage", "mouette", "soleil"]),
    card("Falaises d'Étretat", MER, L, "bretagne", "hero", ["arche de pierre", "voilier", "mouette", "nuage", "soleil"]),
    card("Retour de pêche", MER, L, "nuit", "hero", ["voilier", "poisson", "ancre", "lune", "étoile"]),
    card("Soleil de la Côte d'Azur", MER, L, "riviera", "hero_t", ["palmier", "voilier", "parasol", "soleil"],
         T("Soleil de la Côte d'Azur", "Pacifico", "feu", "arche")),
    card("Saint-Malo", MER, L, "bretagne", "row", ["voilier", "château", "ancre", "mouette", "nuage"]),
    card("Bonjour de l'île de Ré", MER, L, "ete", "row_t", ["vélo", "phare", "soleil"],
         T("Bonjour de l'île de Ré", "Lobster", "uni", "droit", "#3a86ff")),
    card("Bises de Normandie", MER, L, "campagne", "hero_t", ["vache", "pomme", "phare", "mouette"],
         T("Bises de Normandie", "Lobster", "relief", "vague", "#2a9d8f")),
    card("Camargue", MER, L, "riviera", "row", ["cheval", "taureau", "flamant rose", "soleil", "nuage"]),
    card("Pêche à pied", MER, L, "ete", "row", ["crabe", "coquillage", "étoile de mer", "mouette", "soleil"]),
    card("Nuit de pleine mer", MER, P, "nuit", "portrait", ["phare", "voilier", "poisson", "lune", "étoile"]),
    card("Pirates en vue", MER, L, "bretagne", "hero_t", ["bateau pirate", "crabe", "ancre", "mouette"],
         T("À l'abordage !", "Bangers", "bd", "arche")),
    card("Les sardines", MER, L, "bretagne", "row_t", ["poisson", "poisson", "poisson"],
         T("Ça sent la sardine !", "Bangers", "chrome", "vague")),

    # Montagne et nature
    card("Vive la montagne", NATURE, L, "alpes", "hero_t", ["montagne", "sapin", "aigle", "nuage"],
         T("Vive la montagne !", "Bangers", "chrome", "arche")),
    card("Les Pyrénées", NATURE, L, "alpes", "hero", ["montagne", "mouton", "aigle", "nuage", "soleil"]),
    card("Brocéliande", NATURE, P, "foret", "portrait_t", ["chouette", "champignon", "renard", "hérisson"],
         T("Forêt de Brocéliande", "Pacifico", "or", "arche")),
    card("Les Vosges", NATURE, L, "foret", "row", ["cerf", "champignon", "renard", "lune", "étoile"]),
    card("Douce Provence", NATURE, L, "provence", "row_t", ["lavande", "abeille", "lavande"],
         T("Douce Provence", "Lobster", "relief", "vague", "#9b72cf")),
    card("Champ de tournesols", NATURE, L, "campagne", "row", ["tournesol", "tournesol", "papillon", "soleil", "abeille"]),
    card("Après la pluie", NATURE, L, "ete", "hero", ["arc-en-ciel", "escargot", "grenouille", "nuage", "papillon"]),
    card("Nuit à la belle étoile", NATURE, L, "nuit", "row_t", ["tente", "feu de camp", "chouette"],
         T("Nuit à la belle étoile", "Pacifico", "neon", "arche", "#f2c14e")),
    card("Balade d'automne", NATURE, L, "automne", "row", ["champignon", "hérisson", "renard", "pomme", "papillon"]),
    card("Joyeux hiver", NATURE, P, "noel", "portrait_t", ["bonhomme de neige", "cadeau", "cloche", "étoile"],
         T("Joyeux hiver", "Lobster", "chrome", "sourire")),
    card("Cueillette d'été", NATURE, L, "campagne", "row", ["fraise", "cerises", "fraise", "papillon", "soleil"]),
    card("Le jardin", NATURE, L, "campagne", "hero", ["tournesol", "escargot", "grenouille", "papillon", "abeille"]),
    card("Au fil de l'eau", NATURE, L, "ete", "row", ["cygne", "grenouille", "poisson", "nuage", "papillon"]),
    card("Le sommet", NATURE, P, "alpes", "portrait_tb", ["montagne", "aigle", "sapin"],
         T("Tout là-haut", "Anton", "relief", "droit", "#3e5c76", where="bottom")),

    # Gastronomie
    card("Bon appétit", GASTRO, L, "boulangerie", "row_t", ["main:baguette", "gâteau au chocolat", "tasse de café@7"],
         T("Bon appétit !", "Lobster", "or", "arche")),
    card("Plateau de fromages", GASTRO, L, "boulangerie", "row_t", ["fromage", "main:baguette", "main:camembert"],
         T("Fromages de France", "Pacifico", "uni", "droit", "#8c4a1e")),
    card("Escargots de Bourgogne", GASTRO, L, "bordeaux", "row_t", ["escargot", "ail", "verre de vin"],
         T("Escargots de Bourgogne", "Lobster", "or", "vague")),
    card("Bouillabaisse", GASTRO, L, "ete", "hero", ["marmite", "poisson", "crabe", "ail", "soleil"]),
    card("Santé", GASTRO, P, "fete", "portrait_t", ["champagne", "verre de vin", "verre de vin", "étoile filante"],
         T("Santé !", "Pacifico", "or", "droit")),
    card("Vendanges à Bordeaux", GASTRO, L, "bordeaux", "row", ["bouteille de vin", "verre de vin", "main:grappe de raisin", "soleil", "nuage"]),
    card("Pique-nique", GASTRO, L, "campagne", "row_t", ["main:baguette", "main:camembert", "fraise"],
         T("Pique-nique !", "Bangers", "arcenciel", "arche")),
    card("Café de Paris", GASTRO, L, "nuit", "row", ["tasse de café", "main:croissant", "chat noir", "lune", "étoile"]),
    card("L'heure du goûter", GASTRO, L, "chocolat", "row_t", ["théière", "gâteau au chocolat", "fraise@8"],
         T("L'heure du goûter", "Lobster", "relief", "vague", "#c96f3b")),
    card("Le miel", GASTRO, L, "campagne", "hero", ["pot de miel", "abeille", "tournesol", "abeille", "soleil"]),
    card("Marché de Provence", GASTRO, L, "campagne", "row", ["tomate", "ail", "cerises", "soleil", "abeille"]),
    card("La cuisine de mamie", GASTRO, L, "boulangerie", "row_t", ["marmite", "pain", "théière"],
         T("La cuisine de mamie", "Pacifico", "uni", "droit", "#e85d4a")),
    card("Une glace à la plage", GASTRO, P, "ete", "portrait", ["glace", "parasol", "étoile de mer", "soleil", "mouette"]),
    card("Tarte aux pommes", GASTRO, L, "automne", "row", ["pomme", "gâteau au chocolat", "pomme", "soleil", "papillon"]),
    card("Chocolat chaud", GASTRO, L, "chocolat", "row_t", ["tasse de café", "gâteau au chocolat", "cœur"],
         T("Chocolat chaud", "Lobster", "chrome", "sourire")),
    card("Crêperie bretonne", GASTRO, L, "bretagne", "row_t", ["main:crêpe", "main:marinière", "phare"],
         T("Crêperie bretonne", "Lobster", "relief", "arche", "#1d6fa3")),
    card("Petit-déjeuner à Paris", GASTRO, L, "boulangerie", "row_t", ["main:croissant", "tasse de café@7", "main:baguette"],
         T("Bon matin !", "Pacifico", "or", "vague")),
    card("Salon de thé", GASTRO, L, "iagora", "row_t", ["main:macarons", "théière", "cœur"],
         T("L'heure du thé", "Pacifico", "iagora", "arche")),
    card("Fruits rouges", GASTRO, L, "campagne", "row", ["fraise", "cerises", "pomme", "papillon", "abeille"]),

    # Fêtes et traditions
    card("Vive le 14 Juillet", FETES, L, "tricolore", "row_t", ["coq", "main:drapeau français", "étoile filante"],
         T("Vive le 14 Juillet !", "Bangers", "relief", "arche", "#1d3fbb")),
    card("Tirons les rois", FETES, L, "boulangerie", "row_t", ["couronne", "gâteau au chocolat", "cadeau"],
         T("Tirons les rois !", "Pacifico", "or", "arche")),
    card("Joyeux Noël", FETES, P, "noel", "portrait_t", ["cadeau", "bougie", "cloche", "étoile"],
         T("Joyeux Noël", "Lobster", "or", "arche")),
    card("Bonne année", FETES, L, "fete", "row_t", ["champagne", "horloge", "étoile filante"],
         T("Bonne année !", "Pacifico", "neon", "vague", "#ff4d6d")),
    card("Saint-Valentin", FETES, L, "iagora", "row_t", ["cœur", "lettre", "cœur"],
         T("Je t'aime", "Pacifico", "iagora", "sourire")),
    card("Poisson d'avril", FETES, L, "ete", "row_t", ["poisson", "poisson", "poisson"],
         T("Poisson d'avril !", "Bangers", "arcenciel", "vague")),
    card("Joyeuses Pâques", FETES, L, "campagne", "row_t", ["œuf de Pâques", "lapin", "cloche"],
         T("Joyeuses Pâques", "Lobster", "arcenciel", "arche")),
    card("Fête de la musique", FETES, L, "fete", "row_t", ["tambour", "masque", "étoile"],
         T("Fête de la musique", "Bangers", "neon", "vague", "#4cc9f0")),
    card("Carnaval de Nice", FETES, L, "riviera", "row_t", ["masque", "palmier", "étoile filante"],
         T("Carnaval de Nice", "Bangers", "arcenciel", "arche")),
    card("Bouh", FETES, P, "nuit", "portrait_t", ["fantôme", "chouette", "chat noir", "lune"],
         T("Bouh !", "Bangers", "feu", "vague")),
    card("Joyeux anniversaire", FETES, L, "fete", "row_t", ["cadeau", "gâteau au chocolat", "bougie"],
         T("Joyeux anniversaire", "Lobster", "arcenciel", "arche")),
    card("Tour de France", FETES, L, "tricolore", "row_t", ["main:vélo", "trophée", "soleil"],
         T("Allez, allez !", "Bangers", "bd", "vague")),
    card("Allez les Bleus", FETES, L, "tricolore", "row_t", ["coq", "trophée", "étoile"],
         T("Allez les Bleus !", "Anton", "relief", "arche", "#1d3fbb")),
    card("Fête foraine", FETES, L, "fete", "row", ["grande roue", "cheval de manège", "montgolfière", "étoile", "étoile filante"]),
    card("Vive les mariés", FETES, L, "iagora", "row_t", ["cloche", "cœur", "champagne"],
         T("Vive les mariés", "Pacifico", "or", "arche")),
    card("Pendaison de crémaillère", FETES, L, "campagne", "row_t", ["maison", "clé ancienne", "cadeau"],
         T("Bienvenue chez nous", "Lobster", "uni", "sourire", "#e76f51")),

    card("Ooh là là", FETES, L, "tricolore", "row_t", ["main:béret", "main:baguette", "main:marinière"],
         T("Ooh là là !", "Lobster", "arcenciel", "arche")),
    card("Bal musette", FETES, L, "fete", "row_t", ["main:accordéon", "verre de vin", "cœur"],
         T("Bal musette", "Pacifico", "neon", "vague", "#ffd60a")),
    card("Partie de pétanque", FETES, L, "riviera", "row_t", ["main:boules de pétanque", "soleil", "verre de vin"],
         T("Tu tires ou tu pointes ?", "Bangers", "bd", "droit", size=.1)),

    # Campagne et animaux
    card("Bonjour de la ferme", CAMPAGNE, L, "campagne", "row_t", ["vache", "coq", "mouton"],
         T("Bonjour de la ferme", "Lobster", "relief", "arche", "#2a9d8f")),
    card("Cocorico", CAMPAGNE, P, "tricolore", "portrait_t", ["coq", "soleil", "nuage", "étoile"],
         T("Cocorico !", "Bangers", "bd", "arche")),
    card("Caniche à Paris", CAMPAGNE, L, "iagora", "hero", ["main:tour Eiffel", "caniche", "cœur", "nuage", "étoile"]),
    card("Les chats de Paris", CAMPAGNE, L, "nuit", "row", ["chat noir", "lune", "chat noir", "étoile", "étoile"]),
    card("Les cigognes d'Alsace", CAMPAGNE, L, "campagne", "hero", ["cigogne@3", "maison", "cœur", "nuage", "soleil"]),
    card("Le lac aux cygnes", CAMPAGNE, L, "ete", "row", ["cygne", "cygne", "voilier", "nuage", "soleil"]),
    card("Au galop", CAMPAGNE, L, "automne", "hero", ["cheval", "pomme", "renard", "soleil", "nuage"]),
    card("Les grenouilles", CAMPAGNE, L, "foret", "row", ["grenouille", "champignon", "grenouille", "papillon", "lune"]),
    card("Le renard et la chouette", CAMPAGNE, P, "nuit", "portrait", ["chouette", "renard", "hérisson", "lune", "étoile"]),
    card("Le lièvre et la tortue", CAMPAGNE, L, "campagne", "row_t", ["lapin", "tortue", "trophée"],
         T("Rien ne sert de courir", "Lobster", "uni", "droit", "#2a9d8f")),
    card("Le rat des villes", CAMPAGNE, L, "boulangerie", "row_t", ["souris", "fromage", "maison"],
         T("Le rat des villes et le rat des champs", "Pacifico", "uni", "droit", "#8c4a1e", size=.09)),
    card("Le corbeau et le renard", CAMPAGNE, L, "foret", "row_t", ["chouette", "fromage", "renard"],
         T("Le renard et le fromage", "Lobster", "or", "arche")),

    # Contes et imaginaire
    card("Dessine-moi un mouton", CONTES, P, "nuit", "portrait_t", ["mouton", "renard", "planète", "étoile"],
         T("Dessine-moi un mouton", "Pacifico", "or", "arche")),
    card("De la Terre à la Lune", CONTES, L, "nuit", "row_t", ["fusée", "lune", "planète"],
         T("De la Terre à la Lune", "Anton", "chrome", "arche")),
    card("Le tour du monde en 80 jours", CONTES, L, "automne", "row_t", ["montgolfière", "locomotive", "voilier"],
         T("Le tour du monde en 80 jours", "Pacifico", "or", "vague", size=.1)),
    card("Vingt mille lieues sous les mers", CONTES, L, "ete", "row", ["poisson", "ancre", "crabe", "étoile de mer", "coquillage"]),
    card("Le Chat botté", CONTES, L, "quete", "row_t", ["chat noir", "château", "couronne"],
         T("Le Chat botté", "Lobster", "or", "arche")),
    card("Il était une fois", CONTES, P, "quete", "portrait_t", ["château", "dragon", "chevalier", "étoile filante"],
         T("Il était une fois…", "Lobster", "or", "arche")),
    card("La Belle et la Bête", CONTES, L, "quete", "row_t", ["chandelier", "château", "horloge"],
         T("La Belle et la Bête", "Pacifico", "or", "droit")),
    card("Atelier des sorciers", CONTES, L, "nuit", "row", ["potion", "chat noir", "chouette", "lune", "étoile"]),
    card("Chasse au trésor", CONTES, L, "quete", "row_t", ["coffre au trésor", "clé ancienne", "épée"],
         T("Chasse au trésor", "Bangers", "or", "vague")),
    card("Le dragon du château", CONTES, L, "quete", "hero", ["dragon", "château", "épée", "lune", "étoile"]),
    card("Les fantômes du grenier", CONTES, L, "nuit", "row", ["fantôme", "bougie", "fantôme", "lune", "étoile"]),
    card("Rêve d'enfant", CONTES, P, "iagora", "portrait", ["montgolfière@2", "arc-en-ciel", "nuage", "étoile", "étoile"]),
]


def generate(prompt, seed, palette):
    rgb = [[int(h[i:i + 2], 16) for i in (1, 3, 5)] for h in palette]
    body = json.dumps({"prompt": prompt, "seed": seed, "palette": rgb, "temperature": 0.9}).encode()
    request = urllib.request.Request(SERVER, body, {"Content-Type": "application/json"})
    return "".join(map(str, json.load(urllib.request.urlopen(request, timeout=120))["tokens"]))


def border_fill(tokens):
    border = [tokens[i] for i in range(576) if i < 24 or i >= 552 or i % 24 in (0, 23)]
    return sum(t != "0" for t in border) / len(border)


def quality(tokens):
    """Prefer sprites that do not fill their background (a square on the card) and are not nearly empty."""
    filled = sum(t != "0" for t in tokens) / 576
    return -border_fill(tokens) * 4 - abs(filled - .4) - (1 if filled < .12 else 0)


EXTRA_SEEDS = (3, 4, 5, 6)


def main():
    cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    jobs = sorted({(VOCAB[name.split("@")[0]], int(name.split("@")[1]) if "@" in name else seed, c["palette"])
                   for c in CARDS for name in c["sprites"] if not name.startswith("main:")
                   for seed in ((1, 2) if "@" not in name else (0,))})
    missing = [job for job in jobs if f"{job[0]}|{job[1]}|{job[2]}" not in cache]
    print(f"{len(missing)} sprites to generate")
    for index, (prompt, seed, palette) in enumerate(missing):
        cache[f"{prompt}|{seed}|{palette}"] = generate(prompt, seed, PALETTES[palette])
        if index % 20 == 19:
            CACHE.write_text(json.dumps(cache))
            print(index + 1, flush=True)
    CACHE.write_text(json.dumps(cache))

    # Sprites whose best seed still fills its background or is nearly empty get four more tries.
    def weak(prompt, palette):
        best = max((1, 2), key=lambda seed: quality(cache[f"{prompt}|{seed}|{palette}"]))
        tokens = cache[f"{prompt}|{best}|{palette}"]
        return border_fill(tokens) > .15 or sum(t != "0" for t in tokens) / 576 < .12
    retry = sorted({(VOCAB[n], c["palette"]) for c in CARDS for n in c["sprites"] if "@" not in n
                    and not n.startswith("main:") and weak(VOCAB[n], c["palette"])})
    extra = [(prompt, seed, palette) for prompt, palette in retry for seed in EXTRA_SEEDS
             if f"{prompt}|{seed}|{palette}" not in cache]
    print(f"{len(retry)} weak sprites, {len(extra)} extra generations")
    for prompt, seed, palette in extra:
        cache[f"{prompt}|{seed}|{palette}"] = generate(prompt, seed, PALETTES[palette])
    CACHE.write_text(json.dumps(cache))
    retried = set(retry)

    out = []
    for number, c in enumerate(CARDS, 1):
        slots = LAYOUTS[c["layout"]]
        sprites = []
        for name, (cx, cy, size) in zip(c["sprites"], slots):
            if name.startswith("main:"):
                label, _, palette_hex, tokens = HANDMADE[name[5:]]
                sprites.append({"name": label, "handmade": True, "cx": cx, "cy": cy, "size": size, "tokens": tokens,
                                "palette": [f"#{palette_hex[i:i + 6]}" for i in range(0, 30, 6)]})
                continue
            label, _, forced = name.partition("@")
            prompt = VOCAB[label]
            seeds = [int(forced)] if forced else [1, 2] + (list(EXTRA_SEEDS) if (prompt, c["palette"]) in retried else [])
            best = max(seeds, key=lambda s: quality(cache[f"{prompt}|{s}|{c['palette']}"]))
            sprites.append({"name": label, "prompt": prompt, "seed": best, "cx": cx, "cy": cy, "size": size,
                            "tokens": cache[f"{prompt}|{best}|{c['palette']}"]})
        texts = []
        if c["text"]:
            t = c["text"]
            texts.append({"text": t["text"], "font": t["font"], "style": t["style"], "shape": t["shape"],
                          "color": t["color"], "bold": t["bold"], "cx": .5, "cy": TEXT_POSITION[t["where"]],
                          "size": t["size"] or (.12 if c["orientation"] == L else .075)})
        out.append({"id": f"c{number:03d}", "title": c["title"], "category": c["category"],
                    "orientation": c["orientation"], "background": c["background"] or BACKGROUNDS[c["palette"]],
                    "palette": PALETTES[c["palette"]], "sprites": sprites, "texts": texts})
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(out)} compositions, {sum(bool(c['texts']) for c in out)} with text -> {OUT}")


if __name__ == "__main__":
    main()
