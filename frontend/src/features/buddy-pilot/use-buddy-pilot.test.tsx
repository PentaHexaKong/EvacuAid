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
