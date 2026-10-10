import { renderHook, waitFor } from '@testing-library/react-native';
import { buddyRequest } from './api';
import { usePrimaryBuddy } from './use-primary-buddy';

jest.mock('expo-router', () => ({ useIsFocused: () => true }));
jest.mock('./api', () => ({ buddyRequest: jest.fn() }));
beforeEach(() => jest.clearAllMocks());
test.each([
  [[{ name: 'Ari', level: 'SECONDARY' }, { name: 'Sari', level: 'PRIMARY' }], 'Sari'],
  [[{ name: 'Ari', level: 'SECONDARY' }], 'Ari'],
])('chooses the primary buddy or the first contact', async (contacts, name) => {
  jest.mocked(buddyRequest).mockResolvedValue(contacts);
  const { result } = renderHook(() => usePrimaryBuddy('guest', true));
  await waitFor(() => expect(result.current).toBe(name));
  expect(buddyRequest).toHaveBeenCalledWith('guest', '/contacts', 'GET', undefined, expect.any(AbortSignal));
});
test('does not fetch without support needs or a session', () => {
  renderHook(() => usePrimaryBuddy('guest', false));
  renderHook(() => usePrimaryBuddy(null, true));
  expect(buddyRequest).not.toHaveBeenCalled();
});
