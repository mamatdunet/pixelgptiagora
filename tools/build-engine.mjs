// Bundles the in-browser engine (transformers.js + onnxruntime-web share one runtime) and copies the
// WebAssembly files it loads. Run with: npm run bundle
import { build } from 'esbuild';
import { copyFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';

await build({
  entryPoints: ['src/engine-worker.js'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  outfile: 'static/engine/worker.js',
  logLevel: 'info'
});
const dist = 'node_modules/onnxruntime-web/dist/';
for (const file of readdirSync(dist).filter(name => /^ort-wasm-simd-threaded.*\.(wasm|mjs)$/.test(name))) {
  copyFileSync(dist + file, 'static/engine/' + file);
}

// Exact model sizes, so the download progress shows the real total from the start.
const MODEL_FILES = [
  'models/pixelgpt/condition.onnx', 'models/pixelgpt/step.onnx', 'models/pixelgpt/step_gpu.onnx',
  'models/Xenova/all-MiniLM-L6-v2/onnx/model_quantized.onnx',
  'models/Xenova/opus-mt-fr-en/onnx/encoder_model_uint8.onnx', 'models/Xenova/opus-mt-fr-en/onnx/decoder_model_merged_uint8.onnx',
  'models/onnx-community/Florence-2-base-ft/onnx/vision_encoder_q4.onnx',
  'models/onnx-community/Florence-2-base-ft/onnx/embed_tokens_quantized.onnx',
  'models/onnx-community/Florence-2-base-ft/onnx/encoder_model_q4.onnx',
  'models/onnx-community/Florence-2-base-ft/onnx/decoder_model_merged_q4.onnx'
];
writeFileSync('static/engine/manifest.json', JSON.stringify(Object.fromEntries(MODEL_FILES.map(file => ['/' + file, statSync(file).size])), null, 1));
