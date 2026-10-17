// Exportar e importar ficheros JSON con los diálogos nativos.

import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import * as repo from './db/repo';
import {
  buildBoxExport,
  buildExport,
  exportSingleQuiz,
  importBoxInto,
  importInto,
  parseBoxExport,
  parseExport,
  type QuizWithFolder,
} from './exportImport';

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
  const name = folderId === null ? 'cuestionarios' : (folders.find((f) => f.id === folderId)?.name ?? 'carpeta');
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

/** Exporta una caja con sus cuestionarios y el compartimento de cada palabra. */
export async function exportBox(boxId: number): Promise<boolean> {
  const box = await repo.getBox(boxId);
  if (!box) return false;
  const sel = await repo.getBoxSelection(boxId);
  const excluded = new Set(sel.excludedPairIds);
  const where = new Map((await repo.boxCards(boxId)).map((c) => [c.pairId, c]));
  const quizzes = [];
  for (const id of sel.quizIds) {
    const q = await repo.getQuiz(id);
    if (!q) continue;
    quizzes.push({
      name: q.name,
      langA: q.langA,
      langB: q.langB,
      pairs: q.pairs.map((p) => ({
        a: p.a,
        b: p.b,
        compartment: excluded.has(p.id!) ? null : (where.get(p.id!)?.compartment ?? 0),
        seq: where.get(p.id!)?.seq ?? 0,
      })),
    });
  }
  return saveJson(box.name, buildBoxExport(box, quizzes));
}

/** Pide un fichero de caja y lo importa para el usuario. Devuelve el id de la caja, o null si se canceló. */
export async function importBoxFile(userId: number): Promise<number | null> {
  const path = await open({ multiple: false, directory: false, filters: FILTERS });
  if (!path || Array.isArray(path)) return null;
  const text = await invoke<string>('read_text_file', { path });
  const file = parseBoxExport(text);
  const boxId = await importBoxInto(file, {
    createFolder: repo.createFolder,
    createQuiz: repo.createQuiz,
    pairIds: async (quizId) => (await repo.getQuiz(quizId))?.pairs.map((p) => p.id!) ?? [],
    createBox: async (box, quizIds, excludedPairIds) => {
      const id = await repo.createBox(userId, box);
      await repo.setBoxSelection(id, { quizIds, excludedPairIds });
      return id;
    },
    setCards: repo.saveCards,
  });
  await repo.syncBox(boxId);
  return boxId;
}
