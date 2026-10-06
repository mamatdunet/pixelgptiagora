// In-browser PixelGPT engine (runs in a Web Worker). Translates the prompt, embeds it with MiniLM and
// samples the 576 pixels with the PixelGPT 24x24 generator by unstonio, converted to ONNX.
import { AutoModelForSeq2SeqLM, AutoProcessor, Florence2ForConditionalGeneration, RawImage, env, pipeline } from '@huggingface/transformers';
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

// --- Download progress, with exact totals from static/engine/manifest.json (written at build time).
let manifest = {};
const downloads = new Map();

function plan(files) {
  for (const file of files) if (!downloads.has(file)) downloads.set(file, { loaded: 0, total: manifest[file] ?? 0 });
  postDownloads();
}

function postDownloads() {
  let loaded = 0, total = 0;
  for (const entry of downloads.values()) {
    loaded += Math.min(entry.loaded, entry.total);
    total += entry.total;
  }
  postMessage({ type: 'loading', loaded, total });
}

function report(file, loaded) {
  const entry = downloads.get(file);
  if (!entry) return;
  entry.loaded = loaded;
  postDownloads();
}

// transformers.js reports its own downloads ("Xenova/opus-mt-fr-en" + "onnx/encoder_model_uint8.onnx").
function transformersProgress(event) {
  const file = `/models/${event.name}/${event.file}`;
  if (event.status === 'progress' && event.loaded != null) report(file, event.loaded);
  else if (event.status === 'done') report(file, downloads.get(file)?.total ?? 0);
}

