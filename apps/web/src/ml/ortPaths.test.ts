import { describe, expect, it } from 'vitest';
import { ortWasmPaths } from './ortPaths';

const WASM = '/models/ort/ort-wasm-simd-threaded.wasm';

describe('ortWasmPaths: the executable glue is never a /models/ file', () => {
  it('uses the app build asset for the CPU glue', () => {
    expect(ortWasmPaths({ gpu: false, wasmUrl: WASM, glueUrl: '/assets/ort-wasm-simd-threaded-BQJNh0bu.mjs' })).toEqual({
      mjs: '/assets/ort-wasm-simd-threaded-BQJNh0bu.mjs',
      wasm: WASM,
    });
  });
  it('refuses a glue URL under /models/ (a file the host can swap), another origin, and protocol-relative URLs', () => {
    for (const glueUrl of [
      '/models/ort/ort-wasm-simd-threaded.mjs',
      '/models/../models/ort/x.mjs',
      'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs',
      '//evil.test/assets/x.mjs',
      '/somewhere/else.mjs',
    ])
      expect(() => ortWasmPaths({ gpu: false, wasmUrl: WASM, glueUrl }), glueUrl).toThrow(/build asset/);
  });
  it('the WebGPU build has no separate glue URL at all', () => {
    expect(ortWasmPaths({ gpu: true, wasmUrl: WASM, glueUrl: '/models/ort/ort-wasm-simd-threaded.mjs' })).toEqual({ wasm: WASM });
  });
});
