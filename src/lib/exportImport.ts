// Formato JSON para compartir cuestionarios y carpetas (no incluye usuarios ni historial).

import type { Folder, SessionOptions } from './db/types';

export interface ExportQuiz {
  name: string;
  langA: string;
  langB: string;
  pairs: [string, string][];
}

export interface ExportFolder {
  name: string;
  children: ExportFolder[];
  quizzes: ExportQuiz[];
}

export interface ExportFile {
  format: 'vocabulario';
  version: 1;
  folders: ExportFolder[];
  quizzes: ExportQuiz[];
}

export interface QuizWithFolder extends ExportQuiz {
  folderId: number | null;
}

/** Construye el árbol de exportación a partir de una carpeta (o de la raíz si folderId es null). */
export function buildExport(folders: Folder[], quizzes: QuizWithFolder[], folderId: number | null): ExportFile {
  const strip = (q: QuizWithFolder): ExportQuiz => ({ name: q.name, langA: q.langA, langB: q.langB, pairs: q.pairs });
  const subtree = (id: number): ExportFolder => {
    const f = folders.find((x) => x.id === id)!;
    return {
      name: f.name,
      children: folders.filter((x) => x.parentId === id).map((x) => subtree(x.id)),
      quizzes: quizzes.filter((q) => q.folderId === id).map(strip),
    };
  };
  if (folderId === null) {
    return {
      format: 'vocabulario',
      version: 1,
      folders: folders.filter((x) => x.parentId === null).map((x) => subtree(x.id)),
      quizzes: quizzes.filter((q) => q.folderId === null).map(strip),
    };
  }
  return { format: 'vocabulario', version: 1, folders: [subtree(folderId)], quizzes: [] };
}

export function exportSingleQuiz(q: ExportQuiz): ExportFile {
  return { format: 'vocabulario', version: 1, folders: [], quizzes: [q] };
}

function isQuiz(x: unknown): x is ExportQuiz {
  const q = x as ExportQuiz;
  return (
    typeof q?.name === 'string' &&
    typeof q.langA === 'string' &&
    typeof q.langB === 'string' &&
    Array.isArray(q.pairs) &&
    q.pairs.every((p) => Array.isArray(p) && p.length === 2 && typeof p[0] === 'string' && typeof p[1] === 'string')
  );
}

function isFolder(x: unknown): x is ExportFolder {
  const f = x as ExportFolder;
  return (
    typeof f?.name === 'string' &&
    Array.isArray(f.children) &&
    f.children.every(isFolder) &&
    Array.isArray(f.quizzes) &&
    f.quizzes.every(isQuiz)
  );
}

/** Lee y valida un fichero exportado. Lanza un Error con un mensaje legible si no es válido. */
export function parseExport(text: string): ExportFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('El fichero no es JSON válido');
  }
  const d = data as ExportFile;
  if ((data as BoxExportFile)?.format === 'vocabulario-leitner')
    throw new Error('El fichero es una caja de Leitner: impórtalo desde la pestaña «Cajas de Leitner»');
  if (d?.format !== 'vocabulario') throw new Error('El fichero no es una exportación de Vocabulario');
  if (d.version !== 1) throw new Error(`Versión de fichero no soportada: ${String(d.version)}`);
  if (!Array.isArray(d.folders) || !d.folders.every(isFolder) || !Array.isArray(d.quizzes) || !d.quizzes.every(isQuiz))
    throw new Error('El fichero tiene un formato incorrecto');
  return d;
}

export interface ImportTarget {
  createFolder(name: string, parentId: number | null): Promise<number>;
  createQuiz(
    name: string,
    folderId: number | null,
    langA: string,
    langB: string,
    pairs: { a: string; b: string }[]
  ): Promise<number>;
}

/** Importa creando siempre elementos nuevos dentro de parentId. Devuelve cuántos cuestionarios se crearon. */
export async function importInto(file: ExportFile, parentId: number | null, target: ImportTarget): Promise<number> {
  let count = 0;
  const addQuiz = async (q: ExportQuiz, folderId: number | null) => {
    await target.createQuiz(q.name, folderId, q.langA, q.langB, q.pairs.map(([a, b]) => ({ a, b })));
    count++;
  };
  const addFolder = async (f: ExportFolder, parent: number | null) => {
    const id = await target.createFolder(f.name, parent);
    for (const q of f.quizzes) await addQuiz(q, id);
    for (const c of f.children) await addFolder(c, id);
  };
  for (const f of file.folders) await addFolder(f, parentId);
  for (const q of file.quizzes) await addQuiz(q, parentId);
  return count;
}

// ---------- Cajas de Leitner ----------

export interface ExportBox extends SessionOptions {
  name: string;
  firstCapacity: number;
}

