// Motor de una sesión: baraja, pregunta, y repite las falladas al final en nuevas rondas.
// Lógica pura, sin interfaz ni base de datos.

export interface EngineAnswer<T> {
  item: T;
  round: number;
  correct: boolean;
  given: string | null;
  overridden: boolean;
  elapsedMs: number;
}

export type Shuffle = <U>(items: U[]) => U[];

export const fisherYates: Shuffle = <U>(items: U[]): U[] => {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/** Lo que necesita la pantalla de práctica de un motor (cuestionarios o cajas de Leitner). */
export interface PracticeEngine<T> {
  readonly current: T | undefined;
  readonly finished: boolean;
  readonly round: number;
  readonly roundSize: number;
  readonly roundDone: number;
  readonly totalErrors: number;
  answer(correct: boolean, given?: string | null, elapsedMs?: number): void;
  overrideLastAsCorrect(): void;
}

export class QuizEngine<T> implements PracticeEngine<T> {
  round = 1;
  queue: T[];
  failedThisRound: T[] = [];
  answers: EngineAnswer<T>[] = [];
  /** Número de preguntas de la ronda actual (para mostrar el progreso). */
  roundSize: number;
  /** Cuántas se han contestado en la ronda actual. */
  roundDone = 0;

  constructor(items: T[], private shuffle: Shuffle = fisherYates) {
    this.queue = shuffle(items);
    this.roundSize = this.queue.length;
  }

  get current(): T | undefined {
    return this.queue[0];
  }

  get finished(): boolean {
    return this.queue.length === 0;
  }

  answer(correct: boolean, given: string | null = null, elapsedMs = 0, overridden = false): void {
    const item = this.queue.shift();
    if (item === undefined) throw new Error('La sesión ya ha terminado');
    this.answers.push({ item, round: this.round, correct, given, overridden, elapsedMs });
    if (!correct) this.failedThisRound.push(item);
    this.roundDone++;
    if (this.queue.length === 0 && this.failedThisRound.length > 0) {
      this.round++;
      this.queue = this.shuffle(this.failedThisRound);
      this.failedThisRound = [];
      this.roundSize = this.queue.length;
      this.roundDone = 0;
    }
  }

  /**
   * Corrige la última respuesta como acierto ("la IA se equivocó").
   * Solo es válido justo después de un fallo y antes de la siguiente respuesta.
   */
  overrideLastAsCorrect(): void {
    const last = this.answers[this.answers.length - 1];
    if (!last || last.correct) return;
    last.correct = true;
    last.overridden = true;
    // El fallo está en failedThisRound, o ya ha pasado a la cola de la ronda nueva.
    const idx = this.failedThisRound.lastIndexOf(last.item);
    if (idx >= 0) {
      this.failedThisRound.splice(idx, 1);
    } else if (this.round === last.round + 1) {
      const q = this.queue.indexOf(last.item);
      if (q >= 0) this.queue.splice(q, 1);
      this.roundSize--;
      if (this.queue.length === 0) {
        // No quedaba nada más: la ronda nueva no llega a existir.
        this.round--;
        this.roundSize = 0;
      }
    }
  }

  get firstRoundErrors(): number {
    return this.answers.filter((a) => a.round === 1 && !a.correct).length;
  }

  get totalErrors(): number {
    return this.answers.filter((a) => !a.correct).length;
  }
}
