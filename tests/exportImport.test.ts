import { describe, expect, it } from 'vitest';
import { buildExport, importInto, parseExport, type QuizWithFolder } from '../src/lib/exportImport';
import type { Folder } from '../src/lib/db/types';

const folders: Folder[] = [
  { id: 1, name: 'Inglés', parentId: null },
  { id: 2, name: 'Tema 1', parentId: 1 },
  { id: 3, name: 'Francés', parentId: null },
];
const quizzes: QuizWithFolder[] = [
  { name: 'Animales', langA: 'en', langB: 'es', folderId: 2, pairs: [['dog', 'perro'], ['cat', 'gato']] },
  { name: 'Colores', langA: 'en', langB: 'es', folderId: 1, pairs: [['red', 'rojo']] },
  { name: 'Suelto', langA: 'fr', langB: 'es', folderId: null, pairs: [['chat', 'gato']] },
];

/** Destino falso que reconstruye carpetas y cuestionarios en memoria. */
function fakeTarget() {
  const fs: Folder[] = [];
  const qs: QuizWithFolder[] = [];
  let next = 100;
  return {
    fs,
    qs,
    async createFolder(name: string, parentId: number | null) {
      const id = next++;
      fs.push({ id, name, parentId });
      return id;
    },
    async createQuiz(name: string, folderId: number | null, langA: string, langB: string, pairs: { a: string; b: string }[]) {
      qs.push({ name, folderId, langA, langB, pairs: pairs.map((p) => [p.a, p.b]) });
      return next++;
    },
  };
}

describe('exportar e importar', () => {
  it('ida y vuelta de toda la biblioteca', async () => {
    const file = parseExport(JSON.stringify(buildExport(folders, quizzes, null)));
    const t = fakeTarget();
    expect(await importInto(file, null, t)).toBe(3);
    // Mismo resultado al volver a exportar lo importado.
    expect(buildExport(t.fs, t.qs, null)).toEqual(buildExport(folders, quizzes, null));
  });

  it('exporta una carpeta con sus subcarpetas e importa dentro de otra', async () => {
    const file = buildExport(folders, quizzes, 1);
    expect(file.folders).toHaveLength(1);
    expect(file.folders[0].children[0].quizzes[0].name).toBe('Animales');
    const t = fakeTarget();
    await importInto(file, 42, t);
    expect(t.fs[0]).toMatchObject({ name: 'Inglés', parentId: 42 });
    expect(t.qs.map((q) => q.name).sort()).toEqual(['Animales', 'Colores']);
  });

  it('rechaza ficheros incorrectos', () => {
    expect(() => parseExport('no json')).toThrow();
    expect(() => parseExport('{"format":"otro"}')).toThrow();
    expect(() => parseExport('{"format":"vocabulario","version":2,"folders":[],"quizzes":[]}')).toThrow();
    expect(() =>
      parseExport('{"format":"vocabulario","version":1,"folders":[],"quizzes":[{"name":"x","langA":"en","langB":"es","pairs":[["a"]]}]}')
    ).toThrow();
  });
});
