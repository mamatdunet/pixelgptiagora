// French -> English prompt translation: opus-mt-fr-en (ONNX via transformers.js), exact SentencePiece
// tokenisation and a 4-beam search, which greedy decoding cannot match on short prompts.
import { Tensor } from '@huggingface/transformers';

// French words the translator gets wrong on their own ("chouette" -> "nice"); swapped before translating.
const FRENCH_GLOSSARY = {
  chouette: 'owl', chouettes: 'owls', sapin: 'pine tree', sapins: 'pine trees',
  luciole: 'firefly', lucioles: 'fireflies', 'part de': 'tranche de'
};
// Word-level fixes for translations that are correct but not what a sprite prompt means.
const TRANSLATION_FIXES = { fungus: 'mushroom', fungi: 'mushrooms', slim: 'slime', slims: 'slimes' };

export async function translateFrench(model, tokenizer, text, { beams = 4, maxLength = 48 } = {}) {
  let source = text.toLowerCase();
  for (const [french, english] of Object.entries(FRENCH_GLOSSARY)) {
    source = source.replace(new RegExp(`(^|[^\\p{L}])${french}(?=$|[^\\p{L}])`, 'giu'), `$1${english}`);
  }
  const ids = tokenizer.encode(source).map(BigInt);
  const { decoder_start_token_id: start } = model.config;
  const length = ids.length;
  let hypotheses = [{ tokens: [start], score: 0 }];
  const finished = [];
  for (let step = 0; step < maxLength && hypotheses.length; step++) {
    const count = hypotheses.length;
    const input_ids = new Tensor('int64', BigInt64Array.from({ length: count * length }, (_, i) => ids[i % length]), [count, length]);
    const attention_mask = new Tensor('int64', new BigInt64Array(count * length).fill(1n), [count, length]);
    const decoder_input_ids = new Tensor('int64', BigInt64Array.from(hypotheses.flatMap(h => h.tokens), BigInt), [count, step + 1]);
    const { logits } = await model({ input_ids, attention_mask, decoder_input_ids });
    const vocab = logits.dims[2];
    const candidates = [];
    hypotheses.forEach((hypothesis, row) => {
      const offset = (row * (step + 1) + step) * vocab;
      const values = logits.data.subarray(offset, offset + vocab);
      let max = -Infinity;
      for (let i = 0; i < vocab; i++) if (i !== tokenizer.pad && values[i] > max) max = values[i];
      let sum = 0;
      for (let i = 0; i < vocab; i++) if (i !== tokenizer.pad) sum += Math.exp(values[i] - max);
      const logSum = max + Math.log(sum);
      const top = [];
      for (let i = 0; i < vocab; i++) {
        if (i === tokenizer.pad) continue;
        if (top.length < beams * 2 || values[i] > values[top.at(-1)]) {
          if (top.length === beams * 2) top.pop();
          top.push(i);
          top.sort((a, b) => values[b] - values[a]);
        }
      }
      for (const token of top) candidates.push({ tokens: [...hypothesis.tokens, token], score: hypothesis.score + values[token] - logSum });
    });
    candidates.sort((a, b) => b.score - a.score);
    hypotheses = [];
    for (const candidate of candidates) {
      if (candidate.tokens.at(-1) === tokenizer.eos) finished.push({ ...candidate, normalized: candidate.score / (candidate.tokens.length - 1) });
      else hypotheses.push(candidate);
      if (hypotheses.length === beams) break;
    }
    // Stop once no open hypothesis can beat the best finished one (scores only decrease).
    const bestFinished = Math.max(...finished.map(f => f.normalized));
    if (finished.length >= beams && hypotheses.every(h => h.score / (step + 1) < bestFinished)) break;
  }
  const pool = finished.length ? finished : hypotheses.map(h => ({ ...h, normalized: h.score / h.tokens.length }));
  pool.sort((a, b) => b.normalized - a.normalized);
  const english = tokenizer.decode(pool[0].tokens.slice(1)).replace(/\.$/, '').toLowerCase()
    .replace(/[a-z]+/g, word => TRANSLATION_FIXES[word] ?? word);
  return english || text;
}
