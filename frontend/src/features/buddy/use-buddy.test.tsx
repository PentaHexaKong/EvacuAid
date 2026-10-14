import { AppState } from 'react-native';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { buddyRequest } from './api';
import { useBuddyCode, useBuddy } from './use-buddy';

jest.mock('./api', () => ({ ...jest.requireActual('./api'), buddyRequest: jest.fn() }));
const request = jest.mocked(buddyRequest);
const active = { id: 'session', status: 'ACCEPTED' };

beforeEach(() => {
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
  jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
  request.mockReset();
  request.mockImplementation(async (_token, path) => {
    if (path === '/requests/current') return active;
    if (path.endsWith('/location')) return { locations: [{ userId: 'partner' }] };
    if (path === '/availability') return { optedIn: false, enrolled: false };
    return [];
  });
});

test('identical refresh preserves references and changed contacts update', async () => {
  const implementation = request.getMockImplementation()!;
  request.mockImplementation(async (token, path, ...args) => JSON.parse(JSON.stringify(await implementation(token, path, ...args))));
  const { result } = renderHook(() => useBuddy('token'));
  await waitFor(() => expect(result.current.loading).toBe(false));
  const { contacts, session, locations, availability } = result.current;
  await act(async () => { await result.current.refresh(); });
  expect(result.current.contacts).toBe(contacts);
  expect(result.current.session).toBe(session);
  expect(result.current.locations).toBe(locations);
  expect(result.current.availability).toBe(availability);
  const nextContacts = [{ id: 'contact', userId: 'requester', buddyUserId: 'partner', name: 'Buddy', level: 'PRIMARY', status: 'ACTIVE', available: true, observedAt: null }];
  request.mockImplementation(async (token, path, ...args) => path === '/contacts' ? nextContacts : JSON.parse(JSON.stringify(await implementation(token, path, ...args))));
  await act(async () => { await result.current.refresh(); });
  expect(result.current.contacts).not.toBe(contacts);
  expect(result.current.contacts).toEqual(nextContacts);
});

test('connection loss clears displayed partner position and recovery restores it', async () => {
  const { result } = renderHook(() => useBuddy('token'));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.locations).toHaveLength(1);
  request.mockRejectedValueOnce(new Error('offline'));
  await act(async () => { await result.current.refresh(); });
  expect(result.current.locations).toEqual([]);
  expect(result.current.error).toBe('offline');
  await act(async () => { await result.current.refresh(); });
  expect(result.current.locations).toHaveLength(1);
  expect(result.current.error).toBeNull();
});

test('lost authorization removes the selected session and its messages', async () => {
  const { result } = renderHook(() => useBuddy('token'));
  await waitFor(() => expect(result.current.loading).toBe(false));
  request.mockRejectedValueOnce(Object.assign(new Error('removed'), { status: 403 }));
  await act(async () => { await result.current.refresh('session'); });
  expect(result.current.session).toBeNull();
  expect(result.current.locations).toEqual([]);
  expect(result.current.messages).toEqual([]);
});


test('historical notification cannot replace the authoritative active session', async () => {
  const { result } = renderHook(() => useBuddy('token'));
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(async () => { await result.current.refresh('old-completed-session'); });
  expect(result.current.session?.id).toBe('session');
  expect(request.mock.calls.some(([, path]) => path === '/requests/old-completed-session')).toBe(false);
});

test('active events during refresh keep a single poll loop', async () => {
  jest.useFakeTimers();
  let change: ((state: 'active') => void) | undefined;
  const subscription = jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, handler) => { change = handler; return { remove: jest.fn() }; });
  const implementation = request.getMockImplementation()!;
  let resolveContacts!: (contacts: never[]) => void;
  const contacts = new Promise<never[]>(resolve => { resolveContacts = resolve; });
  const { result, unmount } = renderHook(() => useBuddy('token'));
  try {
    await act(async () => {});
    expect(result.current.session?.status).toBe('ACCEPTED');
    request.mockClear();
    request.mockImplementation((token, path, ...args) => path === '/contacts' ? contacts : implementation(token, path, ...args));
    act(() => { change!('active'); });
    await act(async () => { change!('active'); });
    await act(async () => { resolveContacts([]); });
    expect(result.current.session?.status).toBe('ACCEPTED');
    const initialCalls = request.mock.calls.filter(([, path]) => path === '/contacts').length;
    await act(async () => { jest.advanceTimersByTime(2000); });
    const nextCalls = request.mock.calls.filter(([, path]) => path === '/contacts').length;
    expect({ initialCalls, nextCalls }).toEqual({ initialCalls: 1, nextCalls: 2 });
  } finally { unmount(); subscription.mockRestore(); jest.useRealTimers(); }
});

