import { act, renderHook, waitFor } from '@testing-library/react-native';
import { buddyRequest, type Contact } from './api';
import { useIncomingContacts } from './use-incoming-contacts';

let mockFocused = true;
jest.mock('expo-router', () => ({ useIsFocused: () => mockFocused }));
jest.mock('./api', () => ({ buddyRequest: jest.fn() }));
const request = jest.mocked(buddyRequest);

beforeEach(() => { mockFocused = true; request.mockReset(); });

test('loads only incoming contacts and refreshes on focus', async () => {
  request.mockResolvedValue([{ name: 'Ari' }]);
  const view = renderHook(() => useIncomingContacts('helper', true));
  await waitFor(() => expect(view.result.current).toEqual([{ name: 'Ari' }]));
  expect(request).toHaveBeenCalledWith('helper', '/contacts/incoming', 'GET', undefined, expect.any(AbortSignal));
  const signal = request.mock.calls[0][4]!;
  mockFocused = false;
  view.rerender({});
  expect(signal.aborted).toBe(true);
  request.mockResolvedValue([{ name: 'Budi' }]);
  mockFocused = true;
  view.rerender({});
  await waitFor(() => expect(view.result.current).toEqual([{ name: 'Budi' }]));
  expect(request).toHaveBeenCalledTimes(2);
});

test('does not fetch without a session or for support-needs roles', () => {
  const view = renderHook(({ token, enabled }: { token: string | null; enabled: boolean }) => useIncomingContacts(token, enabled), { initialProps: { token: null as string | null, enabled: true } });
  view.rerender({ token: 'helper', enabled: false });
  expect(request).not.toHaveBeenCalled();
});

test('ignores a late result after changing session and hides previous contacts', async () => {
  let finish: (contacts: Contact[]) => void = () => {};
  request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  request.mockResolvedValue([]);
  const view = renderHook(({ token }: { token: string | null }) => useIncomingContacts(token, true), { initialProps: { token: 'first' as string | null } });
  view.rerender({ token: 'second' });
  await act(async () => finish([{ name: 'Old contact' } as Contact]));
  expect(view.result.current).toEqual([]);
  request.mockResolvedValue([{ name: 'Current contact' }]);
  view.rerender({ token: 'third' });
  await waitFor(() => expect(view.result.current).toEqual([{ name: 'Current contact' }]));
  view.rerender({ token: null });
  expect(view.result.current).toEqual([]);
});

test('failed requests leave the optional row empty and retry on next focus', async () => {
  request.mockRejectedValue(new Error('offline'));
  const view = renderHook(() => useIncomingContacts('helper', true));
  await act(async () => {});
  expect(view.result.current).toEqual([]);
  mockFocused = false;
  view.rerender({});
  request.mockResolvedValue([{ name: 'Ari' }]);
  mockFocused = true;
  view.rerender({});
  await waitFor(() => expect(view.result.current).toEqual([{ name: 'Ari' }]));
});
