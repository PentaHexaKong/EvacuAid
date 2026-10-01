import type * as NavigationApi from './api';

describe('navigation api', () => {
  const oldApiUrl = process.env.EXPO_PUBLIC_API_BASE_URL;
  const origin = { latitude: -6.26, longitude: 106.81, accuracyM: 12, observedAt: '2026-09-17T01:00:00.000Z' };

  function load() {
    return require('./api') as typeof NavigationApi;
  }

  beforeEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
    process.env.EXPO_PUBLIC_API_BASE_URL = 'http://api.test';
  });

  afterAll(() => {
    if (oldApiUrl === undefined) delete process.env.EXPO_PUBLIC_API_BASE_URL;
    else process.env.EXPO_PUBLIC_API_BASE_URL = oldApiUrl;
  });

  describe('toCoordinates', () => {
    test('returns the coordinates of a LineString', () => {
      expect(load().toCoordinates({ type: 'LineString', coordinates: [[106.81, -6.26], [106.82, -6.27, 5]] })).toEqual([[106.81, -6.26], [106.82, -6.27]]);
    });

    test('rejects other geometry types', () => {
      expect(() => load().toCoordinates({ type: 'Point', coordinates: [[1, 2], [3, 4]] })).toThrow('not a LineString');
      expect(() => load().toCoordinates(null)).toThrow('not a LineString');
    });

    test('rejects lines with fewer than two coordinates', () => {
      expect(() => load().toCoordinates({ type: 'LineString', coordinates: [[1, 2]] })).toThrow('not a LineString');
    });

    test('rejects non-finite coordinates', () => {
      expect(() => load().toCoordinates({ type: 'LineString', coordinates: [[1, 2], [Number.NaN, 4]] })).toThrow('invalid coordinate');
      expect(() => load().toCoordinates({ type: 'LineString', coordinates: [[1, 2], [3, Infinity]] })).toThrow('invalid coordinate');
      expect(() => load().toCoordinates({ type: 'LineString', coordinates: [[1, 2], ['3', 4]] })).toThrow('invalid coordinate');
    });
  });

  test('nearbyShelters queries by position, a 10 km radius and 10 results without a token', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
    await expect(load().nearbyShelters({ latitude: -6.26, longitude: 106.81 })).resolves.toEqual([]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('http://api.test/v1/shelters/nearby?latitude=-6.26&longitude=106.81&radiusM=10000&limit=10');
    expect((init?.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  test('requestRoute posts the origin as JSON with the bearer token', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ routeStatus: 'READY' }), { status: 200 }));
    await load().requestRoute({ userId: 'u1', origin, destinationShelterId: 's1' }, 'token-1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('http://api.test/v1/navigation/routes');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer token-1', 'Content-Type': 'application/json' });
    expect(JSON.parse(String(init?.body))).toEqual({ userId: 'u1', origin, destinationShelterId: 's1' });
  });

  test('an aborted request rejects with the original AbortError', async () => {
    const abort = Object.assign(new Error('Aborted'), { name: 'AbortError' });
    jest.spyOn(global, 'fetch').mockRejectedValue(abort);
    const controller = new AbortController();
    controller.abort();
    const rejection = await load().nearbyShelters({ latitude: 1, longitude: 2 }, controller.signal).catch((error: unknown) => error);
    expect(rejection).toBe(abort);
    expect((rejection as Error).name).toBe('AbortError');
    expect(rejection).not.toHaveProperty('kind');
  });
});
