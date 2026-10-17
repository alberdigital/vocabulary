export type Direction = 'AB' | 'BA';
export type AnswerMode = 'typed' | 'self';
export type InputMode = 'keyboard' | 'handwriting';

export interface SessionOptions {
  direction: Direction;
  answerMode: AnswerMode;
  inputMode: InputMode;
}

export interface User {
  id: number;
  name: string;
  createdAt: string;
}

export interface UserPrefs {
  session?: SessionOptions;
  /** Mostrar el cuestionario de la palabra durante la práctica de una caja (por defecto sí). */
  leitnerShowQuiz?: boolean;
}

export interface Folder {
  id: number;
  name: string;
  parentId: number | null;
}

export interface QuizSummary {
  id: number;
  folderId: number | null;
  name: string;
  langA: string;
  langB: string;
  pairCount: number;
  updatedAt: string;
}

export interface Pair {
  /** null para pares nuevos que aún no se han guardado. */
  id: number | null;
  a: string;
  b: string;
}

export interface Quiz extends Omit<QuizSummary, 'pairCount'> {
  pairs: Pair[];
}

export interface SessionRecord {
  id: number;
  userId: number;
  quizId: number | null;
  quizName: string;
  direction: Direction;
  answerMode: AnswerMode;
  inputMode: InputMode | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  pairCount: number;
  rounds: number;
  firstRoundErrors: number;
  totalErrors: number;
}

export interface AnswerRecord {
  pairId: number | null;
  round: number;
  prompt: string;
  expected: string;
  given: string | null;
  correct: boolean;
  overridden: boolean;
  elapsedMs: number;
}

export interface QuizStats {
  sessions: number;
  bestMs: number | null;
  lastFirstRoundErrors: number | null;
}

// ---------- Cajas de Leitner ----------

export interface LeitnerBox extends SessionOptions {
  id: number;
  userId: number;
  name: string;
  /** Capacidad del 1.er compartimento; el resto se calcula (ver leitner/core.ts). */
  firstCapacity: number;
  createdAt: string;
  updatedAt: string;
}

/** Palabra dentro de una caja, con lo necesario para preguntarla. */
export interface LeitnerCard {
  pairId: number;
  /** 0 = pendiente, 1–5 = compartimentos, 6 = aprendida. */
  compartment: number;
  /** Antigüedad dentro de la caja (menor = más antigua); cambia cada vez que la palabra se mueve. */
  seq: number;
  a: string;
  b: string;
  quizId: number;
  quizName: string;
  langA: string;
  langB: string;
}

export interface BoxSelection {
  quizIds: number[];
  excludedPairIds: number[];
}

/** Una práctica de una caja: desde que se empieza hasta la última respuesta. */
export interface LeitnerPracticeRecord {
  id: number;
  userId: number;
  boxId: number | null;
  boxName: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  correct: number;
  errors: number;
}
