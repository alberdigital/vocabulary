// Reconocimiento de escritura a mano con TrOCR (Transformers.js).
// No depende del navegador: lo usa el Web Worker de la aplicación y también se puede probar con Node.

import {
  AutoProcessor,
  AutoTokenizer,
  RawImage,
  Tensor,
  VisionEncoderDecoderModel,
  type PreTrainedModel,
  type PreTrainedTokenizer,
  type Processor,
} from '@huggingface/transformers';
import { normalizeLoose, parse } from '../quiz/answer';

export const MODEL_ID = 'Xenova/trocr-small-handwritten';

/** Cuánto peor (en log-probabilidad media por token) puede puntuar la respuesta esperada que la lectura libre. */
export const MARGIN = 1.0;
/** Puntuación mínima de la respuesta esperada para darla por buena. */
export const MIN_SCORE = -1.5;

export interface HwModel {
  model: PreTrainedModel;
  tokenizer: PreTrainedTokenizer;
  processor: Processor;
}

export interface HwResult {
  correct: boolean;
  recognized: string;
  /** Puntuaciones, para el panel de depuración. Ausentes si la lectura libre ya coincidía. */
  scores?: { expected: number; recognized: number };
}

export async function loadModel(device: 'wasm' | 'cpu' = 'wasm'): Promise<HwModel> {
  const [model, tokenizer, processor] = await Promise.all([
    VisionEncoderDecoderModel.from_pretrained(MODEL_ID, { dtype: 'q8', device }) as Promise<PreTrainedModel>,
    AutoTokenizer.from_pretrained(MODEL_ID),
    AutoProcessor.from_pretrained(MODEL_ID),
  ]);
  return { model, tokenizer, processor };
}

async function pixelValues(m: HwModel, image: RawImage): Promise<Tensor> {
  const { pixel_values } = await m.processor(image);
  return pixel_values as Tensor;
}

/** Entrada para el modelo: la imagen y, si se ha podido calcular, la salida del codificador ya hecha. */
interface Encoded {
  pixel_values: Tensor;
  encoder_outputs?: Tensor;
}

/**
 * Ejecuta el codificador de imagen una sola vez para reutilizarlo en la lectura y en las puntuaciones.
 * Usa un método interno de Transformers.js; si no existe o falla, cada paso recalcula el codificador.
 */
async function encode(m: HwModel, pixel_values: Tensor): Promise<Encoded> {
  const model = m.model as unknown as {
    _prepare_encoder_decoder_kwargs_for_generation?: (args: object) => Promise<{ encoder_outputs?: Tensor }>;
    generation_config: unknown;
  };
  try {
    const r = await model._prepare_encoder_decoder_kwargs_for_generation?.({
      inputs_tensor: pixel_values,
      model_inputs: { pixel_values },
      model_input_name: 'pixel_values',
      generation_config: model.generation_config,
    });
    if (r?.encoder_outputs) return { pixel_values, encoder_outputs: r.encoder_outputs };
  } catch {
    // Se sigue sin reutilizar el codificador.
  }
  return { pixel_values };
}

/** Lectura libre (greedy). */
async function read(m: HwModel, enc: Encoded): Promise<string> {
  const output = (await m.model.generate({
    inputs: enc.pixel_values,
    ...(enc.encoder_outputs ? { encoder_outputs: enc.encoder_outputs } : {}),
    max_new_tokens: 40,
  } as never)) as Tensor;
  const [text] = m.tokenizer.batch_decode(output, { skip_special_tokens: true });
  return text.trim();
}

/**
 * Log-probabilidad media por token de que la imagen diga exactamente `text`
 * (teacher forcing: se le da al decodificador la secuencia y se mira qué probabilidad asigna a cada token).
 */
async function score(m: HwModel, enc: Encoded, text: string): Promise<number> {
  // El modelo genera [decoder_start, tokens…, eos] (sin <s>), así que se puntúa igual.
  const gen = (m.model as unknown as { generation_config?: { decoder_start_token_id?: number; eos_token_id?: number } })
    .generation_config;
  const startId = Number(gen?.decoder_start_token_id ?? 2);
  const eosId = Number(gen?.eos_token_id ?? 2);
  const tokens = Array.from(m.tokenizer.encode(text, { add_special_tokens: false }), Number);
  const input = [startId, ...tokens];
  const target = [...tokens, eosId];
  const decoder_input_ids = new Tensor('int64', BigInt64Array.from(input.map(BigInt)), [1, input.length]);
  const { logits } = (await m.model({ ...enc, decoder_input_ids })) as { logits: Tensor };
  const [, steps, vocab] = logits.dims;
  const data = logits.data as Float32Array;
  let total = 0;
  let count = 0;
  for (let t = 0; t < steps; t++) {
    const row = data.subarray(t * vocab, (t + 1) * vocab);
    let max = -Infinity;
    for (let i = 0; i < vocab; i++) if (row[i] > max) max = row[i];
    let sum = 0;
    for (let i = 0; i < vocab; i++) sum += Math.exp(row[i] - max);
    total += row[target[t]] - max - Math.log(sum);
    count++;
  }
  return count > 0 ? total / count : -Infinity;
}

function capitalize(s: string): string {
  return s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s;
}

/**
 * ¿Lo escrito en la imagen es la respuesta esperada? No se comprueban tildes ni ñ/n.
 * Primero se lee libremente; si no coincide, se compara la verosimilitud de la respuesta esperada
 * con la de lo leído (el modelo a menudo duda entre letras parecidas).
 */
export async function check(m: HwModel, image: RawImage, expectedText: string): Promise<HwResult> {
  const enc = await encode(m, await pixelValues(m, image));
  const recognized = await read(m, enc);
  const expected = normalizeLoose(expectedText);
  if (normalizeLoose(recognized) === expected) return { correct: true, recognized };
  if (recognized === '') return { correct: false, recognized, scores: { expected: -Infinity, recognized: -Infinity } };

  const recognizedScore = await score(m, enc, recognized);
  let expectedScore = -Infinity;
  // Se prueba la forma original (con tildes y ñ) y la normalizada, en minúscula y con mayúscula inicial.
  const original = parse(expectedText).core;
  for (const variant of new Set([original, capitalize(original), expected, capitalize(expected)])) {
    expectedScore = Math.max(expectedScore, await score(m, enc, variant));
  }
  const correct = expectedScore >= recognizedScore - MARGIN && expectedScore >= MIN_SCORE;
  return { correct, recognized, scores: { expected: expectedScore, recognized: recognizedScore } };
}
