// Bundles the in-browser engine (transformers.js + onnxruntime-web share one runtime) and copies the
// WebAssembly files it loads. Run with: npm run bundle
import { build } from 'esbuild';
import { copyFileSync, readdirSync } from 'node:fs';

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
