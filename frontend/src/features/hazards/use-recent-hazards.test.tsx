import { act, renderHook, waitFor } from '@testing-library/react-native';
import { fetchRecentHazards } from './api';
import { useRecentHazards } from './use-recent-hazards';

jest.mock('./api', () => ({ fetchRecentHazards: jest.fn() }));
jest.mock('@/features/profile/session', () => ({ useGuestSession: () => ({ token: 'guest-token' }) }));

const fetchMock = fetchRecentHazards as jest.Mock;
const quake = { id: 'bmkg:1', type: 'earthquake', occurredAt: '2026-10-02T06:48:10+00:00', source: 'BMKG', latitude: -8, longitude: 120, magnitude: 4.3, depthKm: 17, region: 'Ruteng', felt: 'II-III', reportCount: null };
const up = { status: 'available', error: null };
const down = { status: 'unavailable', error: 'source unavailable' };

beforeEach(() => fetchMock.mockReset());

test('ready with items when any source is available', async () => {
  fetchMock.mockResolvedValueOnce({ items: [quake], sources: { BMKG: up, PetaBencana: down } });
  const { result } = renderHook(useRecentHazards);
  await waitFor(() => expect(result.current.status).toBe('ready'));
  expect(result.current.items).toHaveLength(1);
  expect(fetchMock).toHaveBeenCalledWith('guest-token');
});

test('error when every source is down or the request fails, and retry recovers', async () => {
  fetchMock.mockResolvedValueOnce({ items: [], sources: { BMKG: down, PetaBencana: down } });
  const { result } = renderHook(useRecentHazards);
  await waitFor(() => expect(result.current.status).toBe('error'));
  fetchMock.mockRejectedValueOnce(new Error('network'));
  await act(async () => { await result.current.retry(); });
  expect(result.current.status).toBe('error');
  fetchMock.mockResolvedValueOnce({ items: [quake], sources: { BMKG: up } });
  await act(async () => { await result.current.retry(); });
  expect(result.current.status).toBe('ready');
});

test('refetches when the app returns to the foreground with data older than five minutes', async () => {
  const { AppState } = jest.requireActual<typeof import('react-native')>('react-native');
  let onChange: (state: string) => void = () => {};
  const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => { onChange = handler as (state: string) => void; return { remove: jest.fn() } as never; });
  const start = Date.parse('2026-10-02T12:00:00Z');
  const now = jest.spyOn(Date, 'now').mockReturnValue(start);
  fetchMock.mockResolvedValue({ items: [quake], sources: { BMKG: up } });
  const { result } = renderHook(useRecentHazards);
  await waitFor(() => expect(result.current.status).toBe('ready'));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  now.mockReturnValue(start + 2 * 60_000);
  await act(async () => onChange('active'));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  now.mockReturnValue(start + 6 * 60_000);
  await act(async () => onChange('background'));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await act(async () => onChange('active'));
  expect(fetchMock).toHaveBeenCalledTimes(2);
  spy.mockRestore();
  now.mockRestore();
});
