export const LANGUAGES: Record<string, string> = {
  es: 'Español',
  en: 'Inglés',
  fr: 'Francés',
  de: 'Alemán',
  it: 'Italiano',
  pt: 'Portugués',
  ca: 'Catalán',
  eu: 'Euskera',
  gl: 'Gallego',
  nl: 'Neerlandés',
  sv: 'Sueco',
  da: 'Danés',
  no: 'Noruego',
  pl: 'Polaco',
  ro: 'Rumano',
  la: 'Latín',
};

export function langName(code: string): string {
  return LANGUAGES[code] ?? code;
}

/** Par de idiomas en orden: a → b. */
export interface LangPair {
  a: string;
  b: string;
}

/** Los idiomas son los del par, en el mismo orden o al revés. */
export function samePair(langA: string, langB: string, ref: LangPair): boolean {
  return (langA === ref.a && langB === ref.b) || (langA === ref.b && langB === ref.a);
}

/** Los idiomas son los del par, pero al revés. */
export function reversedPair(langA: string, langB: string, ref: LangPair): boolean {
  return ref.a !== ref.b && langA === ref.b && langB === ref.a;
}
