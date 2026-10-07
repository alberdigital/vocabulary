// Web Worker: carga el modelo una vez y atiende peticiones de reconocimiento sin bloquear la interfaz.

import { env, RawImage } from '@huggingface/transformers';
// Variante normal (no «asyncify»): WebKitGTK se queda colgado compilando la asyncify.
import ortMjs from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url';
import ortWasm from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import { check, loadModel, type HwModel } from './core';

// Todo es local: el modelo va en static/models y los binarios de ONNX Runtime los empaqueta Vite.
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = '/models/';
env.useBrowserCache = false;
env.useWasmCache = false;
const onnx = env.backends.onnx;
if (onnx.wasm) {
  onnx.wasm.wasmPaths = { mjs: ortMjs, wasm: ortWasm };
  // Varios hilos solo si hay SharedArrayBuffer. No basta con crossOriginIsolated:
  // WebKitGTK lo declara pero no ofrece SharedArrayBuffer, y ONNX Runtime se bloquea.
  const canThread = self.crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined';
  onnx.wasm.numThreads = canThread ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
}

export type WorkerRequest =
  | { type: 'warmup' }
  | { type: 'check'; id: number; width: number; height: number; data: Uint8ClampedArray; expected: string };

export type WorkerResponse =
  | { type: 'ready' }
  | { type: 'error'; id?: number; message: string }
  | { type: 'result'; id: number; correct: boolean; recognized: string; scores?: { expected: number; recognized: number } };

let modelPromise: Promise<HwModel> | null = null;

function model(): Promise<HwModel> {
  modelPromise ??= loadModel('wasm').then(async (m) => {
    // Una primera inferencia en blanco: la primera de verdad tardaría mucho más (arranque de hilos, etc.).
    await check(m, new RawImage(new Uint8ClampedArray(64 * 32 * 4).fill(255), 64, 32, 4), 'a');
    return m;
  });
  return modelPromise;
}

const post = (msg: WorkerResponse) => (self as unknown as Worker).postMessage(msg);

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  try {
    if (req.type === 'warmup') {
      await model();
      post({ type: 'ready' });
    } else {
      const m = await model();
      const image = new RawImage(req.data, req.width, req.height, 4);
      const r = await check(m, image, req.expected);
      post({ type: 'result', id: req.id, ...r });
    }
  } catch (err) {
    if (req.type === 'warmup') modelPromise = null;
    post({ type: 'error', id: req.type === 'check' ? req.id : undefined, message: String(err) });
  }
};
