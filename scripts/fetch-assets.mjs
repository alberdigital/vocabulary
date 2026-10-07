// Descarga el modelo de escritura a mano a static/models, para que la aplicación funcione sin conexión.
// Si los ficheros ya existen, no hace nada.

import { mkdir, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MODEL = 'Xenova/trocr-small-handwritten';
// Versión fija del repositorio del modelo (commit de Hugging Face), para descargar siempre los mismos ficheros.
const REVISION = '2432e24d184b1d964d07ed04f5d9e21d31a59141';
const MODEL_FILES = [
  'config.json',
  'generation_config.json',
  'preprocessor_config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'special_tokens_map.json',
  'onnx/encoder_model_quantized.onnx',
  'onnx/decoder_model_merged_quantized.onnx',
];

async function exists(p) {
  try {
    return (await stat(p)).size > 0;
  } catch {
    return false;
  }
}

for (const f of MODEL_FILES) {
  const dest = join(root, 'static/models', MODEL, f);
  if (await exists(dest)) continue;
  await mkdir(dirname(dest), { recursive: true });
  const url = `https://huggingface.co/${MODEL}/resolve/${REVISION}/${f}`;
  process.stdout.write(`Descargando ${f}… `);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  // Se escribe a un temporal y se renombra, para no dejar ficheros a medias.
  await writeFile(`${dest}.part`, buf);
  await rename(`${dest}.part`, dest);
  console.log(`${(buf.length / 1e6).toFixed(1)} MB`);
}

console.log('Modelo de escritura a mano listo en static/models.');
