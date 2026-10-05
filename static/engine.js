// Main-thread side of the in-browser engine: starts the worker, picks palettes and streams generations
// with the same event shapes the original PixelGPT server sent ("start", "progress", "done").
const PixelEngine = (() => {
  const worker = new Worker('/static/engine/worker.js', { type: 'module' });
  const pending = new Map();
  let nextRequest = 1;
  let palettes = null;
  let readyResolve;
  let readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  let loadingListener = () => {};
  let backend = null;

  worker.addEventListener('message', ({ data }) => {
    if (data.type === 'loading') loadingListener(data.loaded, data.total);
    else if (data.type === 'ready') {
      backend = data.backend;
      readyResolve(data.backend);
    } else if (data.type === 'error' && data.id == null) readyReject(new Error(data.message));
    else pending.get(data.id)?.(data);
  });

  function randomSeed() {
    return crypto.getRandomValues(new Uint32Array(1))[0] >>> 1;
  }

  async function loadPalettes() {
    if (!palettes) palettes = new Uint8Array(await (await fetch('/static/data/palettes.bin')).arrayBuffer());
    return palettes;
  }

  // 217,925 five-colour palettes from the PixelGPT training set, 15 bytes each.
  async function paletteAt(index) {
    const data = await loadPalettes();
    const count = data.length / 15;
    const start = (index % count) * 15;
    return Array.from({ length: 5 }, (_, color) => Array.from(data.subarray(start + color * 3, start + color * 3 + 3)));
  }

  return {
    ready,
    get backend() { return backend; },
    load(onLoading, preferredBackend = null) {
      loadingListener = onLoading;
      worker.postMessage({ type: 'load', backend: preferredBackend });
      return ready;
    },
    randomPalette() {
      return paletteAt(randomSeed());
    },
    async generate({ prompt, temperature = 1, palette = null, seed = randomSeed() }, onEvent) {
      await ready;
      const chosen = palette ?? await paletteAt(seed);
      const id = nextRequest++;
      onEvent({ type: 'start', prompt, seed, palette: chosen, transparent_index: 0 });
      return new Promise((resolve, reject) => {
        pending.set(id, message => {
          try {
            if (message.type === 'progress') onEvent({ type: 'progress', step: message.step, tokens: message.tokens });
            else if (message.type === 'done') {
              pending.delete(id);
              onEvent({ type: 'done', prompt, english_prompt: message.english, seed, palette: chosen, tokens: message.tokens, ms: message.ms });
              resolve();
            } else if (message.type === 'error') {
              pending.delete(id);
              reject(new Error(message.message));
            }
          } catch (error) {
            pending.delete(id);
            reject(error);
          }
        });
        worker.postMessage({ type: 'generate', id, prompt, palette: chosen, temperature, seed });
      });
    }
  };
})();
