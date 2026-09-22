jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

import { clearSession, loadSession, saveSession } from './storage';

const mockSecureStore = jest.requireMock('expo-secure-store') as {
  getItemAsync: jest.Mock; setItemAsync: jest.Mock; deleteItemAsync: jest.Mock;
};

beforeEach(() => jest.clearAllMocks());

test('reads only a complete session from secure storage', async () => {
  mockSecureStore.getItemAsync.mockResolvedValueOnce(JSON.stringify({ accessToken: 'access', refreshToken: 'refresh' }));
  await expect(loadSession()).resolves.toEqual({ accessToken: 'access', refreshToken: 'refresh' });
  mockSecureStore.getItemAsync.mockResolvedValueOnce(JSON.stringify({ accessToken: 'access' }));
  await expect(loadSession()).resolves.toBeNull();
});

test('writes and clears the opaque session in secure storage', async () => {
  await saveSession({ accessToken: 'access', refreshToken: 'refresh' });
  expect(mockSecureStore.setItemAsync).toHaveBeenCalledWith('evacuaid.auth.session.v1', JSON.stringify({ accessToken: 'access', refreshToken: 'refresh' }));
  await clearSession();
  expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledWith('evacuaid.auth.session.v1');
});
