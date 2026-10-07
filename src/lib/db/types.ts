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
