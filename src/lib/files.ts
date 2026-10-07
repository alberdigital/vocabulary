// Exportar e importar ficheros JSON con los diálogos nativos.

import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import * as repo from './db/repo';
import { buildExport, exportSingleQuiz, importInto, parseExport, type QuizWithFolder } from './exportImport';

const FILTERS = [{ name: 'Vocabulario (JSON)', extensions: ['json'] }];

function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'vocabulario';
}

async function saveJson(defaultName: string, data: unknown): Promise<boolean> {
  const path = await save({ defaultPath: `${safeFileName(defaultName)}.json`, filters: FILTERS });
  if (!path) return false;
  await invoke('write_text_file', { path, contents: JSON.stringify(data, null, 2) });
  return true;
}

export async function exportQuiz(quizId: number): Promise<boolean> {
  const q = await repo.getQuiz(quizId);
  if (!q) return false;
  return saveJson(
    q.name,
    exportSingleQuiz({ name: q.name, langA: q.langA, langB: q.langB, pairs: q.pairs.map((p) => [p.a, p.b]) })
  );
}

/** Exporta una carpeta con sus subcarpetas, o toda la biblioteca si folderId es null. */
export async function exportFolder(folderId: number | null): Promise<boolean> {
  const folders = await repo.listFolders();
  const summaries = await repo.listAllQuizzes();
  const quizzes: QuizWithFolder[] = [];
  for (const s of summaries) {
    const q = await repo.getQuiz(s.id);
    if (q) quizzes.push({ name: q.name, langA: q.langA, langB: q.langB, folderId: q.folderId, pairs: q.pairs.map((p) => [p.a, p.b]) });
  }
  const name = folderId === null ? 'biblioteca' : (folders.find((f) => f.id === folderId)?.name ?? 'carpeta');
  return saveJson(name, buildExport(folders, quizzes, folderId));
}

/** Pide un fichero e importa su contenido dentro de la carpeta indicada. Devuelve el número de cuestionarios creados, o null si se canceló. */
export async function importFile(parentId: number | null): Promise<number | null> {
  const path = await open({ multiple: false, directory: false, filters: FILTERS });
  if (!path || Array.isArray(path)) return null;
  const text = await invoke<string>('read_text_file', { path });
  return importInto(parseExport(text), parentId, {
    createFolder: repo.createFolder,
    createQuiz: repo.createQuiz,
  });
}
