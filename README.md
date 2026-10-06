# Atelier pixel art IAgora

**Composez une carte postale en pixel art avec une IA qui tourne dans votre navigateur.**
Site en ligne : https://pixelgpt-iagora.vercel.app · Galerie collective : https://pixelgpt-iagora.vercel.app/galerie

Décrivez un objet en français (« chouette des neiges », « épée en fer »), un petit modèle d'IA le dessine
pixel par pixel en 24 × 24, puis assemblez vignettes et textes WordArt sur une carte postale 15 × 10 cm
à imprimer ou à publier dans la galerie collective de l'atelier.

## D'après PixelGPT 24×24, par unstonio

Ce projet s'inspire de **[PixelGPT 24×24](https://github.com/unstonio/pixelgpt-24x24)**, créé par
**unstonio** ([démo originale](https://unston.io/pixelgpt)), et en réutilise le modèle de génération.
Tout le mérite du modèle (architecture, entraînement, jeu de données) revient à son auteur.

Ce que ce projet ajoute : la conversion du modèle pour qu'il tourne entièrement dans le navigateur
(ONNX Runtime Web, WebGPU ou WebAssembly), la traduction des prompts du français vers l'anglais,
l'éditeur de cartes postales aux couleurs d'IAgora (textes WordArt, bibliothèque de vignettes,
compositions d'exemple, export 300 dpi, impression) et la galerie collective.

> PixelGPT 24×24 n'est publié avec aucune licence. Son modèle est redistribué ici avec mention de
> l'auteur, à des fins d'ateliers de médiation non commerciaux ; il sera retiré sur simple demande
> d'unstonio.

## Crédits

| Élément | Auteur | Licence |
| --- | --- | --- |
| Modèle PixelGPT 24×24 (converti en ONNX) | [unstonio](https://github.com/unstonio/pixelgpt-24x24) | aucune publiée (voir ci-dessus) |
| Vignettes de la bibliothèque (familles) | [PixelGPT 24×24 (20K)](https://huggingface.co/datasets/unstonio/pixelgpt-24x24-20k), unstonio | CC BY 4.0 |
| Patrimoine dessiné à la main (18 vignettes) | dessiné pour l'atelier IAgora (`tools/handmade_vignettes.py`) | — |
| Cartes d'exemple (onglet Compositions) | composées pour l'atelier IAgora, vignettes générées par le modèle ou dessinées à la main | — |
| Palettes de couleurs | jeu d'entraînement PixelGPT, unstonio | voir ci-dessus |
| Traduction français → anglais | [opus-mt-fr-en](https://huggingface.co/Helsinki-NLP/opus-mt-fr-en), Helsinki-NLP ; version ONNX [Xenova](https://huggingface.co/Xenova/opus-mt-fr-en) | CC BY 4.0 |
| Compréhension du texte | [all-MiniLM-L6-v2](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2), sentence-transformers ; version ONNX Xenova | Apache 2.0 |
| Moteur dans le navigateur | [ONNX Runtime Web](https://onnxruntime.ai) (Microsoft), [Transformers.js](https://github.com/huggingface/transformers.js) (Hugging Face) | MIT, Apache 2.0 |
| Polices | Anton, Heebo, Press Start 2P, Bangers, Lobster, Pacifico | SIL Open Font License |
| Design | design system IAgora | — |

## Comment ça marche

- **Tout tourne sur l'ordinateur** : à la première visite, le navigateur télécharge environ 200 Mo
  (générateur 44 Mo, traducteur 104 Mo, encodeur 23 Mo, moteur WebAssembly) et les garde en cache ;
  les visites suivantes démarrent tout de suite, même hors connexion. Les descriptions tapées ne
  quittent jamais l'ordinateur.
- **Vitesse** : quelques secondes par vignette avec une carte graphique (WebGPU, Chrome / Edge / Safari
  récents), plus lent sur processeur seul. `?moteur=processeur` ou `?moteur=carte-graphique` dans
  l'adresse force l'un ou l'autre.
- **Galerie collective** : « Publier » envoie la carte (PNG) à `api/creations.js`, stockée dans
  Vercel Blob. Supprimer une carte demande le mot de passe de l'atelier (seule son empreinte SHA-256
  est dans le code ; la variable `DELETE_PASSWORD` le remplace).

## Organisation du dépôt

```text
index.html, galerie.html     éditeur et galerie collective
static/                      interface (app.js, wordart.js, engine.js, styles IAgora, polices, données)
static/engine/               moteur assemblé (worker.js) et fichiers WebAssembly d'ONNX Runtime
src/                         sources du moteur : worker, tokeniseur SentencePiece, traduction en faisceau
models/pixelgpt/             générateur PixelGPT en ONNX (4 bits) : condition, step (processeur), step_gpu
models/Xenova/               encodeur MiniLM et traducteur opus-mt-fr-en (ONNX)
api/creations.js             galerie : lister, publier, supprimer (Vercel Function + Vercel Blob)
tools/                       assemblage du moteur, serveur local, scripts de conversion
```

## Utiliser l'atelier

- **En ligne** : ouvrez le site, c'est tout. Chaque ordinateur télécharge le modèle une fois.
- **En local, sans internet** (galerie indisponible) :
  ```bash
  npm install
  npm run bundle
  npm run atelier
  ```
  puis ouvrez http://localhost:8080.
- **Déployer** : `vercel deploy --prod` (Vercel installe les dépendances et assemble le moteur).

## Reconvertir le modèle

Les scripts de `tools/` partent du dépôt d'origine `unstonio/pixelgpt-24x24` (checkpoint
`models/pixelar_fp16.pt` et `model_runtime.py`) : `export_onnx.py` produit les graphes ONNX,
`build_gallery.py` et `translate_gallery.py` la bibliothèque de vignettes,
`build_compositions.py` les compositions d'exemple.
