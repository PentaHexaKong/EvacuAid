import { LANGUAGE_KEY, loadLanguage, persistLanguage, resolveLanguage } from './language';
import en from './en.json';
import id from './id.json';

test('uses saved preference, then supported device language, then Indonesian', () => {
  expect(resolveLanguage('id', ['en'])).toBe('id');
  expect(resolveLanguage(null, ['fr', 'en'])).toBe('en');
  expect(resolveLanguage('invalid', [null, 'fr'])).toBe('id');
});
test('persists selection and restores it on a later launch', async () => {
  let saved: string | null = null;
  const storage = { getItem: jest.fn(async () => saved), setItem: jest.fn(async (_key: string, value: string) => { saved = value; }) };
  await persistLanguage(storage, 'id');
  expect(storage.setItem).toHaveBeenCalledWith(LANGUAGE_KEY, 'id');
  expect(await loadLanguage(storage, ['en'])).toBe('id');
});
test('handles unreadable storage and exposes save failures', async () => {
  const storage = { getItem: jest.fn().mockRejectedValue(new Error('read')), setItem: jest.fn().mockRejectedValue(new Error('write')) };
  expect(await loadLanguage(storage, ['en'])).toBe('en');
  await expect(persistLanguage(storage, 'id')).rejects.toThrow('write');
});
test('both locales contain every preview message and matching interpolation fields', () => {
  expect(Object.keys(id).sort()).toEqual(Object.keys(en).sort());
  for (const key of Object.keys(en) as (keyof typeof en)[]) {
    expect(id[key].length).toBeGreaterThan(0);
    expect(id[key].match(/{{.*?}}/g)).toEqual(en[key].match(/{{.*?}}/g));
  }
});
