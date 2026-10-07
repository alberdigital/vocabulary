import { defaultClientConditions, defineConfig } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";
import process from "node:process";
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
/**
 * Aislamiento entre orígenes en desarrollo (en la app lo dan las cabeceras de tauri.conf.json):
 * permite SharedArrayBuffer y que ONNX Runtime use varios hilos.
 * Se usa un middleware porque SvelteKit sirve las páginas sin pasar por `server.headers`.
 * @type {import("vite").Plugin}
 */
const crossOriginIsolation = {
  name: "cross-origin-isolation",
  configureServer(server) {
    server.middlewares.use((_req, res, next) => {
      res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
      res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
      next();
    });
  },
};

export default defineConfig(() => ({
  plugins: [crossOriginIsolation, sveltekit()],

  // El reconocimiento de escritura corre en un Web Worker de tipo módulo.
  worker: { format: /** @type {const} */ ("es") },
  // onnxruntime-web: se usa la versión que no lleva incrustado su WebAssembly, porque el worker
  // le indica cuál cargar (la variante normal; la «asyncify» se cuelga en WebKitGTK).
  resolve: { conditions: ["onnxruntime-web-use-extern-wasm", ...defaultClientConditions] },
  optimizeDeps: { exclude: ["@huggingface/transformers", "onnxruntime-web"] },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || "127.0.0.1",
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
