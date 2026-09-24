import { act, fireEvent, render } from '@testing-library/react-native';
import { Platform } from 'react-native';
import Constants, { AppOwnership } from 'expo-constants';
import { SimulationMap } from './map.native';
import { selectRoute, graph, endpoints, presets } from './sample';
import { interpolate } from './routing';
import { colors } from '@/theme';
import { routeFromValhalla } from './valhalla';

const mockFit = jest.fn();
let mockFail = false;
jest.mock('heroui-native/card', () => {
  const { View } = jest.requireActual('react-native');
  return { Card: Object.assign(View, { Body: View }) };
});
jest.mock('expo-constants', () => ({ __esModule: true, default: { appOwnership: 'expo', expoConfig: { extra: { androidMapConfigured: false } } }, AppOwnership: { Expo: 'expo' } }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, values?: Record<string, unknown>) => {
  let text = jest.requireActual('../../localization/en.json')[key] ?? key;
  for (const [name, value] of Object.entries(values ?? {})) text = text.replaceAll(`{{${name}}}`, String(value));
  return text;
} }) }));
jest.mock('react-native-maps', () => {
  const { View } = jest.requireActual('react-native');
  const React = jest.requireActual('react');
  return { __esModule: true,
    default: React.forwardRef(function MockMap(props: object, ref: React.Ref<unknown>) {
      React.useImperativeHandle(ref, () => ({ fitToCoordinates: mockFit }));
      if (mockFail) throw new Error('Map unavailable');
      return <View testID="native-map" {...props} />;
    }),
    Marker: (props: { identifier: string }) => <View testID={props.identifier} {...props} />,
    Polyline: (props: { strokeColor: string }) => <View testID={`line-${props.strokeColor}`} {...props} />,
  };
});
const origin = graph.nodes.find(n => n.id === endpoints.person)!.coordinate;
const result = selectRoute('shelter', 'nearest', 'clear');
const destination = graph.nodes.find(n => n.id === result.destination)!.coordinate;
const props = { origin, destination, traveller: origin, route: result.route, blocked: [] };

beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); mockFail = false; Constants.appOwnership = AppOwnership.Expo; Constants.expoConfig!.extra!.androidMapConfigured = false; });
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

test.each(['ios', 'android'] as const)('Expo Go on %s displays graph coordinates without requesting location or a map token', platform => {
  jest.replaceProperty(Platform, 'OS', platform);
  const view = render(<SimulationMap {...props} />);
  expect(view.getByTestId('native-map')).toHaveProp('showsUserLocation', false);
  expect(view.getByTestId('native-map')).toHaveProp('showsMyLocationButton', false);
  expect(view.getByTestId('origin')).toHaveProp('coordinate', { latitude: origin[1], longitude: origin[0] });
  expect(view.getByTestId('destination')).toHaveProp('coordinate', { latitude: destination[1], longitude: destination[0] });
  expect(view.getByRole('link')).toHaveTextContent(/OpenStreetMap/);
  expect(view.getByText(/bundled walking graph works offline/)).toBeTruthy();
  expect(view.queryByRole('alert')).toBeNull();
});

test('route geometry and traveller updates retain coordinate order and do not recenter the camera', () => {
  const view = render(<SimulationMap {...props} />);
  if (!props.route.reachable) throw new Error('Expected a prepared route');
  expect(view.getByTestId(`line-${colors.primary}`)).toHaveProp('coordinates', props.route.geometry.map(([longitude, latitude]) => ({ latitude, longitude })));
  expect(view.getByRole('button', { name: 'Fit route' })).toBeDisabled();
  fireEvent(view.getByTestId('native-map'), 'mapReady');
  expect(mockFit).toHaveBeenCalledTimes(1);
  expect(mockFit).toHaveBeenLastCalledWith(expect.any(Array), { animated: false, edgePadding: { top: 48, right: 48, bottom: 48, left: 48 } });
  const traveller = interpolate(props.route.geometry, 0.5);
  view.rerender(<SimulationMap {...props} traveller={traveller} />);
  expect(view.getByTestId('traveller')).toHaveProp('coordinate', { latitude: traveller[1], longitude: traveller[0] });
  expect(mockFit).toHaveBeenCalledTimes(1);
  fireEvent.press(view.getByRole('button', { name: 'Fit route' }));
  expect(mockFit).toHaveBeenCalledTimes(2);
});

