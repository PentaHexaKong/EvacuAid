import { apiRequest } from '@/features/profile/api';
import { fetchAlerts } from './api';

jest.mock('@/features/profile/api', () => ({ apiRequest: jest.fn() }));
test('fetches with guest token and maps only location-required conflicts', async () => {
  const data = { items: [], location: { observedAt: null } };
  jest.mocked(apiRequest).mockResolvedValueOnce(data);
  await expect(fetchAlerts('guest')).resolves.toEqual({ status: 'ready', data });
  expect(apiRequest).toHaveBeenCalledWith('/v1/alerts', 'guest');
  jest.mocked(apiRequest).mockRejectedValueOnce(Object.assign(new Error('location required'), { status: 409 }));
  await expect(fetchAlerts('guest')).resolves.toEqual({ status: 'no-location' });
  const other = Object.assign(new Error('other conflict'), { status: 409 });
  jest.mocked(apiRequest).mockRejectedValueOnce(other);
  await expect(fetchAlerts('guest')).rejects.toBe(other);
});
