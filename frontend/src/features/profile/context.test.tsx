import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { apiRequest } from './api';
import { parseProfile, PROFILE_KEY, ProfileProvider, useProfile } from './context';

jest.mock('./session', () => ({ useGuestSession: () => ({ token: 'guest-token', user: { id: 'user-1' } }) }));
jest.mock('./api', () => ({ apiRequest: jest.fn() }));

const request = apiRequest as jest.Mock;
let profile: Record<string, unknown>;

beforeEach(async () => {
  jest.restoreAllMocks();
  request.mockReset();
  await AsyncStorage.clear();
  profile = {
    id: 'user-1', name: null, phone: null, latitude: null, longitude: null,
    location_observed_at: null, location_accuracy_m: null,
    share_location_with_buddies: false, needs_assistance: false,
  };
  request.mockImplementation(async (path: string, _token: string, init?: RequestInit) => {
    if (path === '/v1/me') return profile;
    if (path.endsWith('/accessibility')) return [];
    if (init?.method === 'PATCH') {
      profile = { ...profile, ...JSON.parse(String(init.body)) };
      return profile;
    }
    return profile;
  });
});

test('missing, malformed, wrong-type and oversized names fall back to empty', () => {
  for (const value of [null, '{', '{}', 'null', '{"name":5}', JSON.stringify({ name: 'a'.repeat(61) }), JSON.stringify({ name: 'Two\nlines' })]) expect(parseProfile(value)).toBe('');
  expect(parseProfile('{"name":"  Billy  "}')).toBe('Billy');
});

test('legacy name migrates to backend and later saves update server state', async () => {
  await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify({ name: 'Local name' }));
  const view = renderHook(useProfile, { wrapper: ProfileProvider });
  await waitFor(() => expect(view.result.current.ready).toBe(true));
  expect(view.result.current.name).toBe('Local name');
  expect(await AsyncStorage.getItem(PROFILE_KEY)).toBeNull();
  expect(request).toHaveBeenCalledWith('/v1/users/user-1', 'guest-token', expect.objectContaining({ method: 'PATCH' }));
  await act(async () => view.result.current.saveName('  Billy  '));
  expect(view.result.current.name).toBe('Billy');
  expect(profile.name).toBe('Billy');
});

test('failed server loads and saves never replace confirmed profile values', async () => {
  request.mockRejectedValueOnce(new Error('network'));
  const view = renderHook(useProfile, { wrapper: ProfileProvider });
  await waitFor(() => expect(view.result.current.error).toBe('network'));
  request.mockImplementation(async (path: string, _token: string, init?: RequestInit) => {
    if (path === '/v1/me') return profile;
    if (path.endsWith('/accessibility')) return [];
    if (init?.method === 'PATCH') throw new Error('save failed');
    return profile;
  });
  await act(async () => view.result.current.retry());
  expect(view.result.current.ready).toBe(true);
  await act(async () => { await expect(view.result.current.saveName('New')).rejects.toThrow('save failed'); });
  expect(view.result.current.name).toBe('');
});
