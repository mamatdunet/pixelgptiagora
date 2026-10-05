// Exact port of the SentencePiece unigram tokenizer used by Helsinki-NLP/opus-mt-fr-en (source.spm).
// The tokenizer.json shipped with the ONNX conversion only approximates it and garbles translations.
const SPACE = '▁';
const SPECIAL = new Set(['<unk>', '<s>', '</s>', '<pad>']);

export class MarianTokenizer {
  constructor({ pieces, vocab }) {
    this.scores = new Map();
    let minScore = 0;
    let maxLength = 1;
    for (const [piece, score] of pieces) {
      if (SPECIAL.has(piece)) continue;
      this.scores.set(piece, score);
      minScore = Math.min(minScore, score);
      maxLength = Math.max(maxLength, Array.from(piece).length);
    }
    this.unknownScore = minScore - 10;
    this.maxLength = maxLength;
    this.vocab = vocab;
    this.inverse = new Map(Object.entries(vocab).map(([piece, id]) => [id, piece]));
    this.unk = vocab['<unk>'];
    this.eos = vocab['</s>'];
    this.pad = vocab['<pad>'];
  }

  // Viterbi segmentation over code points, maximising the sum of piece log-probabilities.
  pieces(text) {
    const normalized = text.normalize('NFKC').replace(/\s+/g, ' ').trim();
    if (!normalized) return [];
    const chars = Array.from(SPACE + normalized.replaceAll(' ', SPACE));
    const best = new Float64Array(chars.length + 1).fill(-Infinity);
    const from = new Int32Array(chars.length + 1);
    best[0] = 0;
    for (let end = 1; end <= chars.length; end++) {
      for (let start = Math.max(0, end - this.maxLength); start < end; start++) {
        if (best[start] === -Infinity) continue;
        const piece = chars.slice(start, end).join('');
        let score = this.scores.get(piece);
        if (score === undefined) {
          if (end - start !== 1) continue;
          score = this.unknownScore;
        }
        if (best[start] + score > best[end]) {
          best[end] = best[start] + score;
          from[end] = start;
        }
      }
    }
    const result = [];
    for (let end = chars.length; end > 0; end = from[end]) result.push(chars.slice(from[end], end).join(''));
    return result.reverse();
  }

  encode(text) {
    return [...this.pieces(text).map(piece => this.vocab[piece] ?? this.unk), this.eos];
  }

  decode(ids) {
    return ids
      .filter(id => id !== this.eos && id !== this.pad && id !== this.unk)
      .map(id => this.inverse.get(id) ?? '')
      .join('')
      .replaceAll(SPACE, ' ')
      .trim();
  }
}
