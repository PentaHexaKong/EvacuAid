function load(appOwnership: string | null, token: string) {
  let selected: unknown;
  jest.isolateModules(() => {
    process.env.EXPO_PUBLIC_MAPBOX_TOKEN = token;
    jest.doMock('expo-constants', () => ({ __esModule: true, default: { appOwnership } }));
    jest.doMock('./map.rnmaps', () => ({ SimulationMap: 'rnmaps' }));
    jest.doMock('./map.mapbox', () => (appOwnership === 'expo' || !token ? (() => { throw new Error('Mapbox module evaluated'); })() : { SimulationMap: 'mapbox' }));
    selected = require('./map.native').SimulationMap;
  });
  return selected;
}

afterEach(() => { delete process.env.EXPO_PUBLIC_MAPBOX_TOKEN; });

test('Expo Go uses react-native-maps and never evaluates the Mapbox module', () => {
  expect(load('expo', 'pk.abc')).toBe('rnmaps');
});

test('a dev build without a token uses react-native-maps and never evaluates the Mapbox module', () => {
  expect(load(null, '')).toBe('rnmaps');
});

test('a dev build with a public token uses Mapbox', () => {
  expect(load(null, 'pk.abc')).toBe('mapbox');
});
