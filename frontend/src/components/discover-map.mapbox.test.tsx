import { act, fireEvent, render } from '@testing-library/react-native';
import { DiscoverMap } from './discover-map.mapbox';
import type { DiscoverMapProps } from './discover-map';

const mockFitBounds = jest.fn();
const mockSetCamera = jest.fn();
let mockFail = false;
jest.mock('@rnmapbox/maps', () => {
  const React = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: { setAccessToken: jest.fn(() => Promise.resolve(null)), setTelemetryEnabled: jest.fn() },
    MapView: (props: object) => {
      if (mockFail) throw new Error('Map unavailable');
      return <View testID="mapbox-map" {...props} />;
    },
    Camera: React.forwardRef(function MockCamera(_props: object, ref: React.Ref<unknown>) {
      React.useImperativeHandle(ref, () => ({ fitBounds: mockFitBounds, setCamera: mockSetCamera }));
      return null;
    }),
    MarkerView: ({ coordinate, children }: { coordinate: number[]; children: React.ReactElement }) => React.cloneElement(children, { coordinate }),
  };
});
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => jest.requireActual('../localization/en.json')[key] ?? key }) }));
jest.mock('heroui-native/card', () => ({ Card: jest.requireActual('react-native').View }));

const telemetryAtImport = [...(jest.requireMock('@rnmapbox/maps').default.setTelemetryEnabled as jest.Mock).mock.calls];
const rain: DiscoverMapProps['items'][number] = { id: 'rain', title: 'Rain', kind: 'alert', coordinate: { latitude: -6.26, longitude: 106.81 } };
const hall: DiscoverMapProps['items'][number] = { id: 'hall', title: 'Hall', kind: 'destination', coordinate: { latitude: -6.27, longitude: 106.82 } };
beforeEach(() => { jest.clearAllMocks(); mockFail = false; });

test('markers use [longitude, latitude] and tapping one selects it', () => {
  const onSelect = jest.fn();
  const view = render(<DiscoverMap items={[rain]} selected={null} onSelect={onSelect} />);
  expect(view.getByRole('button', { name: 'Rain' })).toHaveProp('coordinate', [106.81, -6.26]);
  fireEvent.press(view.getByRole('button', { name: 'Rain' }));
  expect(onSelect).toHaveBeenCalledWith('rain');
});

test('several items fit their bounds; one item centers on it; no items disables fitting', () => {
  const view = render(<DiscoverMap items={[rain, hall]} selected={null} onSelect={jest.fn()} />);
  fireEvent(view.getByTestId('mapbox-map'), 'didFinishLoadingMap');
  expect(mockFitBounds).toHaveBeenLastCalledWith([106.82, -6.26], [106.81, -6.27], 48, 0);
  view.rerender(<DiscoverMap items={[rain]} selected={null} onSelect={jest.fn()} />);
  expect(mockSetCamera).toHaveBeenLastCalledWith({ centerCoordinate: [106.81, -6.26], zoomLevel: 15, animationDuration: 0 });
  view.rerender(<DiscoverMap items={[]} selected={null} onSelect={jest.fn()} />);
  expect(view.getByRole('button', { name: 'Show all filtered markers' })).toBeDisabled();
  expect(view.queryByRole('button', { name: 'Rain' })).toBeNull();
});

test('a style that fails to load shows the list fallback', () => {
  const view = render(<DiscoverMap items={[rain]} selected={null} onSelect={jest.fn()} />);
  fireEvent(view.getByTestId('mapbox-map'), 'mapLoadingError');
  expect(view.getByText('The map is unavailable. All example items remain available in the list below.')).toBeTruthy();
});

test('a render error shows the list fallback', () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  mockFail = true;
  const view = render(<DiscoverMap items={[rain]} selected={null} onSelect={jest.fn()} />);
  expect(view.getByText('The map is unavailable. All example items remain available in the list below.')).toBeTruthy();
});

test('a map that never loads exposes the list fallback until it does', () => {
  jest.useFakeTimers();
  const view = render(<DiscoverMap items={[rain]} selected={null} onSelect={jest.fn()} />);
  act(() => jest.advanceTimersByTime(12000));
  expect(view.getByRole('alert')).toBeTruthy();
  fireEvent(view.getByTestId('mapbox-map'), 'didFinishLoadingMap');
  expect(view.queryByRole('alert')).toBeNull();
  jest.useRealTimers();
});

describe('selector', () => {
  function load(appOwnership: string | null, token: string) {
    let selected: unknown;
    jest.isolateModules(() => {
      process.env.EXPO_PUBLIC_MAPBOX_TOKEN = token;
      jest.doMock('expo-constants', () => ({ __esModule: true, default: { appOwnership } }));
      jest.doMock('./discover-map.rnmaps', () => ({ DiscoverMap: 'rnmaps' }));
      jest.doMock('./discover-map.mapbox', () => (appOwnership === 'expo' || !token ? (() => { throw new Error('Mapbox module evaluated'); })() : { DiscoverMap: 'mapbox' }));
      selected = require('./discover-map.native').DiscoverMap;
    });
    return selected;
  }
  afterEach(() => { delete process.env.EXPO_PUBLIC_MAPBOX_TOKEN; });
  test('Expo Go uses react-native-maps without evaluating Mapbox', () => expect(load('expo', 'pk.abc')).toBe('rnmaps'));
  test('a dev build without a token uses react-native-maps', () => expect(load(null, '')).toBe('rnmaps'));
  test('a dev build with a public token uses Mapbox', () => expect(load(null, 'pk.abc')).toBe('mapbox'));
});

test('Mapbox usage telemetry is turned off before any map renders', () => {
  expect(telemetryAtImport).toEqual([[false]]);
});
