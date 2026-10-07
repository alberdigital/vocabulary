// Corrección de respuestas.
// Las aclaraciones van entre paréntesis: se muestran al preguntar, pero no se exigen al responder.

export interface ParsedText {
  /** Texto completo, con las aclaraciones. */
  full: string;
  /** Texto sin las aclaraciones: lo que hay que responder. */
  core: string;
}

export function collapseSpaces(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Quita los segmentos entre paréntesis (no anidados ni anidados) y colapsa espacios. */
export function stripClarifications(s: string): string {
  let out = '';
  let depth = 0;
  for (const ch of s) {
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0) out += ch;
  }
  return collapseSpaces(out);
}

export function parse(text: string): ParsedText {
  return { full: collapseSpaces(text), core: stripClarifications(text) };
}

/** Devuelve un mensaje de error si el texto no es válido como lado de un par, o null. */
export function validateSide(text: string): string | null {
  let depth = 0;
  for (const ch of text) {
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth < 0) return 'Paréntesis desequilibrados';
    }
  }
  if (depth !== 0) return 'Paréntesis desequilibrados';
  if (stripClarifications(text) === '') return 'Falta la palabra (fuera de los paréntesis)';
  return null;
}

/** Iguales, o iguales salvo mayúscula/minúscula de la primera letra. */
function sameExceptFirstCase(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length === 0 || a.length !== b.length) return false;
  const fa = a[0], fb = b[0];
  return a.slice(1) === b.slice(1) && fa.toLowerCase() === fb.toLowerCase();
}

/** Corrección de la respuesta escrita con teclado. Sensible a tildes. */
export function checkTyped(given: string, expectedText: string): boolean {
  const expected = parse(expectedText).core;
  const g = collapseSpaces(given);
  if (g === '') return false;
  return sameExceptFirstCase(g, expected) || sameExceptFirstCase(stripClarifications(g), expected);
}

/** Normalización laxa para la escritura a mano: sin tildes, sin ñ, minúsculas, sin puntuación. */
export function normalizeLoose(s: string): string {
  return collapseSpaces(
    stripClarifications(s)
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}' ]/gu, ' ')
  );
}
