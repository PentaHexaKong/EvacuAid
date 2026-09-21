import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { parseProfile, PROFILE_KEY, ProfileProvider, useProfile } from './context';

beforeEach(async () => { jest.restoreAllMocks(); await AsyncStorage.clear(); });
test('missing, malformed, wrong-type and oversized names fall back to empty', () => {
  for (const value of [null, '{', '{}', 'null', '{"name":5}', JSON.stringify({ name: 'a'.repeat(61) }), JSON.stringify({ name: 'Two\nlines' })]) expect(parseProfile(value)).toBe('');
  expect(parseProfile('{"name":"  Billy  "}')).toBe('Billy');
});
test('name saves are trimmed, survive remount, and can be cleared', async () => {
  const first = renderHook(useProfile, { wrapper: ProfileProvider });
  await waitFor(() => expect(first.result.current.ready).toBe(true));
  await act(async () => first.result.current.saveName('  Billy  '));
  first.unmount();
  const second = renderHook(useProfile, { wrapper: ProfileProvider });
  await waitFor(() => expect(second.result.current.ready).toBe(true));
  expect(second.result.current.name).toBe('Billy');
  await act(async () => second.result.current.saveName('   '));
  expect(second.result.current.name).toBe('');
  expect(await AsyncStorage.getItem(PROFILE_KEY)).toBe('{"name":""}');
});
test('failed saves keep the previous name and read failures finish hydration', async () => {
  jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('storage'));
  const view = renderHook(useProfile, { wrapper: ProfileProvider });
  await waitFor(() => expect(view.result.current.ready).toBe(true));
  await act(async () => view.result.current.saveName('Billy'));
  jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('storage'));
  await act(async () => { await expect(view.result.current.saveName('New')).rejects.toThrow('storage'); });
  expect(view.result.current.name).toBe('Billy');
});
