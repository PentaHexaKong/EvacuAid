import { apiRequest } from '../profile/api';
import { buddyRequest } from './api';

jest.mock('../profile/api', () => ({ apiRequest: jest.fn() }));

test('a stalled Buddy request times out and releases its abort listener', async () => {
  jest.useFakeTimers();
  jest.mocked(apiRequest).mockImplementationOnce((_path, _token, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  }));
  const external = new AbortController();
  const remove = jest.spyOn(external.signal, 'removeEventListener');
  const pending = expect(buddyRequest('token', '/inbox', 'GET', undefined, external.signal)).rejects.toThrow('timed out');
  await jest.advanceTimersByTimeAsync(15000);
  await pending;
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  jest.useRealTimers();
});
