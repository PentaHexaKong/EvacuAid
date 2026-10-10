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

  test('never shows a validation error list as text', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 422, json: async () => ({ detail: [{ loc: ['body', 'observedAt'], msg: 'too old' }] }) } as unknown as Response);
    const { apiRequest } = require('./api') as typeof import('./api');

    await expect(apiRequest('/v1/me')).rejects.toMatchObject({ kind: 'http', status: 422, message: 'Request failed (422)' });
  });

  test('an authenticated 401 refreshes once and retries with the new bearer',async()=>{
    const fetcher=jest.spyOn(global,'fetch').mockResolvedValueOnce({ok:false,status:401} as Response)
      .mockResolvedValueOnce({ok:true,status:200,json:async()=>({id:'user-1'})} as Response);
    const {apiRequest,configureAuthRecovery}=require('./api') as typeof import('./api');
    const refresh=jest.fn().mockResolvedValue('new-token');
    configureAuthRecovery({current:async token=>token,refresh});
    await expect(apiRequest('/v1/me','old-token')).resolves.toEqual({id:'user-1'});
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[1][1]?.headers).toMatchObject({Authorization:'Bearer new-token'});
  });

  test('a repeated 401 does not loop, and a 403 never refreshes',async()=>{
    const fetcher=jest.spyOn(global,'fetch').mockResolvedValue({ok:false,status:401,json:async()=>({detail:'Invalid credentials'})} as Response);
    const {apiRequest,configureAuthRecovery}=require('./api') as typeof import('./api');
    const refresh=jest.fn().mockResolvedValue('new-token');configureAuthRecovery({current:async token=>token,refresh});
    await expect(apiRequest('/v1/me','old-token')).rejects.toMatchObject({status:401});
    expect(fetcher).toHaveBeenCalledTimes(2);expect(refresh).toHaveBeenCalledTimes(1);
    fetcher.mockResolvedValue({ok:false,status:403,json:async()=>({detail:'Not authorized'})} as Response);
    await expect(apiRequest('/v1/users/other','new-token')).rejects.toMatchObject({status:403});
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test('failed login never invokes access-token recovery',async()=>{
    jest.spyOn(global,'fetch').mockResolvedValue({ok:false,status:401,json:async()=>({detail:'Invalid credentials'})} as Response);
    const {apiRequest,configureAuthRecovery}=require('./api') as typeof import('./api');
    const refresh=jest.fn();configureAuthRecovery({current:async token=>token,refresh});
    await expect(apiRequest('/v1/auth/login',undefined,{method:'POST',body:'{}'})).rejects.toMatchObject({status:401});
    expect(refresh).not.toHaveBeenCalled();
  });
});
