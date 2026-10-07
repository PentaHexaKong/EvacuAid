import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiRequest, type UserProfile } from './api';
import { useGuestSession } from './session';

export const PROFILE_KEY = 'evacuaid.profile.v1';
export type AccessibilityType = 'VISUAL_IMPAIRMENT' | 'HEARING_IMPAIRMENT' | 'MOBILITY_LIMITATION' | 'ELDERLY' | 'OTHER';
export type AccessibilityItem = { type: AccessibilityType; severity: string | null };

export const ONBOARDING_NEEDS_KEY = 'evacuaid.onboarding-needs.v1';
export const NEEDS_KEY = 'evacuaid.needs.v1';
const NEED_TYPES: AccessibilityType[] = ['VISUAL_IMPAIRMENT', 'HEARING_IMPAIRMENT', 'MOBILITY_LIMITATION', 'ELDERLY'];
export function parseNeeds(value: string | null): AccessibilityItem[] {
  try {
    const data = JSON.parse(value ?? 'null');
    return Array.isArray(data) ? NEED_TYPES.filter(type => data.includes(type)).map(type => ({ type, severity: null })) : [];
  } catch { return []; }
}

export function parseProfile(value: string | null): string {
  try {
    const data = JSON.parse(value ?? 'null');
    return typeof data?.name === 'string' && data.name.length <= 60 && !/[\r\n]/.test(data.name) ? data.name.trim() : '';
  } catch { return ''; }
}

type ProfileContextValue = {
  profile: UserProfile | null;
  accessibility: AccessibilityItem[];
  name: string;
  ready: boolean;
  error: string | null;
  retry: () => Promise<void>;
  saveName: (name: string) => Promise<void>;
  saveProfile: (patch: Partial<Pick<UserProfile, 'name' | 'phone' | 'needs_assistance' | 'share_location_with_buddies'>> & { accessibility?: AccessibilityItem[] }) => Promise<void>;
  saveAccessibility: (items: AccessibilityItem[]) => Promise<void>;
  saveLocation: (latitude: number, longitude: number, accuracy: number | null, observedAt: string) => Promise<void>;
  deleteLocation: () => Promise<void>;
};

const empty: ProfileContextValue = {
  profile: null, accessibility: [], name: '', ready: false, error: null,
  retry: async () => {}, saveName: async () => {}, saveProfile: async () => {},
  saveAccessibility: async () => {}, saveLocation: async () => {}, deleteLocation: async () => {},
};
const Context = createContext(empty);
export const useProfile = () => useContext(Context);

export function ProfileProvider({ children }: { children: ReactNode }) {
  const { token, user } = useGuestSession();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [accessibility, setAccessibility] = useState<AccessibilityItem[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previousUser = useRef(user);
  const sessionVersion = useRef(0);
  const needsVersion = useRef(0);
  const cacheWrite = useRef(Promise.resolve());
  const cacheNeeds = useCallback((items: AccessibilityItem[] | null) => {
    cacheWrite.current = cacheWrite.current.then(() => items === null
      ? AsyncStorage.removeItem(NEEDS_KEY)
      : AsyncStorage.setItem(NEEDS_KEY, JSON.stringify(items.map(item => item.type)))).catch(() => {});
  }, []);

  useEffect(() => {
    if (previousUser.current && !user) {
      sessionVersion.current += 1;
      needsVersion.current += 1;
      setAccessibility([]);
      cacheNeeds(null);
    }
    previousUser.current = user;
  }, [user, cacheNeeds]);

  useEffect(() => {
    let active = true;
    const version = needsVersion.current;
    AsyncStorage.getItem(NEEDS_KEY).then(value => {
      let items: AccessibilityItem[] = [];
      try {
        const data: unknown = JSON.parse(value ?? 'null');
        const types: AccessibilityType[] = [...NEED_TYPES, 'OTHER'];
        if (Array.isArray(data)) items = data.filter((type: unknown): type is AccessibilityType => types.includes(type as AccessibilityType)).map(type => ({ type, severity: null }));
      } catch {}
      if (active && version === needsVersion.current) setAccessibility(current => current.length ? current : items);
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  const retry = useCallback(async () => {
    if (!token) return;
    const version = sessionVersion.current;
    setReady(false);
    setError(null);
    try {
      const current = await apiRequest<UserProfile>('/v1/me', token);
      let items = await apiRequest<AccessibilityItem[]>(`/v1/users/${current.id}/accessibility`, token);
      const needs = parseNeeds(await AsyncStorage.getItem(ONBOARDING_NEEDS_KEY));
      if (needs.length && !items.length) {
        await apiRequest<UserProfile>(`/v1/users/${current.id}`, token, { method: 'PATCH', body: JSON.stringify({ accessibility: needs }) });
        items = needs;
      }
      await AsyncStorage.removeItem(ONBOARDING_NEEDS_KEY);
      const localName = await AsyncStorage.getItem(PROFILE_KEY);
      if (localName !== null) {
        const migratedName = parseProfile(localName);
        const saved = migratedName ? await apiRequest<UserProfile>(`/v1/users/${current.id}`, token, {
          method: 'PATCH', body: JSON.stringify({ name: migratedName }),
        }) : current;
        await AsyncStorage.removeItem(PROFILE_KEY);
        setProfile(saved);
      } else setProfile(current);
      if (version !== sessionVersion.current) return;
      needsVersion.current += 1;
      setAccessibility(items);
      cacheNeeds(items);
      setReady(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load profile.');
      throw cause;
    }
  }, [token, cacheNeeds]);

  useEffect(() => {
    if (!token) return;
    void Promise.resolve().then(retry).catch(() => {});
  }, [token, retry]);

  const saveProfile = async (patch: Partial<Pick<UserProfile, 'name' | 'phone' | 'needs_assistance' | 'share_location_with_buddies'>> & { accessibility?: AccessibilityItem[] }) => {
    if (!token || !profile) throw new Error('Profile is not ready');
    const version = sessionVersion.current;
    const updated = await apiRequest<UserProfile>(`/v1/users/${profile.id}`, token, { method: 'PATCH', body: JSON.stringify(patch) });
    setProfile(updated);
    if (patch.accessibility && version === sessionVersion.current) {
      needsVersion.current += 1;
      setAccessibility(patch.accessibility);
      cacheNeeds(patch.accessibility);
    }
  };
  const saveName = async (draft: string) => saveProfile({ name: draft.replace(/[\r\n]+/g, ' ').trim().slice(0, 60) || null });
  const saveAccessibility = async (items: AccessibilityItem[]) => {
    await saveProfile({ accessibility: items });
  };
  const saveLocation = async (latitude: number, longitude: number, accuracy: number | null, observedAt: string) => {
    if (!token || !profile) throw new Error('Profile is not ready');
    const updated = await apiRequest<UserProfile>(`/v1/users/${profile.id}/location`, token, {
      method: 'PUT', body: JSON.stringify({ latitude, longitude, accuracy_m: accuracy, observed_at: observedAt }),
    });
    setProfile(updated);
  };
  const deleteLocation = async () => {
    if (!token || !profile) throw new Error('Profile is not ready');
    const updated = await apiRequest<UserProfile>(`/v1/users/${profile.id}/location`, token, { method: 'DELETE' });
    setProfile(updated);
  };

  return <Context.Provider value={{ profile, accessibility, name: profile?.name ?? '', ready, error, retry, saveName, saveProfile, saveAccessibility, saveLocation, deleteLocation }}>{children}</Context.Provider>;
}