test('received invitations join the existing refresh and update after accepting one', async () => {
  const implementation = request.getMockImplementation()!;
  const received = [{ id: 'received', status: 'SENT', direction: 'SEEK_HELP', ownerName: 'Test friend', ownerNeeds: ['HEARING_IMPAIRMENT'] }];
  request.mockImplementation(async (token, path, ...args) => path === '/invitations/received' ? received : implementation(token, path, ...args));
  const { result } = renderHook(() => useBuddy('token'));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.received).toEqual(received);
  expect(request.mock.calls.filter(([, path]) => path === '/invitations/received')).toHaveLength(1);
  request.mockImplementation(async (token, path, ...args) => path === '/invitations/received' ? [] : implementation(token, path, ...args));
  await act(async () => { await result.current.run('/invitations/received/accept', {}); });
  expect(result.current.received).toEqual([]);
});

test('permanent codes load once per token and a late previous user response is ignored', async () => {
  let resolveOld!: (value: { code: string }) => void;
  request.mockImplementation((token) => token === 'old' ? new Promise(resolve => { resolveOld = resolve; }) : Promise.resolve({ code: 'K7Q2-M9XD' }));
  const { result, rerender } = renderHook(({ token }: { token: string }) => useBuddyCode(token), { initialProps: { token: 'old' } });
  expect(result.current).toBeNull();
  rerender({ token: 'new' });
  await waitFor(() => expect(result.current).toBe('K7Q2-M9XD'));
  await act(async () => { resolveOld({ code: 'ABCD-1234' }); });
  expect(result.current).toBe('K7Q2-M9XD');
  rerender({ token: 'new' });
  expect(request.mock.calls.filter(([token]) => token === 'new')).toHaveLength(1);
});

test('offline reopening restores account availability and cached Buddies before the network responds', async () => {
  const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
  await AsyncStorage.setItem('evacuaid.buddy.offline.v1:offline-helper', JSON.stringify({ contacts: [{ id: 'buddy', userId: 'offline-helper', buddyUserId: 'friend', name: 'Synthetic Buddy', beaconId: 42, status: 'ACTIVE' }], incomingContacts: [], availability: { enrolled: true, optedIn: true, observedAt: null } }));
  request.mockImplementation(() => new Promise(() => {}));
  const view = renderHook(() => useBuddy('offline-token', 'offline-helper'));
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  expect(view.result.current.availability).toEqual({ enrolled: true, optedIn: true, observedAt: null }); expect(view.result.current.contacts[0].name).toBe('Synthetic Buddy'); expect(view.result.current.contactsReady).toBe(false);
});

test('authoritative online revocation overrides cached helper availability', async () => {
  const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
  await AsyncStorage.setItem('evacuaid.buddy.offline.v1:revoked-helper', JSON.stringify({ contacts: [], incomingContacts: [], availability: { enrolled: true, optedIn: true, observedAt: null } }));
  const view = renderHook(() => useBuddy('token', 'revoked-helper'));
  await waitFor(() => expect(view.result.current.contactsReady).toBe(true));
  expect(view.result.current.availability?.optedIn).toBe(false); expect(view.result.current.availability?.enrolled).toBe(false);
  expect(JSON.parse(await AsyncStorage.getItem('evacuaid.buddy.offline.v1:revoked-helper') ?? '{}').availability.optedIn).toBe(false);
});

test('offline opt-out is persisted and sent before reading availability on reconnect', async () => {
  const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
  await AsyncStorage.setItem('evacuaid.buddy.offline.v1:choice-helper', JSON.stringify({ contacts: [], incomingContacts: [], availability: { enrolled: true, optedIn: true, observedAt: null } }));
  request.mockRejectedValue(new Error('offline'));
  const view = renderHook(() => useBuddy('token', 'choice-helper'));
  await waitFor(() => expect(view.result.current.availability?.optedIn).toBe(true));
  await act(async () => { await view.result.current.setOfflineAvailability(false); });
  expect(view.result.current.availability?.optedIn).toBe(false);
  expect(JSON.parse(await AsyncStorage.getItem('evacuaid.buddy.offline.v1:choice-helper') ?? '{}').pendingOptOut).toBe(true);
  request.mockImplementation(async (_token, path) => path === '/availability' ? { enrolled: true, optedIn: false, observedAt: null } : path === '/requests/current' ? null : []);
  request.mockClear();
  await act(async () => { await view.result.current.refresh(); });
  expect(request.mock.calls[0]).toEqual(['token', '/availability', 'PUT', { optedIn: false }, expect.any(AbortSignal)]);
  expect(view.result.current.availability?.optedIn).toBe(false);
  expect(JSON.parse(await AsyncStorage.getItem('evacuaid.buddy.offline.v1:choice-helper') ?? '{}').pendingOptOut).toBe(false);
});

test('offline availability cannot implicitly opt in', async () => {
  const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
  await AsyncStorage.setItem('evacuaid.buddy.offline.v1:never-helper', JSON.stringify({ contacts: [], incomingContacts: [], availability: { enrolled: true, optedIn: false, observedAt: null } }));
  request.mockRejectedValue(new Error('offline'));
  const view = renderHook(() => useBuddy('token', 'never-helper'));
  await waitFor(() => expect(view.result.current.availability?.optedIn).toBe(false));
  await act(async () => { await view.result.current.setOfflineAvailability(true); });
  expect(view.result.current.availability?.optedIn).toBe(false);
});
