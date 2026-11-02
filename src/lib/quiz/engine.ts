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
  /** Preguntas de la ronda actual; null si la práctica no tiene un número fijo de preguntas. */
  readonly roundSize: number | null;
  readonly roundDone: number;
  readonly totalErrors: number;
  readonly answers: readonly { correct: boolean }[];
  /** Palabras de la práctica y aciertos, para la barra; sin definir si no se muestran. */
  readonly total?: number;
  readonly totalCorrect?: number;
  answer(correct: boolean, given?: string | null, elapsedMs?: number): void;
  overrideLastAsCorrect(): void;
  /** Cambia la última respuesta desde la pregunta siguiente; sin definir si el motor no lo permite. */
  flipLast?(): void;
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
  /** Palabras del cuestionario: cada una se acierta una vez para terminar. */
  readonly total: number;

  constructor(items: T[], private shuffle: Shuffle = fisherYates) {
    this.queue = shuffle(items);
    this.roundSize = this.queue.length;
    this.total = items.length;
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

  /**
   * Cambia la última respuesta de acierto a fallo o al revés («La anterior acerté / me equivoqué»),
   * aunque ya se esté preguntando la siguiente. Solo es válido antes de la siguiente respuesta;
   * cambiarla dos veces la deja como estaba.
   */
  flipLast(): void {
    const last = this.answers[this.answers.length - 1];
    if (!last) return;
    const overridden = !last.overridden;
    if (last.correct) this.markLastAsWrong(last);
    else this.overrideLastAsCorrect();
    last.overridden = overridden;
  }

  private markLastAsWrong(last: EngineAnswer<T>): void {
    last.correct = false;
    if (this.round !== last.round) {
      // Era la última de su ronda y ya ha empezado la siguiente: se pregunta al final de esta.
      this.queue.push(last.item);
      this.roundSize++;
    } else if (this.queue.length > 0) {
      this.failedThisRound.push(last.item);
    } else {
      // Era la última de todas: hace falta una ronda nueva solo con ella.
      this.round++;
      this.queue = [last.item];
      this.roundSize = 1;
      this.roundDone = 0;
    }
  }

  get firstRoundErrors(): number {
    return this.answers.filter((a) => a.round === 1 && !a.correct).length;
  }

  get totalErrors(): number {
    return this.answers.filter((a) => !a.correct).length;
  }

  get totalCorrect(): number {
    return this.answers.filter((a) => a.correct).length;
  }
}
