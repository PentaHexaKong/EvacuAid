export const PREFERENCES_KEY = 'evacuaid.preferences.v1';
export type Preferences = {
  completed: boolean;
  largerText: boolean;
  strongerContrast: boolean;
  voiceEnabled: boolean;
  vibrationEnabled: boolean;
  textEnabled: boolean;
  language: 'id' | 'en';
};
export const defaults: Preferences = {
  completed: false, largerText: false, strongerContrast: false,
  voiceEnabled: true, vibrationEnabled: true, textEnabled: true, language: 'id',
};
export function parsePreferences(value: string | null): Preferences {
  try {
    const data = JSON.parse(value ?? 'null');
    if (!data || typeof data.completed !== 'boolean') return { ...defaults };
    return {
      completed: data.completed,
      largerText: typeof data.largerText === 'boolean' ? data.largerText : defaults.largerText,
      strongerContrast: typeof data.strongerContrast === 'boolean' ? data.strongerContrast : defaults.strongerContrast,
      voiceEnabled: typeof data.voiceEnabled === 'boolean' ? data.voiceEnabled : defaults.voiceEnabled,
      vibrationEnabled: typeof data.vibrationEnabled === 'boolean' ? data.vibrationEnabled : defaults.vibrationEnabled,
      textEnabled: typeof data.textEnabled === 'boolean' ? data.textEnabled : defaults.textEnabled,
      language: data.language === 'en' ? 'en' : 'id',
    };
  } catch { return { ...defaults }; }
}
