// Todo el acceso a la base de datos pasa por aquí.
// El plugin SQL usa un pool de conexiones, así que no se usan transacciones:
// las escrituras de varias filas se hacen con un único INSERT de varias filas.

import { db } from './client';
import type {
  AnswerRecord,
  Folder,
  Quiz,
  QuizStats,
  QuizSummary,
  SessionRecord,
  User,
  UserPrefs,
} from './types';

const now = () => new Date().toISOString();

/** Genera "($1,$2,$3),($4,$5,$6)" para un INSERT de varias filas. */
function valuesPlaceholders(rows: number, cols: number, offset = 0): string {
  const out: string[] = [];
  for (let r = 0; r < rows; r++) {
    const ps: string[] = [];
    for (let c = 1; c <= cols; c++) ps.push(`$${offset + r * cols + c}`);
    out.push(`(${ps.join(',')})`);
  }
  return out.join(',');
}

async function insert(sql: string, params: unknown[]): Promise<number> {
  const res = await (await db()).execute(sql, params);
  return Number(res.lastInsertId);
}

async function exec(sql: string, params: unknown[] = []): Promise<void> {
  await (await db()).execute(sql, params);
}

async function select<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db()).select<T[]>(sql, params);
}

// ---------- Ajustes ----------

export async function getSetting(key: string): Promise<string | null> {
  const rows = await select<{ value: string }>('SELECT value FROM settings WHERE key = $1', [key]);
  return rows[0]?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await exec(
    'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value]
  );
}

// ---------- Usuarios ----------

interface UserRow {
  id: number;
  name: string;
  created_at: string;
}

export async function listUsers(): Promise<User[]> {
  const rows = await select<UserRow>('SELECT id, name, created_at FROM users ORDER BY name COLLATE NOCASE');
  return rows.map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at }));
}

export async function getUser(id: number): Promise<User | null> {
  const rows = await select<UserRow>('SELECT id, name, created_at FROM users WHERE id = $1', [id]);
  const r = rows[0];
  return r ? { id: r.id, name: r.name, createdAt: r.created_at } : null;
}

export async function createUser(name: string): Promise<number> {
  return insert('INSERT INTO users (name, created_at) VALUES ($1, $2)', [name.trim(), now()]);
}

export async function renameUser(id: number, name: string): Promise<void> {
  await exec('UPDATE users SET name = $1 WHERE id = $2', [name.trim(), id]);
}

export async function deleteUser(id: number): Promise<void> {
  await exec('DELETE FROM users WHERE id = $1', [id]);
}

export async function getUserPrefs(id: number): Promise<UserPrefs> {
  const rows = await select<{ prefs: string }>('SELECT prefs FROM users WHERE id = $1', [id]);
  try {
    return JSON.parse(rows[0]?.prefs ?? '{}');
  } catch {
    return {};
  }
}

export async function setUserPrefs(id: number, prefs: UserPrefs): Promise<void> {
  await exec('UPDATE users SET prefs = $1 WHERE id = $2', [JSON.stringify(prefs), id]);
}

// ---------- Carpetas ----------

export async function listFolders(): Promise<Folder[]> {
  const rows = await select<{ id: number; name: string; parent_id: number | null }>(
    'SELECT id, name, parent_id FROM folders ORDER BY name COLLATE NOCASE'
  );
  return rows.map((r) => ({ id: r.id, name: r.name, parentId: r.parent_id }));
}

export async function createFolder(name: string, parentId: number | null): Promise<number> {
  return insert('INSERT INTO folders (name, parent_id, created_at) VALUES ($1, $2, $3)', [
    name.trim(),
    parentId,
    now(),
  ]);
}

export async function renameFolder(id: number, name: string): Promise<void> {
  await exec('UPDATE folders SET name = $1 WHERE id = $2', [name.trim(), id]);
}

/** Ids de la carpeta y de todas sus subcarpetas. */
export function descendantIds(folders: Folder[], id: number): Set<number> {
  const out = new Set<number>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders) {
      if (f.parentId !== null && out.has(f.parentId) && !out.has(f.id)) {
        out.add(f.id);
        grew = true;
      }
    }
  }
  return out;
}

export async function moveFolder(id: number, newParentId: number | null): Promise<void> {
  if (newParentId !== null) {
    const folders = await listFolders();
    if (descendantIds(folders, id).has(newParentId)) {
      throw new Error('No se puede mover una carpeta dentro de sí misma');
    }
  }
  await exec('UPDATE folders SET parent_id = $1 WHERE id = $2', [newParentId, id]);
}

export async function deleteFolder(id: number): Promise<void> {
  await exec('DELETE FROM folders WHERE id = $1', [id]);
}

// ---------- Cuestionarios ----------

interface QuizRow {
  id: number;
  folder_id: number | null;
  name: string;
  lang_a: string;
  lang_b: string;
  updated_at: string;
  pair_count?: number;
}

