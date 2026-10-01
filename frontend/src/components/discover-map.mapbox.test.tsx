import { act, fireEvent, render } from '@testing-library/react-native';
import { Dimensions } from 'react-native';
import { DiscoverMap } from './discover-map.mapbox';
import { visibleBounds } from './map-framing';
import type { DiscoverMapProps } from './discover-map';
import { SystemReduceMotionContext } from '@/theme';

const mockFitBounds = jest.fn();
const mockSetCamera = jest.fn();
let mockFail = false;
let mockMarkerRenders = 0;
let mockCameraProps: Record<string, unknown> = {};
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
    Camera: React.forwardRef(function MockCamera(props: Record<string, unknown>, ref: React.Ref<unknown>) {
      mockCameraProps = props;
      React.useImperativeHandle(ref, () => ({ fitBounds: mockFitBounds, setCamera: mockSetCamera }));
      return null;
    }),
    LocationPuck: () => <View testID="location-puck" />,
    ShapeSource: ({ id, shape, children }: { id: string; shape: object; children: React.ReactNode }) => <View testID={id} shape={shape}>{children}</View>,
    LineLayer: ({ id }: { id: string }) => <View testID={id} />,
    MarkerView: ({ coordinate, children }: { coordinate: number[]; children: React.ReactElement }) => { mockMarkerRenders += 1; return React.cloneElement(children, { coordinate }); },
  };
});
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => jest.requireActual('../localization/en.json')[key] ?? key }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 10, bottom: 0, left: 0, right: 0 }) }));

const telemetryAtImport = [...(jest.requireMock('@rnmapbox/maps').default.setTelemetryEnabled as jest.Mock).mock.calls];
const rain: DiscoverMapProps['items'][number] = { id: 'rain', title: 'Rain', kind: 'alert', coordinate: { latitude: -6.26, longitude: 106.81 } };
const hall: DiscoverMapProps['items'][number] = { id: 'hall', title: 'Hall', kind: 'destination', coordinate: { latitude: -6.27, longitude: 106.82 } };
const insets = { onLocate: jest.fn(), topInset: 10, bottomInset: 20 };
const frameInsets = { top: 106, right: 56, bottom: 76, left: 56 };
const expectedBounds = (points: [number, number][]) => visibleBounds(points, frameInsets, Dimensions.get('window'));
const noPadding = { paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0 };
const settle = () => act(() => { jest.advanceTimersByTime(150); });
beforeEach(() => { jest.clearAllMocks(); mockFail = false; jest.useFakeTimers(); });
afterEach(() => jest.useRealTimers());

test('markers use [longitude, latitude] and tapping one selects it', () => {
  const onSelect = jest.fn();
  const view = render(<DiscoverMap items={[rain]} selected={null} onSelect={onSelect} {...insets} />);
  expect(view.getByRole('button', { name: 'Rain' })).toHaveProp('coordinate', [106.81, -6.26]);
  fireEvent.press(view.getByRole('button', { name: 'Rain' }));
  expect(onSelect).toHaveBeenCalledWith('rain');
});

test('items fit their bounds inside the sheet and header insets; no items leaves the camera alone', () => {
  const view = render(<DiscoverMap items={[rain, hall]} selected={null} onSelect={jest.fn()} {...insets} />);
  fireEvent(view.getByTestId('mapbox-map'), 'didFinishLoadingMap');
  settle();
  expect(mockCameraProps).toEqual(expect.objectContaining({ bounds: expectedBounds([[106.81, -6.26], [106.82, -6.27]]), padding: noPadding, animationDuration: 400 }));
  view.rerender(<DiscoverMap items={[rain]} selected={null} onSelect={jest.fn()} {...insets} />);
  settle();
  expect(mockCameraProps).toEqual(expect.objectContaining({ bounds: expectedBounds([[106.81, -6.26]]) }));
  view.rerender(<DiscoverMap items={[]} selected={null} onSelect={jest.fn()} {...insets} />);
  settle();
  expect(mockCameraProps).toEqual(expect.objectContaining({ bounds: undefined }));
  expect(view.queryByRole('button', { name: 'Rain' })).toBeNull();
  expect(view.queryByRole('button', { name: 'Show all filtered markers' })).toBeNull();
});

test('the route draws as a casing and a line only when a route is given', () => {
  const route: [number, number][] = [[106.81, -6.26], [106.82, -6.27]];
  const view = render(<DiscoverMap items={[rain]} selected={null} onSelect={jest.fn()} {...insets} />);
  expect(view.queryByTestId('evacuation-route')).toBeNull();
  expect(view.queryByTestId('evacuation-route-line')).toBeNull();
  view.rerender(<DiscoverMap items={[rain]} selected={null} onSelect={jest.fn()} route={route} {...insets} />);
  expect(view.getByTestId('evacuation-route')).toHaveProp('shape', { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: route } });
  expect(view.getByTestId('evacuation-route-casing')).toBeTruthy();
  expect(view.getByTestId('evacuation-route-line')).toBeTruthy();
});

test('a route is framed with the insets as padding', () => {
  const route: [number, number][] = [[106.81, -6.26], [106.82, -6.27]];
  const view = render(<DiscoverMap items={[]} selected={null} onSelect={jest.fn()} route={route} {...insets} />);
  fireEvent(view.getByTestId('mapbox-map'), 'didFinishLoadingMap');
  settle();
  expect(mockCameraProps).toEqual(expect.objectContaining({ bounds: expectedBounds(route), padding: noPadding }));
});

