export type Language = 'id' | 'en';
export const LANGUAGE_KEY = 'evacuaid.language';
export function isLanguage(value: unknown): value is Language { return value === 'id' || value === 'en'; }
export function resolveLanguage(saved: unknown, deviceLanguages: (string | null)[]): Language {
  if (isLanguage(saved)) return saved;
  return deviceLanguages.find(isLanguage) ?? 'id';
}
export type LanguageStorage = { getItem: (key: string) => Promise<string | null>; setItem: (key: string, value: string) => Promise<unknown> };
export async function loadLanguage(storage: LanguageStorage, deviceLanguages: (string | null)[]) {
  try { return resolveLanguage(await storage.getItem(LANGUAGE_KEY), deviceLanguages); }
  catch { return resolveLanguage(null, deviceLanguages); }
}
export async function persistLanguage(storage: LanguageStorage, language: Language) {
  await storage.setItem(LANGUAGE_KEY, language);
}
