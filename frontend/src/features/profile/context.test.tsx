import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { apiRequest } from './api';
import { NEEDS_KEY, ONBOARDING_NEEDS_KEY, parseNeeds, parseProfile, PROFILE_KEY, ProfileProvider, useProfile, type AccessibilityItem } from './context';

let mockSession: { token: string | null; user: { id: string } | null | undefined };
jest.mock('./session', () => ({ useGuestSession: () => mockSession }));
jest.mock('./api', () => ({ apiRequest: jest.fn() }));

const request = apiRequest as jest.Mock;
let profile: Record<string, unknown>;

beforeEach(async () => {
  jest.restoreAllMocks();
  request.mockReset();
  await AsyncStorage.clear();
  mockSession = { token: 'guest-token', user: { id: 'user-1' } };
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

test('onboarding support needs are sent once when the profile has none, then cleared', async () => {
  expect(parseNeeds('["ELDERLY","OTHER","nope"]')).toEqual([{ type: 'ELDERLY', severity: null }]);
  expect(parseNeeds('{')).toEqual([]);
  await AsyncStorage.setItem(ONBOARDING_NEEDS_KEY, JSON.stringify(['VISUAL_IMPAIRMENT', 'MOBILITY_LIMITATION']));
  const view = renderHook(useProfile, { wrapper: ProfileProvider });
  await waitFor(() => expect(view.result.current.ready).toBe(true));
  const needs = [{ type: 'VISUAL_IMPAIRMENT', severity: null }, { type: 'MOBILITY_LIMITATION', severity: null }];
  expect(request).toHaveBeenCalledWith('/v1/users/user-1', 'guest-token', { method: 'PATCH', body: JSON.stringify({ accessibility: needs }) });
  expect(view.result.current.accessibility).toEqual(needs);
  expect(await AsyncStorage.getItem(ONBOARDING_NEEDS_KEY)).toBeNull();
});

test('cached valid needs are available before the API resolves', async () => {
  await AsyncStorage.setItem(NEEDS_KEY, JSON.stringify(['VISUAL_IMPAIRMENT', 'OTHER', 'unknown', 5]));
  let resolveProfile!: (value: Record<string, unknown>) => void;
  request.mockImplementationOnce(() => new Promise(resolve => { resolveProfile = resolve; }));
  const view = renderHook(useProfile, { wrapper: ProfileProvider });
  await waitFor(() => expect(view.result.current.accessibility).toEqual([
    { type: 'VISUAL_IMPAIRMENT', severity: null }, { type: 'OTHER', severity: null },
  ]));
  expect(view.result.current.ready).toBe(false);
  await act(async () => resolveProfile(profile));
  await waitFor(() => expect(view.result.current.ready).toBe(true));
});

test('API needs overwrite the cached types without caching severity', async () => {
  await AsyncStorage.setItem(NEEDS_KEY, JSON.stringify(['VISUAL_IMPAIRMENT']));
  const items: AccessibilityItem[] = [{ type: 'HEARING_IMPAIRMENT', severity: 'high' }];
  request.mockImplementation(async (path: string) => path.endsWith('/accessibility') ? items : profile);
  const view = renderHook(useProfile, { wrapper: ProfileProvider });
  await waitFor(() => expect(view.result.current.ready).toBe(true));
  expect(view.result.current.accessibility).toEqual(items);
  await waitFor(async () => expect(await AsyncStorage.getItem(NEEDS_KEY)).toBe(JSON.stringify(['HEARING_IMPAIRMENT'])));
});

test('successful accessibility saves update the cache, including clearing needs', async () => {
  const view = renderHook(useProfile, { wrapper: ProfileProvider });
  await waitFor(() => expect(view.result.current.ready).toBe(true));
  const items: AccessibilityItem[] = [{ type: 'MOBILITY_LIMITATION', severity: 'high' }, { type: 'ELDERLY', severity: null }];
  await act(async () => view.result.current.saveAccessibility(items));
  expect(view.result.current.accessibility).toEqual(items);
  expect(await AsyncStorage.getItem(NEEDS_KEY)).toBe(JSON.stringify(['MOBILITY_LIMITATION', 'ELDERLY']));
  request.mockRejectedValueOnce(new Error('save failed'));
  await act(async () => { await expect(view.result.current.saveAccessibility([])).rejects.toThrow('save failed'); });
  expect(await AsyncStorage.getItem(NEEDS_KEY)).toBe(JSON.stringify(['MOBILITY_LIMITATION', 'ELDERLY']));
  await act(async () => view.result.current.saveProfile({ accessibility: [] }));
  expect(await AsyncStorage.getItem(NEEDS_KEY)).toBe('[]');
});

test.each(['{', '{}', '["unknown",5,null]'])('invalid cached needs are ignored: %s', async value => {
  await AsyncStorage.setItem(NEEDS_KEY, value);
  request.mockRejectedValueOnce(new Error('offline'));
  const view = renderHook(useProfile, { wrapper: ProfileProvider });
  await waitFor(() => expect(view.result.current.error).toBe('offline'));
  expect(view.result.current.accessibility).toEqual([]);
});

test.each([null, undefined])('losing the session user clears memory and cache: %s', async user => {
  const view = renderHook(useProfile, { wrapper: ProfileProvider });
  await waitFor(() => expect(view.result.current.ready).toBe(true));
  await act(async () => view.result.current.saveAccessibility([{ type: 'ELDERLY', severity: null }]));
  mockSession = { token: null, user };
  view.rerender({});
  expect(view.result.current.accessibility).toEqual([]);
  await waitFor(async () => expect(await AsyncStorage.getItem(NEEDS_KEY)).toBeNull());
});

test('a late API result cannot restore needs after the session user is lost', async () => {
  await AsyncStorage.setItem(NEEDS_KEY, JSON.stringify(['ELDERLY']));
  let resolveItems!: (value: AccessibilityItem[]) => void;
  request.mockImplementation(async (path: string) => path.endsWith('/accessibility')
    ? new Promise<AccessibilityItem[]>(resolve => { resolveItems = resolve; }) : profile);
  const view = renderHook(useProfile, { wrapper: ProfileProvider });
  await waitFor(() => expect(view.result.current.accessibility).toEqual([{ type: 'ELDERLY', severity: null }]));
  await waitFor(() => expect(resolveItems).toBeDefined());
  mockSession = { token: null, user: null };
  view.rerender({});
  await act(async () => resolveItems([{ type: 'VISUAL_IMPAIRMENT', severity: null }]));
  expect(view.result.current.accessibility).toEqual([]);
  expect(await AsyncStorage.getItem(NEEDS_KEY)).toBeNull();
});

test('a late cache read cannot replace a confirmed empty API result', async () => {
  const getItem = jest.mocked(AsyncStorage.getItem).getMockImplementation()!;
  let resolveCache!: (value: string | null) => void;
  jest.spyOn(AsyncStorage, 'getItem').mockImplementationOnce(key => key === NEEDS_KEY
    ? new Promise(resolve => { resolveCache = resolve; }) : getItem(key));
  const view = renderHook(useProfile, { wrapper: ProfileProvider });
  await waitFor(() => expect(view.result.current.ready).toBe(true));
  await act(async () => resolveCache(JSON.stringify(['ELDERLY'])));
  expect(view.result.current.accessibility).toEqual([]);
  expect(await getItem(NEEDS_KEY)).toBe('[]');
});

test('a late cache read cannot restore needs after the session user is lost', async () => {
  const getItem = jest.mocked(AsyncStorage.getItem).getMockImplementation()!;
  let resolveCache!: (value: string | null) => void;
  jest.spyOn(AsyncStorage, 'getItem').mockImplementationOnce(key => key === NEEDS_KEY
    ? new Promise(resolve => { resolveCache = resolve; }) : getItem(key));
  request.mockRejectedValueOnce(new Error('offline'));
  const view = renderHook(useProfile, { wrapper: ProfileProvider });
  await waitFor(() => expect(view.result.current.error).toBe('offline'));
  mockSession = { token: null, user: null };
  view.rerender({});
  await act(async () => resolveCache(JSON.stringify(['ELDERLY'])));
  expect(view.result.current.accessibility).toEqual([]);
  expect(await getItem(NEEDS_KEY)).toBeNull();
});
