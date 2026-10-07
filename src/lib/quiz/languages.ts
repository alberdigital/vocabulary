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
