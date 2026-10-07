import { describe, expect, it } from 'vitest';
import { checkTyped, normalizeLoose, parse, validateSide } from '../src/lib/quiz/answer';

describe('parse', () => {
  it('separa las aclaraciones', () => {
    expect(parse('bank  (of a river)')).toEqual({ full: 'bank (of a river)', core: 'bank' });
    expect(parse('(to) run (fast)')).toEqual({ full: '(to) run (fast)', core: 'run' });
  });
});

describe('checkTyped', () => {
  it('tolera solo la mayúscula de la primera letra', () => {
    expect(checkTyped('Orilla', 'orilla')).toBe(true);
    expect(checkTyped('orilla', 'Orilla')).toBe(true);
    expect(checkTyped('oriLLa', 'orilla')).toBe(false);
    expect(checkTyped('ORILLA', 'orilla')).toBe(false);
  });
  it('exige las tildes', () => {
    expect(checkTyped('arbol', 'árbol')).toBe(false);
    expect(checkTyped('árbol', 'árbol')).toBe(true);
    expect(checkTyped('Árbol', 'árbol')).toBe(true);
    expect(checkTyped('nino', 'niño')).toBe(false);
  });
  it('no exige las aclaraciones, pero las admite', () => {
    expect(checkTyped('bank', 'bank (of a river)')).toBe(true);
    expect(checkTyped('bank (of a river)', 'bank (of a river)')).toBe(true);
    expect(checkTyped('bank (whatever)', 'bank (of a river)')).toBe(true);
  });
  it('ignora espacios sobrantes', () => {
    expect(checkTyped('  ice   cream ', 'ice cream')).toBe(true);
  });
  it('rechaza respuestas vacías o distintas', () => {
    expect(checkTyped('', 'dog')).toBe(false);
    expect(checkTyped('dogs', 'dog')).toBe(false);
  });
});

describe('validateSide', () => {
  it('detecta errores', () => {
    expect(validateSide('bank (river')).not.toBeNull();
    expect(validateSide('bank) river(')).not.toBeNull();
    expect(validateSide('(only clarification)')).not.toBeNull();
    expect(validateSide('bank (river)')).toBeNull();
  });
});

describe('normalizeLoose', () => {
  it('quita tildes, ñ, mayúsculas, puntuación y aclaraciones', () => {
    expect(normalizeLoose('Niño (pequeño)')).toBe('nino');
    expect(normalizeLoose('¡Árbol!')).toBe('arbol');
    expect(normalizeLoose("don't")).toBe("don't");
  });
});

import { parsePastedList } from '../src/lib/quiz/pasteList';

describe('parsePastedList', () => {
  it('admite tabulador, = y ;', () => {
    const r = parsePastedList('dog\tperro\n cat = gato \nbank (river) ; orilla\n\nsin separador\nvacío =');
    expect(r.pairs).toEqual([
      { a: 'dog', b: 'perro' },
      { a: 'cat', b: 'gato' },
      { a: 'bank (river)', b: 'orilla' },
    ]);
    expect(r.rejected).toEqual(['sin separador', 'vacío =']);
  });
});
