// Reglas de las cajas de Leitner. Lógica pura, sin interfaz ni base de datos.
//
// Hay 5 compartimentos con capacidades en la proporción clásica 1:2:5:8:14. Las palabras
// nuevas esperan en «pendientes» (0) y entran en el 1.º mientras quepan. Un acierto sube la
// palabra un compartimento (desde el 5.º sale como aprendida, 6); un fallo la devuelve al 1.º.

import { fisherYates, type EngineAnswer, type PracticeEngine, type Shuffle } from '../quiz/engine';

export const PENDING = 0;
export const LEARNED = 6;
export const COMPARTMENTS = 5;
export const RATIOS = [1, 2, 5, 8, 14];
export const SUGGESTED_FIRST_CAPACITY = 20;

/** Capacidad de cada compartimento (índice 0 = compartimento 1). */
export function capacities(first: number): number[] {
  return RATIOS.map((r) => r * first);
}

export function nextCompartment(from: number, correct: boolean): number {
  return correct ? Math.min(from + 1, LEARNED) : 1;
}

/** Número de palabras por compartimento: [pendientes, c1…c5, aprendidas]. */
export function countByCompartment(cards: { compartment: number }[]): number[] {
  const counts = new Array(LEARNED + 1).fill(0);
  for (const c of cards) counts[c.compartment]++;
  return counts;
}

/** Cuántas pendientes caben ahora en el 1.er compartimento. */
export function refillCount(inFirst: number, pending: number, first: number): number {
  return Math.max(0, Math.min(pending, first - inFirst));
}

export interface CardRef {
  compartment: number;
  /** Antigüedad dentro del compartimento: menor = más antigua. */
  order: number;
}

/**
 * Palabras que se preguntan en una sesión, en el orden en que se preguntarán.
 * Se repasan los compartimentos llenos del 5.º al 1.º: del 1.º, todas; de los demás, las más
 * antiguas, tantas como sobran más un lote del tamaño del 1.º. Si no hay ninguno lleno, el 1.º
 * entero o, si está vacío, un lote del compartimento más lleno en proporción.
 */
export function pickSession<T extends CardRef>(cards: T[], first: number, shuffle: Shuffle = fisherYates): T[] {
  const caps = capacities(first);
  const by: T[][] = [];
  for (let k = 1; k <= COMPARTMENTS; k++)
    by[k] = cards.filter((c) => c.compartment === k).sort((x, y) => x.order - y.order);

  const take = (k: number) => {
    const n = by[k].length;
    return k === 1 ? by[1] : by[k].slice(0, Math.min(n, n - caps[k - 1] + first));
  };

  const groups: T[][] = [];
  for (let k = COMPARTMENTS; k >= 1; k--) if (by[k].length > 0 && by[k].length >= caps[k - 1]) groups.push(take(k));

  if (groups.length === 0) {
    if (by[1].length > 0) groups.push(by[1]);
    else {
      let best = 0;
      for (let k = 2; k <= COMPARTMENTS; k++)
        if (by[k].length > 0 && (best === 0 || by[k].length / caps[k - 1] > by[best].length / caps[best - 1])) best = k;
      if (best > 0) groups.push(by[best].slice(0, first));
    }
  }
  return groups.flatMap((g) => shuffle(g));
}

/** Sesión de una caja: una sola pasada, sin repetir las falladas. */
export class LeitnerEngine<T> implements PracticeEngine<T> {
  readonly round = 1;
  queue: T[];
  answers: EngineAnswer<T>[] = [];
  roundSize: number;
  roundDone = 0;

  constructor(items: T[]) {
    this.queue = items.slice();
    this.roundSize = this.queue.length;
  }

  get current(): T | undefined {
    return this.queue[0];
  }

  get finished(): boolean {
    return this.queue.length === 0;
  }

  answer(correct: boolean, given: string | null = null, elapsedMs = 0): void {
    const item = this.queue.shift();
    if (item === undefined) throw new Error('La sesión ya ha terminado');
    this.answers.push({ item, round: 1, correct, given, overridden: false, elapsedMs });
    this.roundDone++;
  }

  /** Quita la palabra actual sin registrar respuesta (se ha sacado de la caja). */
  skip(): void {
    if (this.queue.shift() !== undefined) this.roundSize--;
  }

  overrideLastAsCorrect(): void {
    const last = this.answers[this.answers.length - 1];
    if (!last || last.correct) return;
    last.correct = true;
    last.overridden = true;
  }

  get correctCount(): number {
    return this.answers.filter((a) => a.correct).length;
  }

  get totalErrors(): number {
    return this.answers.filter((a) => !a.correct).length;
  }
}
