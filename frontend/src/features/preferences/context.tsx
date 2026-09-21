import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { defaults, parsePreferences, PREFERENCES_KEY, type Preferences } from './storage';

const Context = createContext({ preferences: defaults, ready: false, save: async (_value: Preferences): Promise<void> => {} });
export const usePreferences = () => useContext(Context);
export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState(defaults);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(PREFERENCES_KEY).then((value) => { if (active) setPreferences(parsePreferences(value)); }).catch(() => {}).finally(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, []);
  const save = async (value: Preferences) => {
    await AsyncStorage.setItem(PREFERENCES_KEY, JSON.stringify(value));
    setPreferences(value);
  };
  return <Context.Provider value={{ preferences, ready, save }}>{children}</Context.Provider>;
}

export function PreferencesPreview({ preferences, children }: { preferences: Preferences; children: ReactNode }) {
  const context = useContext(Context);
  return <Context.Provider value={{ ...context, preferences }}>{children}</Context.Provider>;
}
