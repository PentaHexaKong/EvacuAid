import type { AuthResponse, Profile, ProfileUpdate, StoredSession } from './types';

const baseUrl = process.env.EXPO_PUBLIC_API_BASE_URL?.replace(/\/$/, '');

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

function url(path: string): string {
  if (!baseUrl) throw new ApiError(503, 'API base URL is not configured');
  return `${baseUrl}${path}`;
}

async function request<T>(path: string, init: RequestInit = {}, session?: StoredSession): Promise<T> {
  const response = await fetch(url(path), {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(session ? { Authorization: `Bearer ${session.accessToken}` } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { detail?: string } | null;
    throw new ApiError(response.status, body?.detail || 'Request failed');
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const authApi = {
  register: (value: { name: string; email: string; password: string; rememberMe: boolean }) => request<AuthResponse>('/v1/auth/register', { method: 'POST', body: JSON.stringify(value) }),
  login: (value: { email: string; password: string; rememberMe: boolean }) => request<AuthResponse>('/v1/auth/login', { method: 'POST', body: JSON.stringify(value) }),
  google: (idToken: string, rememberMe: boolean) => request<AuthResponse>('/v1/auth/google', { method: 'POST', body: JSON.stringify({ idToken, rememberMe }) }),
  refresh: (refreshToken: string) => request<AuthResponse>('/v1/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken }) }),
  logout: (refreshToken: string) => request<void>('/v1/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken }) }),
  requestReset: (email: string) => request<void>('/v1/auth/password/reset-request', { method: 'POST', body: JSON.stringify({ email }) }),
  resetPassword: (token: string, password: string) => request<void>('/v1/auth/password/reset', { method: 'POST', body: JSON.stringify({ token, password }) }),
  profile: (session: StoredSession) => request<Profile>('/v1/me/profile', {}, session),
  updateProfile: (session: StoredSession, value: ProfileUpdate) => request<Profile>('/v1/me/profile', { method: 'PATCH', body: JSON.stringify(value) }, session),
};