async function fetchCached(path) {
  const url = new URL(path, self.location.origin).href;
  const cached = await modelCache.match(url);
  if (cached) {
    report(path, manifest[path] ?? 0);
    return cached.arrayBuffer();
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Téléchargement impossible : ${path}`);
  const reader = response.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    report(path, loaded);
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

const STEP_FILES = { webgpu: '/models/pixelgpt/step_gpu.onnx', wasm: '/models/pixelgpt/step.onnx' };
const CONDITION_FILE = '/models/pixelgpt/condition.onnx';
const TEXT_FILES = [
  '/models/Xenova/all-MiniLM-L6-v2/onnx/model_quantized.onnx',
  '/models/Xenova/opus-mt-fr-en/onnx/encoder_model_uint8.onnx',
  '/models/Xenova/opus-mt-fr-en/onnx/decoder_model_merged_uint8.onnx'
];

// WebGPU uses a step graph whose key/value cache never leaves the GPU; the CPU one gets the filled part.
async function createSessions(backend) {
  const providers = backend === 'webgpu' ? ['webgpu', 'wasm'] : ['wasm'];
  const gpu = location => (backend === 'webgpu' ? { preferredOutputLocation: location } : {});
  const [condition, step] = await Promise.all([fetchCached(CONDITION_FILE), fetchCached(STEP_FILES[backend])]);
  // WebGPU sessions have to be created one after the other.
  const conditionSession = await ort.InferenceSession.create(condition, {
    executionProviders: providers, graphOptimizationLevel: 'all', ...gpu({ mods: 'gpu-buffer', mod_out: 'gpu-buffer' })
  });
  const stepSession = await ort.InferenceSession.create(step, {
    executionProviders: providers, graphOptimizationLevel: 'all', ...gpu({ present_k: 'gpu-buffer', present_v: 'gpu-buffer' })
  });
  return { backend, condition: conditionSession, step: stepSession };
}

// Runs the 576 (or fewer) autoregressive steps; chooseToken picks each pixel from the two logit rows.
async function runSteps(sessions, { caption, paletteTensor, steps, chooseToken, onStep }) {
  const { mods, mod_out: modOut } = await sessions.condition.run({
    caption: new ort.Tensor('float32', caption, [BATCH, 384]), palette: paletteTensor
  });
  const onGpu = sessions.backend === 'webgpu';
  const cacheShape = [LAYERS, BATCH, HEADS, SEQ_LEN, HEAD_DIM];
  if (onGpu) {
    engineBuffers.keys.fill(0);
    engineBuffers.values.fill(0);
  }
  let cacheK = onGpu ? new ort.Tensor('float32', engineBuffers.keys, cacheShape) : null;
  let cacheV = onGpu ? new ort.Tensor('float32', engineBuffers.values, cacheShape) : null;
  let token = SOS;
  for (let position = 0; position < steps; position++) {
    const common = {
      token: new ort.Tensor('int64', BigInt64Array.of(BigInt(token), BigInt(token)), [BATCH, 1]),
      position: new ort.Tensor('int64', BigInt64Array.of(BigInt(position)), [1]),
      palette: paletteTensor, mods, mod_out: modOut
    };
    let logits;
    if (onGpu) {
      const result = await sessions.step.run({ ...common, cache_k: cacheK, cache_v: cacheV });
      if (position) {
        cacheK.dispose();
        cacheV.dispose();
      }
      cacheK = result.present_k;
      cacheV = result.present_v;
      logits = await result.logits.getData();
    } else {
      const past = Math.max(position, 1);
      const bias = position ? new Float32Array(past) : Float32Array.of(-1e9);
      const result = await sessions.step.run({
        ...common,
        past_k: new ort.Tensor('float32', engineBuffers.keys.subarray(0, past * SLOT), [past, LAYERS, BATCH, HEADS, HEAD_DIM]),
        past_v: new ort.Tensor('float32', engineBuffers.values.subarray(0, past * SLOT), [past, LAYERS, BATCH, HEADS, HEAD_DIM]),
        past_bias: new ort.Tensor('float32', bias, [past])
      });
      engineBuffers.keys.set(await result.new_k.getData(), position * SLOT);
      engineBuffers.values.set(await result.new_v.getData(), position * SLOT);
      logits = await result.logits.getData();
      for (const output of Object.values(result)) output.dispose?.();
    }
    token = chooseToken(Array.from(logits.subarray(0, 5)), Array.from(logits.subarray(5, 10)));
    onStep?.(position, token);
  }
  if (onGpu) {
    cacheK.dispose();
    cacheV.dispose();
  }
  mods.dispose?.();
  modOut.dispose?.();
}

const engineBuffers = { keys: new Float32Array(SEQ_LEN * SLOT), values: new Float32Array(SEQ_LEN * SLOT) };

// Milliseconds per step on this computer, measured on a short run after a warm-up.
async function measure(sessions) {
  const caption = new Float32Array(BATCH * 384).fill(.05);
  const paletteTensor = new ort.Tensor('float32', new Float32Array(BATCH * 15).fill(.5), [BATCH, 5, 3]);
  let started = 0;
  await runSteps(sessions, {
    caption, paletteTensor, steps: 40, chooseToken: () => 1,
    onStep: position => { if (position === 7) started = performance.now(); }
  });
  return (performance.now() - started) / 32;
}

// Picks the faster of the graphics card and the processor the first time (the choice is then remembered
// by the page): older integrated GPUs, like Intel UHD 620, are often slower than the CPU for this model.
async function chooseSessions(preferred) {
  const gpu = preferred !== 'wasm' && await webgpuAvailable();
  if (preferred && preferred !== 'auto') {
    const backend = preferred === 'webgpu' && gpu ? 'webgpu' : 'wasm';
    plan([CONDITION_FILE, STEP_FILES[backend]]);
    return { sessions: await createSessions(backend), msPerStep: null };
  }
  if (!gpu) {
    plan([CONDITION_FILE, STEP_FILES.wasm]);
    const sessions = await createSessions('wasm');
    postMessage({ type: 'measuring' });
    return { sessions, msPerStep: await measure(sessions) * 1.3 };
  }
  plan([CONDITION_FILE, STEP_FILES.webgpu]);
  const gpuSessions = await createSessions('webgpu');
  postMessage({ type: 'measuring' });
  const gpuSpeed = await measure(gpuSessions);
  if (gpuSpeed < 15) return { sessions: gpuSessions, msPerStep: gpuSpeed };
  // The graphics card is slow here: try the processor too (one more 29 MB download, once).
  plan([STEP_FILES.wasm]);
  const cpuSessions = await createSessions('wasm');
  postMessage({ type: 'measuring' });
  // The CPU graph gets slower as the sequence grows; 1.3 accounts for the average length.
  const cpuSpeed = await measure(cpuSessions) * 1.3;
  if (cpuSpeed < gpuSpeed) {
    await gpuSessions.condition.release();
    await gpuSessions.step.release();
    return { sessions: cpuSessions, msPerStep: cpuSpeed };
  }
  await cpuSessions.condition.release();
  await cpuSessions.step.release();
  return { sessions: gpuSessions, msPerStep: gpuSpeed };
}

async function load(preferred) {
  manifest = await fetch('/static/engine/manifest.json').then(r => r.json()).catch(() => ({}));
  plan(TEXT_FILES);
  const [scanOrder, marian, nullCaption, embed, translator] = await Promise.all([
    fetch('/models/pixelgpt/scan_order.json').then(r => r.json()),
    fetch('/models/Xenova/opus-mt-fr-en/marian_source.json').then(r => r.json()),
    fetch('/models/pixelgpt/null_caption.json').then(r => r.json()),
    pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'q8', device: 'wasm', progress_callback: transformersProgress }),
    AutoModelForSeq2SeqLM.from_pretrained('Xenova/opus-mt-fr-en', { dtype: 'uint8', device: 'wasm', progress_callback: transformersProgress })
  ]);
  TEXT_FILES.forEach(file => report(file, manifest[file] ?? 0));
  const { sessions, msPerStep } = await chooseSessions(preferred);
  engine = {
    backend: sessions.backend, sessions, scanOrder, embed, translator, tokenizer: new MarianTokenizer(marian),
    nullCaption: Float32Array.from(nullCaption), translations: new Map(), embeddings: new Map()
  };
  postMessage({ type: 'ready', backend: sessions.backend, secondsPerSprite: msPerStep ? Math.round(msPerStep * SEQ_LEN / 1000 + 1) : null });
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
  const random = mulberry32(seed);
  const grid = new Uint8Array(SEQ_LEN);
  await runSteps(engine.sessions, {
    caption, paletteTensor, steps: SEQ_LEN,
    chooseToken: (conditional, unconditional) => sampleNext(conditional, unconditional, temperature, random),
    onStep: (position, token) => {
      grid[engine.scanOrder[position]] = token;
      // Every 8 pixels: enough for a smooth progress bar without flooding the page.
      if ((position + 1) % 8 === 0 || position === SEQ_LEN - 1) {
        postMessage({ type: 'progress', id, step: position + 1, tokens: Array.from(grid) });
      }
    }
  });
  postMessage({ type: 'done', id, english, tokens: Array.from(grid), ms: Math.round(performance.now() - started) });
}

// --- Image converter: Florence-2 (Microsoft, MIT) describes a picture and finds its main object.
// Loaded only the first time someone imports an image (about 210 MB, then cached like the other models).
const VISION_MODEL = 'onnx-community/Florence-2-base-ft';
let vision = null;

async function loadVision() {
  if (vision) return vision;
  const files = new Map(Object.entries(manifest).filter(([file]) => file.includes(VISION_MODEL)).map(([file, size]) => [file, { loaded: 0, total: size }]));
  const total = [...files.values()].reduce((sum, file) => sum + file.total, 0);
  const progress_callback = event => {
    const entry = files.get(`/models/${event.name}/${event.file}`);
    if (!entry) return;
    if (event.status === 'progress' && event.loaded != null) entry.loaded = event.loaded;
    else if (event.status === 'done') entry.loaded = entry.total;
    else return;
    let loaded = 0;
    for (const file of files.values()) loaded += Math.min(file.loaded, file.total);
    postMessage({ type: 'vision-loading', loaded, total });
  };
  const [model, processor] = await Promise.all([
    Florence2ForConditionalGeneration.from_pretrained(VISION_MODEL, {
      dtype: { vision_encoder: 'q4', embed_tokens: 'q8', encoder_model: 'q4', decoder_model_merged: 'q4' },
      device: 'wasm', progress_callback
    }),
    AutoProcessor.from_pretrained(VISION_MODEL)
  ]);
  vision = { model, processor };
  return vision;
}

async function runVisionTask(image, task) {
  const { model, processor } = vision;
  const inputs = await processor(image, processor.construct_prompts(task));
  const ids = await model.generate({ ...inputs, max_new_tokens: 48, num_beams: 1 });
  const text = processor.batch_decode(ids, { skip_special_tokens: false })[0];
  return processor.post_process_generation(text, task, image.size)[task];
}

async function describe({ id, width, height, data }) {
  await loadVision();
  const image = new RawImage(new Uint8ClampedArray(data), width, height, 4).rgb();
  const caption = await runVisionTask(image, '<CAPTION>');
  const detection = await runVisionTask(image, '<OD>');
  const objects = (detection?.labels ?? []).map((label, index) => ({ label, box: detection.bboxes[index] }));
  postMessage({ type: 'described', id, caption: String(caption ?? '').trim(), objects });
}

let queue = Promise.resolve();
self.addEventListener('message', ({ data }) => {
  if (data.type === 'load') {
    queue = queue.then(() => load(data.backend)).catch(error => postMessage({ type: 'error', message: error.message }));
  } else if (data.type === 'describe') {
    queue = queue.then(() => describe(data)).catch(error => postMessage({ type: 'error', id: data.id, message: error.message }));
  } else if (data.type === 'generate') {
    queue = queue.then(() => generate(data)).catch(error => postMessage({ type: 'error', id: data.id, message: error.message }));
  }
});
