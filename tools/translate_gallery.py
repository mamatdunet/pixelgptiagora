"""Add French captions to static/gallery.json with Helsinki-NLP/opus-mt-en-fr.

Entries go from [family, caption, palette, tokens] to [family, caption_fr, caption_en, palette, tokens].
Pass a JSON file of {english: french} overrides as the first argument to reuse or correct translations.
"""
import json, sys
from pathlib import Path

PATH = Path(__file__).resolve().parent.parent / "static" / "data" / "library.json"
gallery = json.loads(PATH.read_text(encoding="utf-8"))
todo = [entry for entry in gallery["sprites"] if len(entry) == 4]
known = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8")) if len(sys.argv) > 1 else {}
missing = sorted({entry[1] for entry in todo} - known.keys())
if missing:
    from huggingface_hub import snapshot_download
    from transformers import MarianMTModel, MarianTokenizer
    path = snapshot_download("Helsinki-NLP/opus-mt-en-fr", allow_patterns=["*.json", "*.spm", "pytorch_model.bin", "vocab*"])
    tokenizer, model = MarianTokenizer.from_pretrained(path), MarianMTModel.from_pretrained(path).eval()
    for start in range(0, len(missing), 32):
        batch = missing[start:start + 32]
        output = model.generate(**tokenizer(batch, return_tensors="pt", padding=True), max_new_tokens=48, num_beams=4)
        known.update(zip(batch, tokenizer.batch_decode(output, skip_special_tokens=True)))
for entry in todo:
    french = known[entry[1]].strip().rstrip(".").replace('"', "")
    entry[1:2] = [french[:1].lower() + french[1:] if french[1:2].islower() else french, entry[1]]
PATH.write_text(json.dumps(gallery, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(f"{len(todo)} captions translated")