const toSummary = (r: QuizRow): QuizSummary => ({
  id: r.id,
  folderId: r.folder_id,
  name: r.name,
  langA: r.lang_a,
  langB: r.lang_b,
  updatedAt: r.updated_at,
  pairCount: r.pair_count ?? 0,
});

const QUIZ_SUMMARY_SQL = `
  SELECT q.id, q.folder_id, q.name, q.lang_a, q.lang_b, q.updated_at,
         (SELECT COUNT(*) FROM pairs p WHERE p.quiz_id = q.id) AS pair_count
  FROM quizzes q`;

/** Cuestionarios de una carpeta (null = sin carpeta). */
export async function listQuizzes(folderId: number | null): Promise<QuizSummary[]> {
  const rows =
    folderId === null
      ? await select<QuizRow>(`${QUIZ_SUMMARY_SQL} WHERE q.folder_id IS NULL ORDER BY q.name COLLATE NOCASE`)
      : await select<QuizRow>(`${QUIZ_SUMMARY_SQL} WHERE q.folder_id = $1 ORDER BY q.name COLLATE NOCASE`, [
          folderId,
        ]);
  return rows.map(toSummary);
}

export async function listAllQuizzes(): Promise<QuizSummary[]> {
  const rows = await select<QuizRow>(`${QUIZ_SUMMARY_SQL} ORDER BY q.name COLLATE NOCASE`);
  return rows.map(toSummary);
}

export async function getQuiz(id: number): Promise<Quiz | null> {
  const rows = await select<QuizRow>(
    'SELECT id, folder_id, name, lang_a, lang_b, updated_at FROM quizzes WHERE id = $1',
    [id]
  );
  if (!rows[0]) return null;
  const { pairCount: _, ...summary } = toSummary(rows[0]);
  const pairs = await select<{ id: number; a: string; b: string }>(
    'SELECT id, a, b FROM pairs WHERE quiz_id = $1 ORDER BY position, id',
    [id]
  );
  return { ...summary, pairs: pairs.map((p) => ({ id: p.id, a: p.a, b: p.b })) };
}

export async function createQuiz(
  name: string,
  folderId: number | null,
  langA: string,
  langB: string,
  pairs: { a: string; b: string }[] = []
): Promise<number> {
  const t = now();
  const id = await insert(
    'INSERT INTO quizzes (folder_id, name, lang_a, lang_b, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)',
    [folderId, name.trim(), langA, langB, t, t]
  );
  await insertPairs(
    id,
    pairs.map((p, i) => ({ position: i, a: p.a, b: p.b }))
  );
  return id;
}

async function insertPairs(quizId: number, rows: { position: number; a: string; b: string }[]): Promise<void> {
  // SQLite admite 32766 parámetros; se trocea por si acaso con listas enormes.
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const params = chunk.flatMap((r) => [quizId, r.position, r.a, r.b]);
    await exec(`INSERT INTO pairs (quiz_id, position, a, b) VALUES ${valuesPlaceholders(chunk.length, 4)}`, params);
  }
}

/**
 * Guarda nombre, idiomas y pares. Los pares existentes conservan su id
 * (así las estadísticas por palabra siguen siendo válidas).
 */
export async function saveQuiz(quiz: Quiz): Promise<void> {
  await exec('UPDATE quizzes SET name = $1, lang_a = $2, lang_b = $3, updated_at = $4 WHERE id = $5', [
    quiz.name.trim(),
    quiz.langA,
    quiz.langB,
    now(),
    quiz.id,
  ]);
  const existing = await select<{ id: number }>('SELECT id FROM pairs WHERE quiz_id = $1', [quiz.id]);
  const keep = new Set(quiz.pairs.filter((p) => p.id !== null).map((p) => p.id as number));
  const removed = existing.map((r) => r.id).filter((id) => !keep.has(id));
  if (removed.length > 0) {
    await exec(
      `DELETE FROM pairs WHERE quiz_id = $1 AND id IN (${removed.map((_, i) => `$${i + 2}`).join(',')})`,
      [quiz.id, ...removed]
    );
  }
  const newRows: { position: number; a: string; b: string }[] = [];
  for (const [position, p] of quiz.pairs.entries()) {
    if (p.id === null) newRows.push({ position, a: p.a, b: p.b });
    else
      await exec('UPDATE pairs SET position = $1, a = $2, b = $3 WHERE id = $4 AND quiz_id = $5', [
        position,
        p.a,
        p.b,
        p.id,
        quiz.id,
      ]);
  }
  await insertPairs(quiz.id, newRows);
}

export async function moveQuiz(id: number, folderId: number | null): Promise<void> {
  await exec('UPDATE quizzes SET folder_id = $1 WHERE id = $2', [folderId, id]);
}

export async function deleteQuiz(id: number): Promise<void> {
  await exec('DELETE FROM quizzes WHERE id = $1', [id]);
}

