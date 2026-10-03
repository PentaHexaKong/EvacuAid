type Engine = typeof import('./map-engine');

function load(appOwnership: string | null, env: { token?: string; style?: string }): Engine {
  let engine!: Engine;
  jest.isolateModules(() => {
    process.env.EXPO_PUBLIC_MAPBOX_TOKEN = env.token ?? '';
    process.env.EXPO_PUBLIC_MAPBOX_STYLE_URL = env.style ?? '';
    jest.doMock('expo-constants', () => ({ __esModule: true, default: { appOwnership } }));
    engine = require('./map-engine');
  });
  return engine;
}

afterEach(() => {
  delete process.env.EXPO_PUBLIC_MAPBOX_TOKEN;
  delete process.env.EXPO_PUBLIC_MAPBOX_STYLE_URL;
});

test('Expo Go never uses Mapbox, even with a token', () => {
  expect(load('expo', { token: 'pk.abc' }).usesMapbox()).toBe(false);
});

test('a dev build with a public token uses Mapbox', () => {
  expect(load(null, { token: 'pk.abc' }).usesMapbox()).toBe(true);
});

test.each(['', '   '])('a dev build without a token (%j) falls back to react-native-maps', token => {
  expect(load(null, { token }).usesMapbox()).toBe(false);
});

test('a secret token is never accepted at runtime', () => {
  const engine = load(null, { token: 'sk.secret' });
  expect(engine.mapboxToken()).toBeUndefined();
  expect(engine.usesMapbox()).toBe(false);
});

test('the token is trimmed', () => {
  expect(load(null, { token: '  pk.abc \n' }).mapboxToken()).toBe('pk.abc');
});

test('style URL falls back to Mapbox Standard and honours an override', () => {
  expect(load(null, {}).mapboxStyleUrl()).toBe('mapbox://styles/mapbox/standard');
  expect(load(null, { style: ' mapbox://styles/team/custom ' }).mapboxStyleUrl()).toBe('mapbox://styles/team/custom');
});
