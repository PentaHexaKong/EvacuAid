import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { apiRequest } from './api';
import { ONBOARDING_NEEDS_KEY, parseNeeds, parseProfile, PROFILE_KEY, ProfileProvider, useProfile } from './context';

let mockSession: { token: string | null; user: { id: string } | null } = { token: 'guest-token', user: { id: 'user-1' } };
jest.mock('./session', () => ({ useGuestSession: () => mockSession }));
jest.mock('./api', () => ({ apiRequest: jest.fn() }));

const request = apiRequest as jest.Mock;
let profile: Record<string, unknown>;

beforeEach(async () => {
  mockSession = { token: 'guest-token', user: { id: 'user-1' } };
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

test('ending the session clears the profile and needs, and a load still in flight cannot restore them', async () => {
  request.mockImplementation(async (path: string) => (path === '/v1/me' ? profile : path.endsWith('/accessibility') ? [{ type: 'VISUAL_IMPAIRMENT', severity: null }] : profile));
  const view = renderHook(useProfile, { wrapper: ProfileProvider });
  await waitFor(() => expect(view.result.current.accessibility).toHaveLength(1));
  let release!: (value: unknown) => void;
  request.mockImplementation((path: string) => (path === '/v1/me' ? new Promise(resolve => { release = resolve; }) : Promise.resolve([{ type: 'VISUAL_IMPAIRMENT', severity: null }])));
  let pending!: Promise<void>;
  act(() => { pending = view.result.current.retry(); });
  mockSession = { token: null, user: null };
  view.rerender({});
  await waitFor(() => expect(view.result.current.accessibility).toEqual([]));
  expect(view.result.current.profile).toBeNull();
  await act(async () => { release(profile); await pending; });
  expect(view.result.current.profile).toBeNull();
  expect(view.result.current.accessibility).toEqual([]);
});

test('needs left on the phone by an unreleased build are removed', async () => {
  await AsyncStorage.setItem('evacuaid.needs.v1', JSON.stringify(['VISUAL_IMPAIRMENT']));
  renderHook(useProfile, { wrapper: ProfileProvider });
  await waitFor(async () => expect(await AsyncStorage.getItem('evacuaid.needs.v1')).toBeNull());
});
