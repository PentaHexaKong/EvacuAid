import { AppState } from 'react-native';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { buddyRequest } from './api';
import { useBuddyPilot } from './use-buddy-pilot';

jest.mock('./api', () => ({ ...jest.requireActual('./api'), buddyRequest: jest.fn() }));
const request = jest.mocked(buddyRequest);
const active = { id: 'session', status: 'ACCEPTED' };

beforeEach(() => {
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
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
  const { result } = renderHook(() => useBuddyPilot('token'));
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
  const { result } = renderHook(() => useBuddyPilot('token'));
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
  const { result } = renderHook(() => useBuddyPilot('token'));
  await waitFor(() => expect(result.current.loading).toBe(false));
  request.mockRejectedValueOnce(Object.assign(new Error('removed'), { status: 403 }));
  await act(async () => { await result.current.refresh('session'); });
  expect(result.current.session).toBeNull();
  expect(result.current.locations).toEqual([]);
  expect(result.current.messages).toEqual([]);
});


test('historical notification cannot replace the authoritative active session', async () => {
  const { result } = renderHook(() => useBuddyPilot('token'));
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
  const { result, unmount } = renderHook(() => useBuddyPilot('token'));
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
