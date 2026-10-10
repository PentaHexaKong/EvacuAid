import { resetAlerts } from '@/features/alerts/use-alerts';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiRequest, type UserProfile } from './api';
import { useGuestSession } from './session';

export const PROFILE_KEY = 'evacuaid.profile.v1';
export type AccessibilityType = 'VISUAL_IMPAIRMENT' | 'HEARING_IMPAIRMENT' | 'MOBILITY_LIMITATION' | 'ELDERLY' | 'OTHER';
export type AccessibilityItem = { type: AccessibilityType; severity: string | null };

export const ONBOARDING_NEEDS_KEY = 'evacuaid.onboarding-needs.v1';
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
  const { token } = useGuestSession();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [accessibility, setAccessibility] = useState<AccessibilityItem[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentToken = useRef(token);

  // One guest's profile and needs must never carry over to the next guest on the same phone.
  useEffect(() => {
    currentToken.current = token;
    if (!token) { setProfile(null); setAccessibility([]); setReady(false); }
  }, [token]);
  // An unreleased build cached the needs here; make sure nothing is left behind.
  useEffect(() => { void AsyncStorage.removeItem('evacuaid.needs.v1').catch(() => {}); }, []);

  const retry = useCallback(async () => {
    if (!token) return;
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
      let loaded = current;
      if (localName !== null) {
        const migratedName = parseProfile(localName);
        if (migratedName) loaded = await apiRequest<UserProfile>(`/v1/users/${current.id}`, token, {
          method: 'PATCH', body: JSON.stringify({ name: migratedName }),
        });
        await AsyncStorage.removeItem(PROFILE_KEY);
      }
      // The session can end while this load is in flight; a late answer must not bring the old profile back.
      if (currentToken.current !== token) return;
      setProfile(loaded);
      setAccessibility(items);
      setReady(true);
    } catch (cause) {
      if (currentToken.current !== token) return;
      setError(cause instanceof Error ? cause.message : 'Could not load profile.');
      throw cause;
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    void Promise.resolve().then(retry).catch(() => {});
  }, [token, retry]);

  const saveProfile = async (patch: Partial<Pick<UserProfile, 'name' | 'phone' | 'needs_assistance' | 'share_location_with_buddies'>> & { accessibility?: AccessibilityItem[] }) => {
    if (!token || !profile) throw new Error('Profile is not ready');
    const updated = await apiRequest<UserProfile>(`/v1/users/${profile.id}`, token, { method: 'PATCH', body: JSON.stringify(patch) });
    if (currentToken.current !== token) return;
    setProfile(updated);
    if (patch.accessibility) setAccessibility(patch.accessibility);
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
    if (currentToken.current !== token) return;
    setProfile(updated);
    void resetAlerts();
  };
  const deleteLocation = async () => {
    if (!token || !profile) throw new Error('Profile is not ready');
    const updated = await apiRequest<UserProfile>(`/v1/users/${profile.id}/location`, token, { method: 'DELETE' });
    if (currentToken.current !== token) return;
    setProfile(updated);
    void resetAlerts();
  };

  return <Context.Provider value={{ profile, accessibility, name: profile?.name ?? '', ready, error, retry, saveName, saveProfile, saveAccessibility, saveLocation, deleteLocation }}>{children}</Context.Provider>;
}
