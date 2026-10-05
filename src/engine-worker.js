// In-browser PixelGPT engine (runs in a Web Worker). Translates the prompt, embeds it with MiniLM and
// samples the 576 pixels with the PixelGPT 24x24 generator by unstonio, converted to ONNX.
import { AutoModelForSeq2SeqLM, env, pipeline } from '@huggingface/transformers';
import * as ort from 'onnxruntime-web/webgpu';
import { MarianTokenizer } from './marian.js';
import { translateFrench } from './translate.js';

const MODELS = '/models/';
const CACHE_NAME = 'pixelgpt-iagora-models-v1';
const LAYERS = 14, HEADS = 8, HEAD_DIM = 64, BATCH = 2, SEQ_LEN = 576, SOS = 5, GUIDANCE = 3, TOP_P = 0.95;
const SLOT = LAYERS * BATCH * HEADS * HEAD_DIM;

ort.env.wasm.wasmPaths = '/static/engine/';
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;

// Models are kept in the Cache API so a workshop computer downloads them only once, then works offline.
const modelCache = {
  async match(request) {
    const cache = await caches.open(CACHE_NAME);
    return cache.match(typeof request === 'string' ? request : request.url);
  },
  async put(request, response) {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(typeof request === 'string' ? request : request.url, response);
  }
};
env.localModelPath = MODELS;
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.useBrowserCache = false;
env.useCustomCache = true;
env.customCache = modelCache;

const progress = new Map();
function report(file, loaded, total) {
  progress.set(file, { loaded, total });
  let sum = 0, size = 0;
  for (const entry of progress.values()) {
    sum += entry.loaded;
    size += entry.total;
  }
  postMessage({ type: 'loading', loaded: sum, total: size });
}