test('the center button asks for the location until there is one, then recenters on it', () => {
  const onLocate = jest.fn();
  const view = render(<DiscoverMap items={[rain]} selected={null} onSelect={jest.fn()} {...insets} onLocate={onLocate} />);
  expect(view.queryByTestId('location-puck')).toBeNull();
  fireEvent.press(view.getByRole('button', { name: 'Center map on my location' }));
  expect(onLocate).toHaveBeenCalledTimes(1);
  view.rerender(<DiscoverMap items={[rain]} selected={null} onSelect={jest.fn()} {...insets} onLocate={onLocate} userLocation={{ latitude: -6.3, longitude: 106.9 }} />);
  expect(view.getByTestId('location-puck')).toBeTruthy();
  fireEvent(view.getByTestId('mapbox-map'), 'didFinishLoadingMap');
  mockSetCamera.mockClear();
  fireEvent.press(view.getByRole('button', { name: 'Center map on my location' }));
  expect(onLocate).toHaveBeenCalledTimes(1);
  expect(mockSetCamera).toHaveBeenLastCalledWith({ bounds: expectedBounds([[106.9, -6.3]]), padding: noPadding, animationDuration: 400 });
});

test('a style that fails to load shows the list fallback', () => {
  const view = render(<DiscoverMap items={[rain]} selected={null} onSelect={jest.fn()} {...insets} />);
  fireEvent(view.getByTestId('mapbox-map'), 'mapLoadingError');
  expect(view.getByText('The map is unavailable. All example items remain available in the list below.')).toBeTruthy();
});

test('a render error shows the list fallback', () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  mockFail = true;
  const view = render(<DiscoverMap items={[rain]} selected={null} onSelect={jest.fn()} {...insets} />);
  expect(view.getByText('The map is unavailable. All example items remain available in the list below.')).toBeTruthy();
});

test('a map that never loads exposes the list fallback until it does', () => {
  jest.useFakeTimers();
  const view = render(<DiscoverMap items={[rain]} selected={null} onSelect={jest.fn()} {...insets} />);
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

test('drawing the route re-renders only the route layers, not the markers', () => {
  const many = Array.from({ length: 10 }, (_, index) => ({ ...hall, id: `s${index}`, title: `S${index}` }));
  const route: [number, number][] = [[106.81, -6.26], [106.82, -6.27]];
  const tree = (withRoute: boolean) => <SystemReduceMotionContext.Provider value={false}><DiscoverMap items={many} selected={null} onSelect={jest.fn()} {...insets} route={withRoute ? route : undefined} /></SystemReduceMotionContext.Provider>;
  const view = render(tree(false));
  mockMarkerRenders = 0;
  view.rerender(tree(true));
  for (let frame = 0; frame < 60; frame += 1) act(() => { jest.advanceTimersByTime(16); });
  expect(mockMarkerRenders).toBeLessThanOrEqual(many.length * 2);
});

test('framed points land inside the area left visible by the header and the sheet', () => {
  const mercator = (latitude: number) => Math.log(Math.tan(Math.PI / 4 + (latitude * Math.PI) / 360));
  const radians = (longitude: number) => (longitude * Math.PI) / 180;
  const size = { width: 400, height: 870 };
  const cases: [number, number][][] = [
    [[106.8, -6.2], [106.802, -6.201]],
    [[106.79, -6.215], [106.815, -6.195], [106.8, -6.18]],
    [[106.75, -6.2], [106.85, -6.201]],
    [[106.8, -6.2]],
  ];
  for (const points of cases) {
    const { ne, sw } = visibleBounds(points, { top: 150, right: 56, bottom: 460, left: 56 }, size);
    const scale = Math.min(size.width / (radians(ne[0]) - radians(sw[0])), size.height / (mercator(ne[1]) - mercator(sw[1])));
    const centerX = (radians(ne[0]) + radians(sw[0])) / 2;
    const centerY = (mercator(ne[1]) + mercator(sw[1])) / 2;
    for (const [longitude, latitude] of points) {
      const x = size.width / 2 + (radians(longitude) - centerX) * scale;
      const y = size.height / 2 - (mercator(latitude) - centerY) * scale;
      expect(x).toBeGreaterThanOrEqual(56 - 0.5);
      expect(x).toBeLessThanOrEqual(size.width - 56 + 0.5);
      expect(y).toBeGreaterThanOrEqual(150 - 0.5);
      expect(y).toBeLessThanOrEqual(size.height - 460 + 0.5);
    }
  }
});

test('retrying after a load failure brings the map back', () => {
  const view = render(<DiscoverMap items={[rain]} selected={null} onSelect={jest.fn()} {...insets} />);
  fireEvent(view.getByTestId('mapbox-map'), 'mapLoadingError');
  expect(view.queryByTestId('mapbox-map')).toBeNull();
  fireEvent.press(view.getByRole('button', { name: 'Try again' }));
  expect(view.getByTestId('mapbox-map')).toBeTruthy();
});

test('retrying after a render error remounts the map once it can render', () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  mockFail = true;
  const view = render(<DiscoverMap items={[rain]} selected={null} onSelect={jest.fn()} {...insets} />);
  expect(view.queryByTestId('mapbox-map')).toBeNull();
  mockFail = false;
  fireEvent.press(view.getByRole('button', { name: 'Try again' }));
  expect(view.getByTestId('mapbox-map')).toBeTruthy();
});
