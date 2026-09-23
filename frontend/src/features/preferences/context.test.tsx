import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { PreferencesProvider, usePreferences } from './context';
import { defaults, parsePreferences, PREFERENCES_KEY } from './storage';

beforeEach(async () => { jest.restoreAllMocks(); await AsyncStorage.clear(); });
test('new and corrupt storage start with optional setup and no preferences', () => {
  for (const value of [null, '{', '{}', '{"completed":"true"}']) expect(parsePreferences(value)).toEqual(defaults);
});
test('completion and multiple preferences persist across launches', async () => {
  const first = renderHook(usePreferences, { wrapper: PreferencesProvider });
  await waitFor(() => expect(first.result.current.ready).toBe(true));
  const value = { ...defaults, completed: true, largerText: true, strongerContrast: true };
  await act(async () => first.result.current.save(value));
  first.unmount();
  const second = renderHook(usePreferences, { wrapper: PreferencesProvider });
  await waitFor(() => expect(second.result.current.ready).toBe(true));
  expect(second.result.current.preferences).toEqual(value);
});
test('skipping can persist completion without enabling any preference', async () => {
  const { result } = renderHook(usePreferences, { wrapper: PreferencesProvider });
  await waitFor(() => expect(result.current.ready).toBe(true));
  await act(async () => result.current.save({ ...defaults, completed: true }));
  expect(parsePreferences(await AsyncStorage.getItem(PREFERENCES_KEY))).toEqual({ ...defaults, completed: true });
});
test('failed saves keep setup incomplete and expose an error for retry', async () => {
  const { result } = renderHook(usePreferences, { wrapper: PreferencesProvider });
  await waitFor(() => expect(result.current.ready).toBe(true));
  jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('storage'));
  await act(async () => { await expect(result.current.save({ ...defaults, completed: true })).rejects.toThrow('storage'); });
  expect(result.current.preferences.completed).toBe(false);
});
test('read failure still finishes hydration', async () => {
  jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('storage'));
  const { result } = renderHook(usePreferences, { wrapper: PreferencesProvider });
  await waitFor(() => expect(result.current.ready).toBe(true));
  expect(result.current.preferences).toEqual(defaults);
});
test('logging out restores setup on the next launch without clearing support preferences', async () => {
  await AsyncStorage.setItem(PREFERENCES_KEY, JSON.stringify({ completed: true, largerText: true, strongerContrast: true }));
  const first = renderHook(usePreferences, { wrapper: PreferencesProvider });
  await waitFor(() => expect(first.result.current.ready).toBe(true));
  await act(async () => first.result.current.save({ ...first.result.current.preferences, completed: false }));
  expect(first.result.current.preferences.completed).toBe(false);
  first.unmount();
  const next = renderHook(usePreferences, { wrapper: PreferencesProvider });
  await waitFor(() => expect(next.result.current.ready).toBe(true));
  expect(next.result.current.preferences).toEqual({ ...defaults, completed: false, largerText: true, strongerContrast: true });
});
