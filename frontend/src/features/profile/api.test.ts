describe('API network errors', () => {
  const oldApiUrl = process.env.EXPO_PUBLIC_API_BASE_URL;

  beforeEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
    process.env.EXPO_PUBLIC_API_BASE_URL = 'http://10.236.199.150:8000';
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(() => {
    if (oldApiUrl === undefined) delete process.env.EXPO_PUBLIC_API_BASE_URL;
    else process.env.EXPO_PUBLIC_API_BASE_URL = oldApiUrl;
  });

  test('turns native fetch failures into a clear network error', async () => {
    const originalCause = new Error('The network connection was lost');
    jest.spyOn(global, 'fetch').mockRejectedValue(originalCause);
    const { apiRequest } = require('./api') as typeof import('./api');

    await expect(apiRequest('/v1/me')).rejects.toMatchObject({
      kind: 'network',
      message: expect.stringContaining('Cannot reach EvacuAid API'),
      originalCause,
    });
  });
});
