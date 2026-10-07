// Interfaz con el Web Worker de reconocimiento, basada en promesas.

import type { WorkerRequest, WorkerResponse } from './worker';

export interface CheckResult {
  correct: boolean;
  recognized: string;
  scores?: { expected: number; recognized: number };
}

let worker: Worker | null = null;
let readyPromise: Promise<void> | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (r: CheckResult) => void; reject: (e: Error) => void }>();
let readyHandlers: { resolve: () => void; reject: (e: Error) => void } | null = null;

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  // Si el worker falla al cargar o lanza un error sin capturar, se rechaza todo lo pendiente
  // (si no, la interfaz se quedaría esperando para siempre).
  worker.onerror = (e) => {
    e.preventDefault();
    failAll(new Error(e.message || 'El reconocimiento de escritura ha fallado'));
    worker?.terminate();
    worker = null;
  };
  worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
    const msg = e.data;
    if (msg.type === 'ready') {
      readyHandlers?.resolve();
      readyHandlers = null;
    } else if (msg.type === 'result') {
      pending.get(msg.id)?.resolve(msg);
      pending.delete(msg.id);
    } else if (msg.type === 'error') {
      const err = new Error(msg.message);
      if (msg.id !== undefined) {
        pending.get(msg.id)?.reject(err);
        pending.delete(msg.id);
      } else {
        readyHandlers?.reject(err);
        readyHandlers = null;
        readyPromise = null;
      }
    }
  };
  return worker;
}

function failAll(err: Error) {
  for (const p of pending.values()) p.reject(err);
  pending.clear();
  readyHandlers?.reject(err);
  readyHandlers = null;
  readyPromise = null;
}

/** Carga el modelo en segundo plano (tarda unos segundos la primera vez). */
export function warmUp(): Promise<void> {
  readyPromise ??= new Promise<void>((resolve, reject) => {
    readyHandlers = { resolve, reject };
    getWorker().postMessage({ type: 'warmup' } satisfies WorkerRequest);
  });
  return readyPromise;
}

export function check(image: ImageData, expected: string): Promise<CheckResult> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    // Se copia el buffer para poder transferirlo sin invalidar el ImageData original.
    const data = new Uint8ClampedArray(image.data);
    getWorker().postMessage(
      { type: 'check', id, width: image.width, height: image.height, data, expected } satisfies WorkerRequest,
      [data.buffer]
    );
  });
}
