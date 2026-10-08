import { act, fireEvent, render } from '@testing-library/react-native';
import { Dimensions } from 'react-native';
import { DiscoverMap } from './discover-map.mapbox';
import { boundsCenter, focusCorners, visibleBounds } from './map-framing';
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
    LineLayer: ({ id, style }: { id: string; style: object }) => <View testID={id} layerStyle={style} />,
    UserTrackingMode: { Follow: 'normal', FollowWithHeading: 'compass' },
    FillLayer: ({ id }: { id: string }) => <View testID={id} />,
    CircleLayer: ({ id, ...props }: { id: string; style: object }) => <View testID={id} {...props} />,
    StyleImport: ({ config }: { config: object }) => <View testID="style-import" config={config} />,
    RasterDemSource: ({ children }: { children: React.ReactNode }) => <View testID="dem">{children}</View>,
    Terrain: () => <View testID="terrain" />,
    MarkerView: ({ coordinate, children }: { coordinate: number[]; children: React.ReactElement }) => { mockMarkerRenders += 1; return React.cloneElement(children, { coordinate }); },
  };
});
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => jest.requireActual('../localization/en.json')[key] ?? key }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 10, bottom: 34, left: 0, right: 0 }) }));

const telemetryAtImport = [...(jest.requireMock('@rnmapbox/maps').default.setTelemetryEnabled as jest.Mock).mock.calls];
const rain: DiscoverMapProps['items'][number] = { id: 'rain', title: 'Rain', kind: 'alert', coordinate: { latitude: -6.26, longitude: 106.81 } };
const hall: DiscoverMapProps['items'][number] = { id: 'hall', title: 'Hall', kind: 'destination', coordinate: { latitude: -6.27, longitude: 106.82 } };
const insets = { onLocate: jest.fn(), topInset: 10, bottomInset: 20 };
const frameInsets = { top: 50, right: 56, bottom: 76, left: 56 };
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
test('a person marker renders their name and initials and frames them with the native puck', () => {
  const onSelect = jest.fn();
  const person = { id: 'person', title: 'Test Person', kind: 'person' as const, initials: 'TP', coordinate: { latitude: -6.28, longitude: 106.83 } };
  const view = render(<DiscoverMap items={[hall, person, rain]} selected={null} onSelect={onSelect} {...insets} userLocation={{ latitude: -6.3, longitude: 106.9 }} />);
  expect(view.getByText('TP')).toBeTruthy();
  expect(view.getByTestId('location-puck')).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: 'Test Person' }));
  expect(onSelect).toHaveBeenCalledWith('person');
  settle();
  expect(mockCameraProps).toEqual(expect.objectContaining({ bounds: expectedBounds([[106.9, -6.3], [106.82, -6.27], [106.83, -6.28]]) }));
});

test('credits follow their inset without changing camera framing and default to the framing inset', () => {
  const props = { ...insets, bottomInset: 400, items: [rain, hall], selected: null, onSelect: jest.fn() };
  const view = render(<DiscoverMap {...props} creditsInset={200} />);
  settle();
  const bounds = mockCameraProps.bounds;
  expect(view.getByTestId('mapbox-map')).toHaveProp('logoPosition', { left: 12, bottom: 208 - 34 });
  expect(view.getByTestId('mapbox-map')).toHaveProp('attributionPosition', { left: 100, bottom: 208 - 34 });
  view.rerender(<DiscoverMap {...props} creditsInset={100} />);
  settle();
  expect(mockCameraProps.bounds).toBe(bounds);
  expect(view.getByTestId('mapbox-map')).toHaveProp('logoPosition', { left: 12, bottom: 108 - 34 });
  view.rerender(<DiscoverMap {...props} />);
  expect(view.getByTestId('mapbox-map')).toHaveProp('logoPosition', { left: 12, bottom: 408 - 34 });
});

