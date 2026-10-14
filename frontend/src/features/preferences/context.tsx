import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { defaults, parsePreferences, PREFERENCES_KEY, type Preferences } from './storage';
import { apiRequest, preferencesFromApi, preferencesToApi } from '@/features/profile/api';
import { useGuestSession } from '@/features/profile/session';
import { authSession } from '@/features/profile/auth-session';
import { isLanguage, LANGUAGE_KEY } from '@/localization/language';

type ApiPreferences = {
  voice_enabled: boolean;
  vibration_enabled: boolean;
  text_enabled: boolean;
  language: 'id' | 'en';
  larger_text: boolean;
  stronger_contrast: boolean;
};
const PREFERENCES_SYNCED_USER_KEY = 'evacuaid.preferences.synced-user.v1';

const Context = createContext({ preferences: defaults, ready: false, error: null as string | null, retry: async (): Promise<void> => {}, save: async (_value: Preferences): Promise<void> => {}, resetOnboarding: async (): Promise<() => Promise<void>> => async () => {} });
export const usePreferences = () => useContext(Context);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const { token, user, account } = useGuestSession();
  const currentUser = useRef(user?.id);
  useEffect(() => { currentUser.current = user?.id; }, [user?.id]);
  const [preferences, setPreferences] = useState(defaults);
  const [ready, setReady] = useState(false);
  const [localReady, setLocalReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(PREFERENCES_KEY).then((value) => {
      if (active) setPreferences(parsePreferences(value));
    }).catch(() => {
      if (active) setError('Could not read saved preferences.');
    }).finally(() => { if (active) { setReady(true); setLocalReady(true); } });
    return () => { active = false; };
  }, []);

  const sync = useCallback(async () => {
    if (!token || !user || !localReady) return;
    setError(null);
    try {
      const raw = await AsyncStorage.getItem(PREFERENCES_KEY);
      const local = parsePreferences(raw);
      const oldLanguage = await AsyncStorage.getItem(LANGUAGE_KEY);
      const syncedUserId = await AsyncStorage.getItem(PREFERENCES_SYNCED_USER_KEY);
      let remote;
      let parsed: Record<string, unknown> = {};
      try { parsed = raw ? JSON.parse(raw) as Record<string, unknown> : {}; } catch {}
      const hasLegacyValues = ['largerText', 'strongerContrast', 'voiceEnabled', 'vibrationEnabled', 'textEnabled', 'language']
        .some((key) => Object.prototype.hasOwnProperty.call(parsed, key));
      const needsMigration = (!account && !syncedUserId && (hasLegacyValues || isLanguage(oldLanguage))) || authSession.takeFreshGuest(user.id);
      if (needsMigration) {
        const selectedLanguage = isLanguage(parsed.language) ? parsed.language : isLanguage(oldLanguage) ? oldLanguage : local.language;
        remote = await apiRequest<ApiPreferences>('/v1/users/' + user.id + '/preferences', token, {
          method: 'PUT', body: JSON.stringify(preferencesToApi({ ...local, language: selectedLanguage })),
        });
      } else {
        remote = await apiRequest<ApiPreferences>('/v1/users/' + user.id + '/preferences', token);
        // The language picked on this phone before signing in is what the person reads; the account's saved one must not replace it.
        if (syncedUserId !== user.id && isLanguage(oldLanguage) && oldLanguage !== remote.language) {
          remote = await apiRequest<ApiPreferences>('/v1/users/' + user.id + '/preferences', token, {
            method: 'PUT', body: JSON.stringify(preferencesToApi({ ...preferencesFromApi(remote), language: oldLanguage })),
          });
        }
      }
      if (currentUser.current !== user.id) return;
      const value = { ...preferencesFromApi(remote), completed: local.completed };
      await AsyncStorage.setItem(PREFERENCES_KEY, JSON.stringify({ completed: local.completed }));
      await AsyncStorage.setItem(PREFERENCES_SYNCED_USER_KEY, user.id);
      if (currentUser.current !== user.id) return;
      setPreferences(value);
      setReady(true);
      const { selectLanguage } = await import('@/localization');
      await selectLanguage(value.language);
    } catch (cause) {
      if (currentUser.current !== user.id) return;
      setError(cause instanceof Error ? cause.message : 'Could not sync preferences.');
      setReady(true);
    }
  }, [token, user?.id, account?.id, localReady]);

  useEffect(() => { void Promise.resolve().then(sync); }, [sync]);

  const save = async (value: Preferences) => {
    setError(null);
    if (token && user) {
      await apiRequest(`/v1/users/${user.id}/preferences`, token, {
        method: 'PUT', body: JSON.stringify(preferencesToApi(value)),
      });
      await AsyncStorage.setItem(PREFERENCES_KEY, JSON.stringify({ completed: value.completed }));
    } else {
      await AsyncStorage.setItem(PREFERENCES_KEY, JSON.stringify(value));
    }
    setPreferences(value);
  };

  const resetOnboarding = async () => {
    const previous = preferences;
    const saved = await AsyncStorage.getItem(PREFERENCES_KEY);
    await AsyncStorage.setItem(PREFERENCES_KEY, JSON.stringify({ completed: false }));
    setPreferences(current => ({ ...current, completed: false }));
    return async () => {
      if (saved === null) await AsyncStorage.removeItem(PREFERENCES_KEY);
      else await AsyncStorage.setItem(PREFERENCES_KEY, saved);
      setPreferences(previous);
    };
  };

  return <Context.Provider value={{ preferences, ready, error, retry: sync, save, resetOnboarding }}>{children}</Context.Provider>;
}

export function PreferencesPreview({ preferences, children }: { preferences: Preferences; children: ReactNode }) {
  const context = useContext(Context);
  return <Context.Provider value={{ ...context, preferences }}>{children}</Context.Provider>;
}
