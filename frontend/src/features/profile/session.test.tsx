import { act, renderHook } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { apiRequest, type UserProfile } from './api';
import { GuestSessionProvider, GUEST_TOKEN_KEY, useGuestSession } from './session';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
jest.mock('./api', () => ({ apiRequest: jest.fn() }));

const profile = { id: 'guest-1', name: null } as UserProfile;
const wrapper = ({ children }: { children: React.ReactNode }) => <GuestSessionProvider>{children}</GuestSessionProvider>;

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(SecureStore.getItemAsync).mockResolvedValue(null);
  jest.mocked(SecureStore.setItemAsync).mockResolvedValue(undefined);
  jest.mocked(SecureStore.deleteItemAsync).mockResolvedValue(undefined);
});

test('restores a saved token and does not create a second guest', async () => {
  jest.mocked(SecureStore.getItemAsync).mockResolvedValue('stored-token');
  jest.mocked(apiRequest).mockResolvedValue(profile);
  const { result } = renderHook(useGuestSession, { wrapper });

  await act(async () => result.current.ensureGuest());

  expect(result.current.status).toBe('ready');
  expect(result.current.token).toBe('stored-token');
  expect(apiRequest).toHaveBeenCalledWith('/v1/me', 'stored-token');
  expect(apiRequest).toHaveBeenCalledTimes(1);
  expect(apiRequest).not.toHaveBeenCalledWith('/v1/guest-sessions', undefined, { method: 'POST' });
});

test('a rejected token does not silently create another guest', async () => {
  jest.mocked(SecureStore.getItemAsync).mockResolvedValue('expired-token');
  jest.mocked(apiRequest).mockRejectedValue(Object.assign(new Error('invalid session'), { status: 401 }));
  const { result } = renderHook(useGuestSession, { wrapper });

  await act(async () => result.current.ensureGuest().catch(() => {}));

  expect(result.current.status).toBe('error');
  expect(result.current.canStartNew).toBe(true);
  expect(apiRequest).toHaveBeenCalledTimes(1);
  expect(apiRequest).toHaveBeenCalledWith('/v1/me', 'expired-token');
});

test('a network failure cannot be bypassed by starting a new guest', async () => {
  jest.mocked(SecureStore.getItemAsync).mockResolvedValue('stored-token');
  jest.mocked(apiRequest).mockRejectedValue(new Error('network unavailable'));
  const { result } = renderHook(useGuestSession, { wrapper });

  await act(async () => result.current.ensureGuest().catch(() => {}));

  expect(result.current.canStartNew).toBe(false);
  await expect(result.current.startNewGuest()).rejects.toThrow('only available after');
  expect(apiRequest).toHaveBeenCalledTimes(1);
});

test('a user can explicitly replace a rejected token with a new guest', async () => {
  jest.mocked(SecureStore.getItemAsync).mockResolvedValueOnce('expired-token').mockResolvedValue(null);
  jest.mocked(apiRequest)
    .mockRejectedValueOnce(Object.assign(new Error('invalid session'), { status: 401 }))
    .mockResolvedValueOnce({ access_token: 'new-token', user: profile });
  const { result } = renderHook(useGuestSession, { wrapper });
  await act(async () => result.current.ensureGuest().catch(() => {}));

  await act(async () => result.current.startNewGuest());

  expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(GUEST_TOKEN_KEY);
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith(GUEST_TOKEN_KEY, 'new-token');
  expect(result.current.status).toBe('ready');
  expect(result.current.token).toBe('new-token');
});
