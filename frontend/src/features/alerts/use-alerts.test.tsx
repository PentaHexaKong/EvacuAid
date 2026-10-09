import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { fetchAlerts } from './api';
import { findAlert, useAlerts } from './use-alerts';
import { alertItems } from './test-fixtures';

let mockToken = 'guest-0';
let mockFocused = true;
jest.mock('./api', () => ({ fetchAlerts: jest.fn() }));
jest.mock('@/features/profile/session', () => ({ useGuestSession: () => ({ token: mockToken }) }));
jest.mock('expo-router', () => ({ useIsFocused: () => mockFocused }));
const fetchMock = jest.mocked(fetchAlerts);
const good = { status: 'ready' as const, data: { items: alertItems, location: { observedAt: null } } };
let onChange: (value: string) => void;
let sequence = 0;
beforeEach(() => {
  mockToken = `guest-${++sequence}`;
  mockFocused = true;
  fetchMock.mockReset().mockResolvedValue(good);
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => { onChange = handler as typeof onChange; return { remove: jest.fn() }; });
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

test('first load is ready and all readers share a single fetch', async () => {
  const { result } = renderHook(() => [useAlerts(), useAlerts()]);
  await waitFor(() => expect(result.current[0].status).toBe('ready'));
  expect(result.current[1].items).toEqual(alertItems);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(findAlert('rain')).toEqual(alertItems[0]);
});
test('409 outcome becomes no-location', async () => {
  fetchMock.mockResolvedValue({ status: 'no-location' });
  const { result } = renderHook(useAlerts);
  await waitFor(() => expect(result.current.status).toBe('no-location'));
  expect(result.current.items).toEqual([]);
});
test('failure after success retains items and last update as stale', async () => {
  const { result } = renderHook(useAlerts);
  await waitFor(() => expect(result.current.status).toBe('ready'));
  const updatedAt = result.current.updatedAt;
  fetchMock.mockRejectedValueOnce(new Error('offline'));
  await act(async () => { await result.current.reload(); });
  expect(result.current).toMatchObject({ status: 'ready', items: alertItems, updatedAt, stale: true });
});
test('failure without prior success is error', async () => {
  fetchMock.mockRejectedValue(new Error('offline'));
  const { result } = renderHook(useAlerts);
  await waitFor(() => expect(result.current.status).toBe('error'));
  expect(result.current.stale).toBe(false);
});
test('one 60 second timer reloads and stops in the background', async () => {
  jest.useFakeTimers();
  const view = renderHook(useAlerts);
  await act(async () => {});
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await act(async () => { jest.advanceTimersByTime(60_000); });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  await act(async () => { onChange('background'); jest.advanceTimersByTime(180_000); });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  await act(async () => { onChange('active'); });
  expect(fetchMock).toHaveBeenCalledTimes(3);
  view.unmount();
  await act(async () => { jest.advanceTimersByTime(60_000); });
  expect(fetchMock).toHaveBeenCalledTimes(3);
});
test('focus refreshes the shared feed', async () => {
  mockFocused = false;
  const view = renderHook(useAlerts);
  await waitFor(() => expect(view.result.current.status).toBe('ready'));
  mockFocused = true;
  view.rerender({});
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
});
