/**
 * Convierte texto pegado en pares. Cada línea: «a<TAB>b», «a = b» o «a ; b».
 * Devuelve también las líneas que no se pudieron interpretar.
 */
export function parsePastedList(text: string): { pairs: { a: string; b: string }[]; rejected: string[] } {
  const pairs: { a: string; b: string }[] = [];
  const rejected: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let parts: string[] | null = null;
    for (const sep of ['\t', '=', ';']) {
      const i = raw.indexOf(sep);
      if (i >= 0) {
        parts = [raw.slice(0, i), raw.slice(i + sep.length)];
        break;
      }
    }
    const a = parts?.[0].trim() ?? '';
    const b = parts?.[1].trim() ?? '';
    if (a && b) pairs.push({ a, b });
    else rejected.push(line);
  }
  return { pairs, rejected };
}
