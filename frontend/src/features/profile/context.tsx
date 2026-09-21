import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const PROFILE_KEY = 'evacuaid.profile.v1';
export function parseProfile(value: string | null): string {
  try {
    const data = JSON.parse(value ?? 'null');
    return typeof data?.name === 'string' && data.name.length <= 60 && !/[\r\n]/.test(data.name) ? data.name.trim() : '';
  } catch { return ''; }
}
const Context = createContext({ name: '', ready: false, saveName: async (_name: string): Promise<void> => {} });
export const useProfile = () => useContext(Context);
export function ProfileProvider({ children }: { children: ReactNode }) {
  const [name, setName] = useState('');
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(PROFILE_KEY).then(value => { if (active) setName(parseProfile(value)); }).catch(() => {}).finally(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, []);
  const saveName = async (draft: string) => {
    const value = draft.replace(/[\r\n]+/g, ' ').trim().slice(0, 60);
    await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify({ name: value }));
    setName(value);
  };
  return <Context.Provider value={{ name, ready, saveName }}>{children}</Context.Provider>;
}
