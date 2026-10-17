// Reglas de las cajas de Leitner. Lógica pura, sin interfaz ni base de datos: la base de datos
// solo guarda el estado que resulta de aplicar estas reglas.
//
// Hay 5 compartimentos con capacidades en la proporción clásica 1:2:5:8:14. Las palabras
// nuevas esperan en «pendientes» (0) y entran en el 1.º mientras quepan. Un acierto sube la
// palabra un compartimento (desde el 5.º sale como aprendida, 6); un fallo la devuelve al 1.º.
// No hay sesiones: tras cada respuesta se elige la siguiente palabra (ver pickNext).

import type { EngineAnswer, PracticeEngine } from '../quiz/engine';

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

/** Estado de una palabra en la caja: lo único que se guarda. */
export interface CardRef {
  pairId: number;
  compartment: number;
  /** Antigüedad dentro de la caja: menor = más antigua. Al moverse, la palabra pasa a ser la más reciente. */
  seq: number;
}

const maxSeq = (cards: CardRef[]) => cards.reduce((m, c) => Math.max(m, c.seq), 0);

function oldest<T extends CardRef>(cards: T[], compartment: number): T | null {
  let best: T | null = null;
  for (const c of cards) if (c.compartment === compartment && (best === null || c.seq < best.seq)) best = c;
  return best;
}

/**
 * Palabra que se pregunta ahora: la más antigua del compartimento más alto (del 5.º al 2.º) que
 * haya alcanzado su capacidad; si ninguno, la más antigua del 1.º, esté lleno o no. null si no
 * hay nada que preguntar (1.º vacío y ninguno lleno).
 */
export function pickNext<T extends CardRef>(cards: T[], first: number): T | null {
  const caps = capacities(first);
  const counts = countByCompartment(cards);
  for (let k = COMPARTMENTS; k >= 2; k--) if (counts[k] > 0 && counts[k] >= caps[k - 1]) return oldest(cards, k);
  return oldest(cards, 1);
}

/**
 * Pasa al 1.er compartimento las pendientes más antiguas que quepan; entran como las más recientes
 * del 1.º. Modifica las cartas y devuelve las que ha movido.
 */
export function refill<T extends CardRef>(cards: T[], first: number): T[] {
  const counts = countByCompartment(cards);
  const n = refillCount(counts[1], counts[PENDING], first);
  if (n === 0) return [];
  const moved = cards
    .filter((c) => c.compartment === PENDING)
    .sort((x, y) => x.seq - y.seq)
    .slice(0, n);
  let seq = maxSeq(cards);
  for (const c of moved) {
    c.compartment = 1;
    c.seq = ++seq;
  }
  return moved;
}

export interface LeitnerAnswer<T> extends EngineAnswer<T> {
  /** Compartimento en el que estaba la palabra al preguntarla. */
  from: number;
}

/**
 * Práctica de una caja: modelo en memoria de todas sus palabras. Tras cada respuesta mueve la
 * palabra y rellena el 1.º; la siguiente se elige al pedirla (current), así que una corrección
 * («La IA se equivocó») hecha antes de pasar de pregunta ya cuenta. No tiene fin fijo.
 */
export class LeitnerEngine<T extends CardRef> implements PracticeEngine<T> {
  readonly round = 1;
  readonly roundSize = null;
  answers: LeitnerAnswer<T>[] = [];
  private cards: T[];
  private changed = new Map<number, T>();

  /** Copia las cartas: el motor es dueño de su estado. */
  constructor(
    cards: T[],
    private first: number
  ) {
    this.cards = cards.map((c) => ({ ...c }));
  }

  get current(): T | undefined {
    return pickNext(this.cards, this.first) ?? undefined;
  }

  get finished(): boolean {
    return this.current === undefined;
  }

  get roundDone(): number {
    return this.answers.length;
  }

  answer(correct: boolean, given: string | null = null, elapsedMs = 0): void {
    const item = this.current;
    if (item === undefined) throw new Error('No hay nada que preguntar');
    const from = item.compartment;
    this.answers.push({ item, round: 1, correct, given, overridden: false, elapsedMs, from });
    this.place(item, nextCompartment(from, correct));
  }

  /** Corrige como acierto el último fallo: la palabra va adonde habría ido si se hubiera acertado. */
  overrideLastAsCorrect(): void {
    const last = this.answers[this.answers.length - 1];
    if (!last || last.correct) return;
    last.correct = true;
    last.overridden = true;
    if (this.cards.includes(last.item)) this.place(last.item, nextCompartment(last.from, true));
  }

  /** Saca la palabra de la caja (aunque ya se haya respondido) y rellena el 1.º. */
  removeCard(pairId: number): void {
    const i = this.cards.findIndex((c) => c.pairId === pairId);
    if (i < 0) return;
    this.cards.splice(i, 1);
    this.changed.delete(pairId);
    this.track(refill(this.cards, this.first));
  }

  /** Cartas cambiadas desde la última llamada, para guardarlas. */
  takeChanges(): CardRef[] {
    const out = [...this.changed.values()].map(({ pairId, compartment, seq }) => ({ pairId, compartment, seq }));
    this.changed.clear();
    return out;
  }

  counts(): number[] {
    return countByCompartment(this.cards);
  }

  get correctCount(): number {
    return this.answers.filter((a) => a.correct).length;
  }

  get totalErrors(): number {
    return this.answers.filter((a) => !a.correct).length;
  }

  private place(card: T, compartment: number): void {
    card.compartment = compartment;
    card.seq = maxSeq(this.cards) + 1;
    this.track([card, ...refill(this.cards, this.first)]);
  }

  private track(cards: T[]): void {
    for (const c of cards) this.changed.set(c.pairId, c);
  }
}
