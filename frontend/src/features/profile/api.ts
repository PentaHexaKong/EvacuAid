export type UserProfile = {
  id: string;
  name: string | null;
  phone: string | null;
  latitude: number | null;
  longitude: number | null;
  location_observed_at: string | null;
  location_accuracy_m: number | null;
  share_location_with_buddies: boolean;
  needs_assistance: boolean;
};

export type ApiError = Error & { status?: number; kind?: 'network' | 'http' | 'config'; originalCause?: unknown };

const apiBaseUrl = (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').replace(/\/+$/, '');

export async function apiRequest<T>(path: string, token?: string, init: RequestInit = {}): Promise<T> {
  if (!apiBaseUrl) {
    const error = new Error('EXPO_PUBLIC_API_BASE_URL is not configured') as ApiError;
    error.kind = 'config';
    throw error;
  }
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });
  } catch (cause) {
    if ((cause as Error)?.name === 'AbortError') throw cause;
    const error = new Error('Cannot reach EvacuAid API. Check the backend address, that it is running, and that this device can reach the computer.') as ApiError;
    error.kind = 'network';
    error.originalCause = cause;
    throw error;
  }
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = await response.json() as { detail?: string };
      if (body.detail) message = body.detail;
    } catch {}
    const error = new Error(message) as ApiError;
    error.status = response.status;
    error.kind = 'http';
    throw error;
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function preferencesToApi(value: {
  voiceEnabled: boolean;
  vibrationEnabled: boolean;
  textEnabled: boolean;
  language: 'id' | 'en';
  largerText: boolean;
  strongerContrast: boolean;
}) {
  return {
    voice_enabled: value.voiceEnabled,
    vibration_enabled: value.vibrationEnabled,
    text_enabled: value.textEnabled,
    language: value.language,
    larger_text: value.largerText,
    stronger_contrast: value.strongerContrast,
  };
}

export function preferencesFromApi(value: {
  voice_enabled: boolean;
  vibration_enabled: boolean;
  text_enabled: boolean;
  language: 'id' | 'en';
  larger_text: boolean;
  stronger_contrast: boolean;
}) {
  return {
    voiceEnabled: value.voice_enabled,
    vibrationEnabled: value.vibration_enabled,
    textEnabled: value.text_enabled,
    language: value.language,
    largerText: value.larger_text,
    strongerContrast: value.stronger_contrast,
  };
}