/** Una caja con sus cuestionarios completos y el compartimento de cada palabra. */
export interface BoxExportFile {
  format: 'vocabulario-leitner';
  version: 1;
  box: ExportBox;
  quizzes: ExportQuiz[];
  /**
   * [índice del cuestionario, índice del par, compartimento (0 = pendiente … 6 = aprendida)],
   * de la palabra más antigua a la más reciente.
   */
  cards: [number, number, number][];
  /** Palabras quitadas a mano: [índice del cuestionario, índice del par] */
  excluded: [number, number][];
}

/** Datos de una palabra de la caja para exportarla. */
export interface BoxExportPair {
  a: string;
  b: string;
  /** null si la palabra está excluida de la caja. */
  compartment: number | null;
  /** Antigüedad en la caja (menor = más antigua). */
  seq: number;
}

export function buildBoxExport(box: ExportBox, quizzes: (Omit<ExportQuiz, 'pairs'> & { pairs: BoxExportPair[] })[]): BoxExportFile {
  const cards: { card: [number, number, number]; seq: number }[] = [];
  const excluded: [number, number][] = [];
  quizzes.forEach((q, qi) =>
    q.pairs.forEach((p, pi) => {
      if (p.compartment === null) excluded.push([qi, pi]);
      else cards.push({ card: [qi, pi, p.compartment], seq: p.seq });
    })
  );
  return {
    format: 'vocabulario-leitner',
    version: 1,
    box: {
      name: box.name,
      firstCapacity: box.firstCapacity,
      direction: box.direction,
      answerMode: box.answerMode,
      inputMode: box.inputMode,
    },
    quizzes: quizzes.map((q) => ({ name: q.name, langA: q.langA, langB: q.langB, pairs: q.pairs.map((p) => [p.a, p.b]) })),
    cards: cards.sort((x, y) => x.seq - y.seq).map((c) => c.card),
    excluded,
  };
}

const isIndexTuple = (x: unknown, len: number) =>
  Array.isArray(x) && x.length === len && x.every((n) => Number.isInteger(n) && n >= 0);

export function parseBoxExport(text: string): BoxExportFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('El fichero no es JSON válido');
  }
  const d = data as BoxExportFile;
  if ((data as ExportFile)?.format === 'vocabulario')
    throw new Error('El fichero contiene cuestionarios, no una caja: impórtalo desde la pestaña «Cuestionarios»');
  if (d?.format !== 'vocabulario-leitner') throw new Error('El fichero no es una caja de Leitner de Vocabulario');
  if (d.version !== 1) throw new Error(`Versión de fichero no soportada: ${String(d.version)}`);
  const b = d.box;
  const ok =
    typeof b?.name === 'string' &&
    Number.isInteger(b.firstCapacity) &&
    b.firstCapacity > 0 &&
    (b.direction === 'AB' || b.direction === 'BA') &&
    (b.answerMode === 'typed' || b.answerMode === 'self') &&
    (b.inputMode === 'keyboard' || b.inputMode === 'handwriting') &&
    Array.isArray(d.quizzes) &&
    d.quizzes.every(isQuiz) &&
    Array.isArray(d.cards) &&
    d.cards.every((c) => isIndexTuple(c, 3) && c[2] <= 6 && d.quizzes[c[0]]?.pairs[c[1]] !== undefined) &&
    Array.isArray(d.excluded) &&
    d.excluded.every((c) => isIndexTuple(c, 2) && d.quizzes[c[0]]?.pairs[c[1]] !== undefined);
  if (!ok) throw new Error('El fichero tiene un formato incorrecto');
  return d;
}

export interface BoxImportTarget {
  createFolder(name: string, parentId: number | null): Promise<number>;
  createQuiz(
    name: string,
    folderId: number | null,
    langA: string,
    langB: string,
    pairs: { a: string; b: string }[]
  ): Promise<number>;
  /** Ids de los pares del cuestionario, en orden. */
  pairIds(quizId: number): Promise<number[]>;
  createBox(box: ExportBox, quizIds: number[], excludedPairIds: number[]): Promise<number>;
  /** Fija el compartimento y la antigüedad de las palabras de la caja. */
  setCards(boxId: number, cards: { pairId: number; compartment: number; seq: number }[]): Promise<void>;
}

/** Crea los cuestionarios en una carpeta nueva con el nombre de la caja, y la caja con su progreso. */
export async function importBoxInto(file: BoxExportFile, target: BoxImportTarget): Promise<number> {
  const folderId = await target.createFolder(file.box.name, null);
  const quizIds: number[] = [];
  const pairIds: number[][] = [];
  for (const q of file.quizzes) {
    const id = await target.createQuiz(q.name, folderId, q.langA, q.langB, q.pairs.map(([a, b]) => ({ a, b })));
    quizIds.push(id);
    pairIds.push(await target.pairIds(id));
  }
  const excluded = file.excluded.map(([qi, pi]) => pairIds[qi][pi]);
  const boxId = await target.createBox(file.box, quizIds, excluded);
  // El orden del fichero es la antigüedad.
  await target.setCards(
    boxId,
    file.cards.map(([qi, pi, compartment], i) => ({ pairId: pairIds[qi][pi], compartment, seq: i + 1 }))
  );
  return boxId;
}
