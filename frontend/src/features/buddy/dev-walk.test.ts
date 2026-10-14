import { buddyRequest } from './api';
import { startDevWalk } from './dev-walk';

jest.mock('./api', () => ({ buddyRequest: jest.fn() }));
const request = buddyRequest as jest.Mock;

const step = (progress: number) => ({ walk: { origin: { latitude: -6.2, longitude: 106.8 }, geometry: [[106.8, -6.2], [106.803, -6.2]], distanceM: 300, progress, latitude: -6.2, longitude: 106.8 + 0.003 * progress, destination: { latitude: -6.2, longitude: 106.803 } } });

beforeEach(() => { jest.useFakeTimers(); request.mockReset(); });
afterEach(() => jest.useRealTimers());

test('walks from 0 to 1 in steps, sending the first origin back so the route stays put', async () => {
  request.mockImplementation((_token, _path, _method, body: { progress: number }) => Promise.resolve(step(body.progress)));
  const onStep = jest.fn();
  const done = startDevWalk('token', 'session-1', onStep);
  await jest.runAllTimersAsync();
  await done;
  const bodies = request.mock.calls.map(call => call[3] as { progress: number; latitude?: number });
  expect(bodies[0]).toEqual({ progress: 0 });
  expect(bodies.at(-1)).toEqual({ progress: 1, latitude: -6.2, longitude: 106.8 });
  expect(bodies.map(body => body.progress)).toEqual([...bodies.map(body => body.progress)].sort((x, y) => x - y));
  expect(request).toHaveBeenCalledWith('token', '/dev/requests/session-1/simulate-walk', 'POST', expect.anything());
  expect(onStep).toHaveBeenCalledTimes(bodies.length);
});

test('a failed step stops the walk and can be started again', async () => {
  request.mockRejectedValueOnce(new Error('no known position to start from'));
  await expect(startDevWalk('token', 'session-1', jest.fn())).rejects.toThrow('no known position');
  request.mockImplementation((_token, _path, _method, body: { progress: number }) => Promise.resolve(step(body.progress)));
  const again = startDevWalk('token', 'session-1', jest.fn());
  await jest.runAllTimersAsync();
  await again;
  expect(request.mock.calls.length).toBeGreaterThan(2);
});

test('starts from the phone position when it has one', async () => {
  request.mockImplementation((_token, _path, _method, body: { progress: number; latitude?: number; longitude?: number }) => Promise.resolve({ walk: { ...step(body.progress).walk, origin: { latitude: body.latitude, longitude: body.longitude } } }));
  const done = startDevWalk('token', 'session-2', jest.fn(), { latitude: -6.3, longitude: 106.9 });
  await jest.runAllTimersAsync();
  await done;
  expect(request.mock.calls[0][3]).toEqual({ progress: 0, latitude: -6.3, longitude: 106.9 });
});