async function fetchCached(path, expectedSize) {
  const url = new URL(path, self.location.origin).href;
  const cached = await modelCache.match(url);
  if (cached) {
    report(path, expectedSize, expectedSize);
    return cached.arrayBuffer();
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Téléchargement impossible : ${path}`);
  const total = Number(response.headers.get('content-length')) || expectedSize;
  const reader = response.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    report(path, loaded, total);
  }
  const blob = new Blob(chunks);
  await modelCache.put(url, new Response(blob, { headers: { 'Content-Type': 'application/octet-stream' } }));
  return blob.arrayBuffer();
}

let engine = null;

async function webgpuAvailable() {
  try {
    return Boolean(navigator.gpu && await navigator.gpu.requestAdapter());
  } catch {
    return false;
  }
}

async function load(preferred) {
  const backend = preferred === 'wasm' || !(await webgpuAvailable()) ? 'wasm' : 'webgpu';
  // Approximate sizes so the progress bar is right before every download has started.
  // WebGPU uses a variant whose key/value cache never leaves the GPU; the CPU variant takes the filled part.
  const stepFile = backend === 'webgpu' ? '/models/pixelgpt/step_gpu.onnx' : '/models/pixelgpt/step.onnx';
  report(stepFile, 0, 29.3e6);
  report('/models/pixelgpt/condition.onnx', 0, 14.8e6);
  report('minilm', 0, 23e6);
  report('opus', 0, 107e6);
  const transformersProgress = event => {
    if (event.status === 'progress' && event.total) report(event.file.includes('opus') ? 'opus' : 'minilm', event.loaded, event.total);
  };
  const [scanOrder, marian, condition, step, embed, translator] = await Promise.all([
    fetch('/models/pixelgpt/scan_order.json').then(r => r.json()),
    fetch('/models/Xenova/opus-mt-fr-en/marian_source.json').then(r => r.json()),
    fetchCached('/models/pixelgpt/condition.onnx', 14.8e6),
    fetchCached(stepFile, 29.3e6),
    pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'q8', device: 'wasm', progress_callback: transformersProgress }),
    AutoModelForSeq2SeqLM.from_pretrained('Xenova/opus-mt-fr-en', { dtype: 'uint8', device: 'wasm', progress_callback: transformersProgress })
  ]);
  const providers = backend === 'webgpu' ? ['webgpu', 'wasm'] : ['wasm'];
  const gpu = location => (backend === 'webgpu' ? { preferredOutputLocation: location } : {});
  // WebGPU sessions have to be created one after the other.
  const sessions = [
    await ort.InferenceSession.create(condition, {
      executionProviders: providers, graphOptimizationLevel: 'all', ...gpu({ mods: 'gpu-buffer', mod_out: 'gpu-buffer' })
    }),
    await ort.InferenceSession.create(step, {
      executionProviders: providers, graphOptimizationLevel: 'all', ...gpu({ present_k: 'gpu-buffer', present_v: 'gpu-buffer' })
    })
  ];
  engine = {
    backend, scanOrder, embed, translator, tokenizer: new MarianTokenizer(marian),
    condition: sessions[0], step: sessions[1],
    nullCaption: null, translations: new Map(), embeddings: new Map(),
    keys: new Float32Array(SEQ_LEN * SLOT), values: new Float32Array(SEQ_LEN * SLOT)
  };
  const nullCaption = await fetch('/models/pixelgpt/null_caption.json').then(r => r.json());
  engine.nullCaption = Float32Array.from(nullCaption);
  postMessage({ type: 'ready', backend });
}

// Small seeded PRNG so a seed reproduces the same sprite.
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleNext(conditional, unconditional, temperature, random) {
  const logits = conditional.map((value, index) => (unconditional[index] + GUIDANCE * (value - unconditional[index])) / Math.max(temperature, 1e-6));
  const order = logits.map((_, index) => index).sort((a, b) => logits[b] - logits[a]);
  const max = logits[order[0]];
  const probabilities = order.map(index => Math.exp(logits[index] - max));
  const total = probabilities.reduce((sum, value) => sum + value, 0);
  let cumulative = 0;
  const kept = [];
  for (let rank = 0; rank < order.length; rank++) {
    const probability = probabilities[rank] / total;
    kept.push([order[rank], probability]);
    cumulative += probability;
    if (cumulative > TOP_P) break;
  }
  const keptTotal = kept.reduce((sum, [, probability]) => sum + probability, 0);
  let draw = random() * keptTotal;
  for (const [index, probability] of kept) {
    draw -= probability;
    if (draw <= 0) return index;
  }
  return kept.at(-1)[0];
}

async function englishFor(prompt) {
  if (!engine.translations.has(prompt)) {
    engine.translations.set(prompt, await translateFrench(engine.translator, engine.tokenizer, prompt));
  }
  return engine.translations.get(prompt);
}

async function embeddingFor(english) {
  if (!engine.embeddings.has(english)) {
    const output = await engine.embed(english, { pooling: 'mean', normalize: true });
    engine.embeddings.set(english, Float32Array.from(output.data));
  }
  return engine.embeddings.get(english);
}

async function generate({ id, prompt, palette, temperature, seed }) {
  const started = performance.now();
  const english = await englishFor(prompt);
  postMessage({ type: 'start', id, english });
  const embedding = await embeddingFor(english);
  const caption = new Float32Array(BATCH * 384);
  caption.set(embedding, 0);
  caption.set(engine.nullCaption, 384);
  const rgb = palette.flat().map(value => value / 255);
  const paletteTensor = new ort.Tensor('float32', Float32Array.from([...rgb, ...rgb]), [BATCH, 5, 3]);
  const { mods, mod_out: modOut } = await engine.condition.run({
    caption: new ort.Tensor('float32', caption, [BATCH, 384]), palette: paletteTensor
  });
  const random = mulberry32(seed);
  const sequence = new Uint8Array(SEQ_LEN);
  const grid = new Uint8Array(SEQ_LEN);
  let token = SOS;
  const onGpu = engine.backend === 'webgpu';
  const cacheShape = [LAYERS, BATCH, HEADS, SEQ_LEN, HEAD_DIM];
  let cacheK = onGpu ? new ort.Tensor('float32', engine.keys, cacheShape) : null;
  let cacheV = onGpu ? new ort.Tensor('float32', engine.values, cacheShape) : null;
  if (onGpu) {
    engine.keys.fill(0);
    engine.values.fill(0);
  }
  for (let position = 0; position < SEQ_LEN; position++) {
    const common = {
      token: new ort.Tensor('int64', BigInt64Array.of(BigInt(token), BigInt(token)), [BATCH, 1]),
      position: new ort.Tensor('int64', BigInt64Array.of(BigInt(position)), [1]),
      palette: paletteTensor, mods, mod_out: modOut
    };
    if (onGpu) {
      const result = await engine.step.run({ ...common, cache_k: cacheK, cache_v: cacheV });
      if (position) {
        cacheK.dispose();
        cacheV.dispose();
      }
      cacheK = result.present_k;
      cacheV = result.present_v;
      const logits = await result.logits.getData();
      token = sampleNext(Array.from(logits.subarray(0, 5)), Array.from(logits.subarray(5, 10)), temperature, random);
      sequence[position] = token;
      grid[engine.scanOrder[position]] = token;
      if ((position + 1) % 24 === 0 || position === SEQ_LEN - 1) {
        postMessage({ type: 'progress', id, step: position + 1, tokens: Array.from(grid) });
      }
      continue;
    }
    const past = Math.max(position, 1);
    const bias = position ? new Float32Array(past) : Float32Array.of(-1e9);
    const result = await engine.step.run({
      ...common,
      past_k: new ort.Tensor('float32', engine.keys.subarray(0, past * SLOT), [past, LAYERS, BATCH, HEADS, HEAD_DIM]),
      past_v: new ort.Tensor('float32', engine.values.subarray(0, past * SLOT), [past, LAYERS, BATCH, HEADS, HEAD_DIM]),
      past_bias: new ort.Tensor('float32', bias, [past])
    });
    engine.keys.set(await result.new_k.getData(), position * SLOT);
    engine.values.set(await result.new_v.getData(), position * SLOT);
    const logits = await result.logits.getData();
    token = sampleNext(Array.from(logits.subarray(0, 5)), Array.from(logits.subarray(5, 10)), temperature, random);
    sequence[position] = token;
    grid[engine.scanOrder[position]] = token;
    for (const output of Object.values(result)) output.dispose?.();
    if ((position + 1) % 24 === 0 || position === SEQ_LEN - 1) {
      postMessage({ type: 'progress', id, step: position + 1, tokens: Array.from(grid) });
    }
  }
  if (onGpu) {
    cacheK.dispose();
    cacheV.dispose();
  }
  mods.dispose?.();
  modOut.dispose?.();
  postMessage({ type: 'done', id, english, tokens: Array.from(grid), ms: Math.round(performance.now() - started) });
}

let queue = Promise.resolve();
self.addEventListener('message', ({ data }) => {
  if (data.type === 'load') {
    queue = queue.then(() => load(data.backend)).catch(error => postMessage({ type: 'error', message: error.message }));
  } else if (data.type === 'generate') {
    queue = queue.then(() => generate(data)).catch(error => postMessage({ type: 'error', id: data.id, message: error.message }));
  }
});
