export const PREFERENCES_KEY = 'evacuaid.preferences.v1';
export type Preferences = { completed: boolean; largerText: boolean; strongerContrast: boolean };
export const defaults: Preferences = { completed: false, largerText: false, strongerContrast: false };
export function parsePreferences(value: string | null): Preferences {
  try {
    const data = JSON.parse(value ?? 'null');
    if (!data || typeof data.completed !== 'boolean' || typeof data.largerText !== 'boolean' || typeof data.strongerContrast !== 'boolean') return { ...defaults };
    return { completed: data.completed, largerText: data.largerText, strongerContrast: data.strongerContrast };
  } catch { return { ...defaults }; }
}
