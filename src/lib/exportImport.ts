// Formato JSON para compartir cuestionarios y carpetas (no incluye usuarios ni historial).

import type { Folder } from './db/types';

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