/** Número de cuestionarios dentro de una carpeta, contando subcarpetas. */
export async function countQuizzesInTree(folderId: number): Promise<number> {
  const ids = [...descendantIds(await listFolders(), folderId)];
  const rows = await select<{ n: number }>(
    `SELECT COUNT(*) AS n FROM quizzes WHERE folder_id IN (${ids.map((_, i) => `$${i + 1}`).join(',')})`,
    ids
  );
  return rows[0]?.n ?? 0;
}

// ---------- Sesiones ----------

interface SessionRow {
  id: number;
  user_id: number;
  quiz_id: number | null;
  quiz_name: string;
  direction: 'AB' | 'BA';
  answer_mode: 'typed' | 'self';
  input_mode: 'keyboard' | 'handwriting' | null;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  pair_count: number;
  rounds: number;
  first_round_errors: number;
  total_errors: number;
}

const toSession = (r: SessionRow): SessionRecord => ({
  id: r.id,
  userId: r.user_id,
  quizId: r.quiz_id,
  quizName: r.quiz_name,
  direction: r.direction,
  answerMode: r.answer_mode,
  inputMode: r.input_mode,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
  durationMs: r.duration_ms,
  pairCount: r.pair_count,
  rounds: r.rounds,
  firstRoundErrors: r.first_round_errors,
  totalErrors: r.total_errors,
});

export async function saveSession(s: Omit<SessionRecord, 'id'>, answers: AnswerRecord[]): Promise<number> {
  const id = await insert(
    `INSERT INTO sessions (user_id, quiz_id, quiz_name, direction, answer_mode, input_mode, started_at,
       finished_at, duration_ms, pair_count, rounds, first_round_errors, total_errors)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      s.userId,
      s.quizId,
      s.quizName,
      s.direction,
      s.answerMode,
      s.inputMode,
      s.startedAt,
      s.finishedAt,
      s.durationMs,
      s.pairCount,
      s.rounds,
      s.firstRoundErrors,
      s.totalErrors,
    ]
  );
  const CHUNK = 300;
  for (let i = 0; i < answers.length; i += CHUNK) {
    const chunk = answers.slice(i, i + CHUNK);
    const params = chunk.flatMap((a) => [
      id,
      a.pairId,
      a.round,
      a.prompt,
      a.expected,
      a.given,
      a.correct ? 1 : 0,
      a.overridden ? 1 : 0,
      a.elapsedMs,
    ]);
    await exec(
      `INSERT INTO answers (session_id, pair_id, round, prompt, expected, given, correct, overridden, elapsed_ms)
       VALUES ${valuesPlaceholders(chunk.length, 9)}`,
      params
    );
  }
  return id;
}

export async function listSessions(userId: number, quizId?: number): Promise<SessionRecord[]> {
  const rows =
    quizId === undefined
      ? await select<SessionRow>('SELECT * FROM sessions WHERE user_id = $1 ORDER BY finished_at DESC', [userId])
      : await select<SessionRow>(
          'SELECT * FROM sessions WHERE user_id = $1 AND quiz_id = $2 ORDER BY finished_at DESC',
          [userId, quizId]
        );
  return rows.map(toSession);
}

export async function getSession(id: number): Promise<{ session: SessionRecord; answers: AnswerRecord[] } | null> {
  const rows = await select<SessionRow>('SELECT * FROM sessions WHERE id = $1', [id]);
  if (!rows[0]) return null;
  const answers = await select<{
    pair_id: number | null;
    round: number;
    prompt: string;
    expected: string;
    given: string | null;
    correct: number;
    overridden: number;
    elapsed_ms: number;
  }>('SELECT * FROM answers WHERE session_id = $1 ORDER BY id', [id]);
  return {
    session: toSession(rows[0]),
    answers: answers.map((a) => ({
      pairId: a.pair_id,
      round: a.round,
      prompt: a.prompt,
      expected: a.expected,
      given: a.given,
      correct: a.correct === 1,
      overridden: a.overridden === 1,
      elapsedMs: a.elapsed_ms,
    })),
  };
}

export async function quizStats(userId: number, quizId: number): Promise<QuizStats> {
  const agg = await select<{ n: number; best: number | null }>(
    'SELECT COUNT(*) AS n, MIN(duration_ms) AS best FROM sessions WHERE user_id = $1 AND quiz_id = $2',
    [userId, quizId]
  );
  const last = await select<{ first_round_errors: number }>(
    'SELECT first_round_errors FROM sessions WHERE user_id = $1 AND quiz_id = $2 ORDER BY finished_at DESC LIMIT 1',
    [userId, quizId]
  );
  return {
    sessions: agg[0]?.n ?? 0,
    bestMs: agg[0]?.best ?? null,
    lastFirstRoundErrors: last[0]?.first_round_errors ?? null,
  };
}

export async function dbPath(): Promise<string> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string>('db_path');
}