test('blocked paths use dashed segments and visible labels; unreachable routes remove the active line', () => {
  const blocked = graph.edges.filter(edge => presets.shelter.blocked.includes(edge.id));
  const view = render(<SimulationMap {...props} route={selectRoute('shelter', 'nearest', 'blocked').route} blocked={blocked} />);
  expect(view.getAllByTestId(`line-${colors.critical}`)).toHaveLength(blocked.length);
  expect(view.getAllByTestId(`line-${colors.critical}`)[0]).toHaveProp('lineDashPattern', [12, 6]);
  expect(view.getByText('Blocked 1')).toBeTruthy();
  view.rerender(<SimulationMap {...props} route={{ reachable: false }} blocked={blocked} />);
  expect(view.queryByTestId(`line-${colors.primary}`)).toBeNull();
  expect(view.getByTestId('destination')).toBeTruthy();
});

test('unconfigured standalone Android falls back while configured Android displays the map', () => {
  jest.replaceProperty(Platform, 'OS', 'android');
  Constants.appOwnership = null;
  const view = render(<SimulationMap {...props} />);
  expect(view.getByRole('alert')).toHaveTextContent(/map is unavailable/);
  Constants.expoConfig!.extra!.androidMapConfigured = true;
  view.rerender(<SimulationMap {...props} />);
  expect(view.getByTestId('native-map')).toBeTruthy();
});

test('map render failure leaves a readable fallback and attribution', () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  mockFail = true;
  const view = render(<SimulationMap {...props} />);
  expect(view.getByRole('alert')).toHaveTextContent(/map is unavailable/);
  expect(view.getByRole('link')).toHaveTextContent(/OpenStreetMap/);
});

test('a stalled map reports its limitation and recovers when ready', () => {
  const view = render(<SimulationMap {...props} />);
  act(() => jest.advanceTimersByTime(12000));
  expect(view.getByRole('alert')).toHaveTextContent(/background map could not load/);
  fireEvent(view.getByTestId('native-map'), 'mapReady');
  expect(view.queryByRole('alert')).toBeNull();
});

test('long press forwards longitude and latitude and shows the selectable sample network', () => {
  const onDestinationSelect = jest.fn();
  const view = render(<SimulationMap {...props} network={graph.edges} onDestinationSelect={onDestinationSelect} />);
  expect(view.getAllByTestId(`line-${colors.muted}`)).toHaveLength(graph.edges.length);
  fireEvent(view.getByTestId('native-map'), 'longPress', { nativeEvent: { coordinate: { latitude: -6.264, longitude: 106.814 } } });
  expect(onDestinationSelect).toHaveBeenCalledWith([106.814, -6.264]);
});

test('Valhalla geometry renders without sample edges and allows coordinate selection without a sample overlay', () => {
  const route = routeFromValhalla({ trip: { status: 0, units: 'kilometers', summary: { length: 0.157, time: 131 }, legs: [{ shape: '~me}J_ehvjEn}@o}@', maneuvers: [{ begin_shape_index: 0, end_shape_index: 1, length: 0.157 }] }] } });
  if (!route.reachable) throw new Error('Expected route');
  const onDestinationSelect = jest.fn();
  const view = render(<SimulationMap origin={route.geometry[0]} destination={route.geometry.at(-1)} traveller={interpolate(route.geometry, 0.5)} route={route} blocked={[]} onDestinationSelect={onDestinationSelect} />);
  expect(view.queryByTestId(`line-${colors.muted}`)).toBeNull();
  expect(view.getByTestId(`line-${colors.primary}`)).toHaveProp('coordinates', [{ longitude: 106.812, latitude: -6.262 }, { longitude: 106.813, latitude: -6.263 }]);
  fireEvent(view.getByTestId('native-map'), 'longPress', { nativeEvent: { coordinate: { latitude: -7, longitude: 110 } } });
  expect(onDestinationSelect).toHaveBeenCalledWith([110, -7]);
});