test('3D shelter pins float over a ground shadow; alerts and the flat map have none', () => {
  const school = { ...hall, id: 'school', title: 'School', coordinate: { latitude: -6.28, longitude: 106.83 } };
  const props = { ...insets, items: [rain, hall, school], onSelect: jest.fn(), selected: 'school' };
  const view = render(<DiscoverMap {...props} mode="3d" />);
  const shape = view.getByTestId('shelter-shadows').props.shape;
  expect(shape.features.map((feature: { id: string; geometry: object }) => [feature.id, feature.geometry])).toEqual([['hall', { type: 'Point', coordinates: [106.82, -6.27] }], ['school', { type: 'Point', coordinates: [106.83, -6.28] }]]);
  expect(view.getByTestId('shelter-shadow')).toHaveProp('style', expect.objectContaining({ circlePitchAlignment: 'map' }));
  fireEvent.press(view.getByRole('button', { name: 'Hall' }));
  expect(props.onSelect).toHaveBeenCalledWith('hall');
  expect(view.getByRole('button', { name: 'School' })).toHaveProp('accessibilityState', { selected: true });
  expect(view.getByRole('button', { name: 'Rain' })).toBeTruthy();
  view.rerender(<DiscoverMap {...props} mode="2d" />);
  expect(view.queryByTestId('shelter-shadows')).toBeNull();
  expect(view.getByRole('button', { name: 'School' })).toBeTruthy();
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

test('3D tilts the camera over terrain and raises buildings; 2D lays everything flat', () => {
  const onToggleMode = jest.fn();
  const view = render(<DiscoverMap items={[rain]} selected={null} onSelect={jest.fn()} {...insets} mode="3d" onToggleMode={onToggleMode} />);
  fireEvent(view.getByTestId('mapbox-map'), 'didFinishLoadingMap');
  settle();
  // Tilted, the camera pivots on the flat view's center instead of fitting bounds into the trapezoid.
  expect(mockCameraProps).toEqual(expect.objectContaining({ pitch: 45, ...boundsCenter(expectedBounds([[106.81, -6.26]]), Dimensions.get('window').width) }));
  expect(mockCameraProps.bounds).toBeUndefined();
  expect(view.getByTestId('mapbox-map')).toHaveProp('pitchEnabled', true);
  expect(view.getByTestId('terrain')).toBeTruthy();
  expect(view.getByTestId('style-import')).toHaveProp('config', expect.objectContaining({ show3dObjects: true, showPointOfInterestLabels: false }));
  fireEvent.press(view.getByRole('button', { name: 'Show flat map' }));
  expect(onToggleMode).toHaveBeenCalledTimes(1);
  view.rerender(<DiscoverMap items={[rain]} selected={null} onSelect={jest.fn()} {...insets} mode="2d" onToggleMode={onToggleMode} />);
  expect(mockCameraProps).toEqual(expect.objectContaining({ pitch: 0 }));
  expect(view.getByTestId('mapbox-map')).toHaveProp('pitchEnabled', false);
  expect(view.queryByTestId('terrain')).toBeNull();
  expect(view.getByTestId('style-import')).toHaveProp('config', expect.objectContaining({ show3dObjects: false }));
  expect(view.getByRole('button', { name: 'Show 3D map' })).toBeTruthy();
});

test('impact zones draw as a fill and an outline only when there are zones', () => {
  const zone = { type: 'Feature' as const, id: 'q-0', properties: { hazard: 'flood' as const, ring: 'core' as const }, geometry: { type: 'Polygon' as const, coordinates: [[[106.8, -6.2], [106.81, -6.2], [106.8, -6.21], [106.8, -6.2]] as [number, number][]] } };
  const view = render(<DiscoverMap items={[rain]} selected={null} onSelect={jest.fn()} {...insets} zones={{ type: 'FeatureCollection', features: [] }} />);
  expect(view.queryByTestId('hazard-zones')).toBeNull();
  view.rerender(<DiscoverMap items={[rain]} selected={null} onSelect={jest.fn()} {...insets} zones={{ type: 'FeatureCollection', features: [zone] }} />);
  expect(view.getByTestId('hazard-zones')).toHaveProp('shape', { type: 'FeatureCollection', features: [zone] });
  expect(view.getByTestId('hazard-zone-fill')).toBeTruthy();
  expect(view.getByTestId('hazard-zone-line')).toBeTruthy();
});

test('center and zoom describe the same view as the bounds', () => {
  const bounds = visibleBounds([[106.8, -6.2], [106.82, -6.25]], { top: 50, right: 56, bottom: 460, left: 56 }, { width: 400, height: 870 });
  const { centerCoordinate, zoomLevel } = boundsCenter(bounds, 400);
  expect(512 * 2 ** zoomLevel * (bounds.ne[0] - bounds.sw[0]) / 360).toBeCloseTo(400, 6);
  expect(centerCoordinate[0]).toBeCloseTo((bounds.ne[0] + bounds.sw[0]) / 2, 9);
  expect(centerCoordinate[1]).toBeGreaterThan(bounds.sw[1]);
  expect(centerCoordinate[1]).toBeLessThan(bounds.ne[1]);
});

test('a focus frames that place instead of the user, and the center button hands control back', () => {
  const onLocate = jest.fn();
  const focus = { latitude: -0.88, longitude: 134.16, spanKm: 15 };
  const view = render(<DiscoverMap items={[rain]} selected={null} onSelect={jest.fn()} {...insets} onLocate={onLocate} userLocation={{ latitude: -6.3, longitude: 106.9 }} focus={focus} />);
  fireEvent(view.getByTestId('mapbox-map'), 'didFinishLoadingMap');
  settle();
  const corners = focusCorners(focus);
  // 15 km is about 0.135 degrees at the equator: the box really surrounds the epicentre.
  expect(corners[0][1]).toBeCloseTo(-0.88 - 0.1347, 3);
  expect(corners[1][0]).toBeCloseTo(134.16 + 0.1348, 3);
  expect(mockCameraProps).toEqual(expect.objectContaining({ bounds: expectedBounds(corners) }));
  mockSetCamera.mockClear();
  fireEvent.press(view.getByRole('button', { name: 'Center map on my location' }));
  expect(onLocate).toHaveBeenCalledTimes(1);
  expect(mockSetCamera).not.toHaveBeenCalled();
  // An evacuation route is never displaced by a focus.
  const route: [number, number][] = [[106.9, -6.3], [106.95, -6.32]];
  view.rerender(<DiscoverMap items={[rain]} selected={null} onSelect={jest.fn()} {...insets} onLocate={onLocate} userLocation={{ latitude: -6.3, longitude: 106.9 }} focus={focus} route={route} />);
  settle();
  expect(mockCameraProps).toEqual(expect.objectContaining({ bounds: expectedBounds(route) }));
  view.rerender(<DiscoverMap items={[rain]} selected={null} onSelect={jest.fn()} {...insets} onLocate={onLocate} userLocation={{ latitude: -6.3, longitude: 106.9 }} focus={null} />);
  settle();
  expect(mockCameraProps).toEqual(expect.objectContaining({ bounds: expectedBounds([[106.9, -6.3]]) }));
});

test('turn-by-turn follows the walker with a tilted heading-up camera and no framing bounds', () => {
  const onFollowChange = jest.fn();
  const map = (follow: boolean) => <SystemReduceMotionContext.Provider value={false}><DiscoverMap items={[]} selected={null} onSelect={jest.fn()} {...insets} userLocation={{ latitude: -6.26, longitude: 106.81 }} follow={follow} onFollowChange={onFollowChange} /></SystemReduceMotionContext.Provider>;
  const view = render(map(true));
  expect(mockCameraProps).toEqual(expect.objectContaining({ followUserLocation: true, followUserMode: 'compass', followPitch: 50, followZoomLevel: 17.5 }));
  expect(mockCameraProps.bounds).toBeUndefined();
  act(() => { (mockCameraProps.onUserTrackingModeChange as (event: object) => void)({ nativeEvent: { payload: { followUserLocation: false } } }); });
  expect(onFollowChange).toHaveBeenCalledWith(false);
  view.rerender(map(false));
  expect(mockCameraProps.followUserLocation).toBe(false);
  expect(mockCameraProps.bounds).toBeUndefined();
});

test('Reduce Motion keeps the follow camera flat and north-up, and the walked stretch of the route is hidden', () => {
  const view = render(<SystemReduceMotionContext.Provider value><DiscoverMap items={[]} selected={null} onSelect={jest.fn()} {...insets} route={[[106.8, -6.2], [106.81, -6.21]]} follow walked={0.4} /></SystemReduceMotionContext.Provider>);
  expect(mockCameraProps).toEqual(expect.objectContaining({ followUserMode: 'normal', followPitch: 0 }));
  expect(view.getByTestId('evacuation-route-line')).toHaveProp('layerStyle', expect.objectContaining({ lineTrimOffset: [0, 0.4] }));
  expect(view.getByTestId('evacuation-route-casing')).toHaveProp('layerStyle', expect.objectContaining({ lineTrimOffset: [0, 0.4] }));
});
