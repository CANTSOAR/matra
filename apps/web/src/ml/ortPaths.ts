/**
 * Where ONNX Runtime finds its wasm and JS glue (`env.wasm.wasmPaths`).
 *
 * The glue is executable code that ORT import()s by URL and starts its pthread workers from, so the bytes that run are
 * whatever that URL serves at that moment; the browser cannot check them (no blob: in the CSP). It is therefore never a
 * /models/ URL: it is the app's own content-hashed build asset (see manifest.json, runtime.bundled). This function refuses
 * to build a path to it under the files the host serves from /models/, so a swapped /models/ort/*.mjs is never executed.
 */
import { MODELS_BASE } from './manifest';

export function ortWasmPaths(o: { gpu: boolean; wasmUrl: string; glueUrl: string }): { wasm: string; mjs?: string } {
  if (o.gpu) return { wasm: o.wasmUrl }; // the WebGPU build's glue is inside the bundled ORT code
  const glue = new URL(o.glueUrl, 'http://localhost');
  if (glue.origin !== 'http://localhost' || glue.pathname.startsWith(MODELS_BASE) || !/^\/(?:assets|@fs|node_modules)\//.test(glue.pathname))
    throw new Error(`the ONNX Runtime glue must be a build asset of this app, not ${o.glueUrl}`);
  return { mjs: o.glueUrl, wasm: o.wasmUrl };
}
