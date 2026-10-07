// Prueba manual del reconocimiento con imágenes de palabras (ficheros <fuente>_<palabra>.png):
//   HW_IMAGES=<carpeta> npx vitest run tests-manual --silent=false --reporter=verbose
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { env, RawImage } from '@huggingface/transformers';
import { expect, it } from 'vitest';
import { check, loadModel } from '../src/lib/handwriting/core';

env.allowRemoteModels = false;
env.localModelPath = join(__dirname, '../static/models/');

it.skipIf(!process.env.HW_IMAGES)('reconoce imágenes de prueba', async () => {
  const dir = process.env.HW_IMAGES!;
  const m = await loadModel('cpu');
  const wrong: Record<string, string> = { house: 'horse', perro: 'pera', orilla: 'arena', window: 'widow', 'árbol': 'arco', 'niño': 'nido', cat: 'cut' };
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.png')).sort()) {
    const word = f.replace(/^[^_]+_/, '').replace('.png', '');
    const img = await RawImage.read(join(dir, f));
    const t0 = performance.now();
    const ok = await check(m, img, word);
    const bad = await check(m, img, wrong[word]);
    console.log(f.padEnd(20), JSON.stringify(ok), '| contra', wrong[word], JSON.stringify(bad), `${Math.round(performance.now() - t0)}ms`);
  }
  expect(true).toBe(true);
}, 300_000);
