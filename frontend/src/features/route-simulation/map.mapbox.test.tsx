import { act, fireEvent, render } from '@testing-library/react-native';
import { SimulationMap } from './map.mapbox';
import { selectRoute, graph, endpoints, presets } from './sample';
import { interpolate } from './routing';
import { colors } from '@/theme';

const mockFitBounds = jest.fn();
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
      React.useImperativeHandle(ref, () => ({ fitBounds: mockFitBounds }));
      return null;
    }),
    ShapeSource: ({ id, shape, children }: { id: string; shape: object; children: React.ReactNode }) => <View testID={`source-${id}`} shape={shape}>{children}</View>,
    LineLayer: ({ id, style }: { id: string; style: object }) => <View testID={`layer-${id}`} layerStyle={style} />,
    MarkerView: ({ coordinate, children }: { coordinate: number[]; children: React.ReactElement }) => React.cloneElement(children, { coordinate }),
  };
});
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, values?: Record<string, unknown>) => {
  let text = jest.requireActual('../../localization/en.json')[key] ?? key;
  for (const [name, value] of Object.entries(values ?? {})) text = text.replaceAll(`{{${name}}}`, String(value));
  return text;
} }) }));

const telemetryAtImport = [...(jest.requireMock('@rnmapbox/maps').default.setTelemetryEnabled as jest.Mock).mock.calls];
const origin = graph.nodes.find(n => n.id === endpoints.person)!.coordinate;
const result = selectRoute('shelter', 'nearest', 'clear');
const destination = graph.nodes.find(n => n.id === result.destination)!.coordinate;
const props = { origin, destination, traveller: origin, route: result.route, blocked: [] };

beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); mockFail = false; });
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

test('route geometry reaches Mapbox as [longitude, latitude] with a casing under the line', () => {
  if (!props.route.reachable) throw new Error('Expected a prepared route');
  const view = render(<SimulationMap {...props} />);
  expect(view.getByTestId('source-route')).toHaveProp('shape', expect.objectContaining({ geometry: { type: 'LineString', coordinates: props.route.geometry } }));
  expect(view.getByTestId('layer-route-casing')).toHaveProp('layerStyle', expect.objectContaining({ lineColor: colors.surface, lineWidth: 9 }));
  expect(view.getByTestId('layer-route-line')).toHaveProp('layerStyle', expect.objectContaining({ lineColor: colors.primary, lineWidth: 5 }));
  expect(view.getByTestId('origin')).toHaveProp('coordinate', origin);
  expect(view.getByTestId('destination')).toHaveProp('coordinate', destination);
  expect(view.getByRole('link')).toHaveTextContent(/OpenStreetMap/);
});

test('fits once when the map loads and does not recenter when the traveller moves', () => {
  if (!props.route.reachable) throw new Error('Expected a prepared route');
  const view = render(<SimulationMap {...props} />);
  expect(view.getByRole('button', { name: 'Fit route' })).toBeDisabled();
  fireEvent(view.getByTestId('mapbox-map'), 'didFinishLoadingMap');
  expect(mockFitBounds).toHaveBeenCalledTimes(1);
  const lons = props.route.geometry.map(p => p[0]);
  const lats = props.route.geometry.map(p => p[1]);
  expect(mockFitBounds).toHaveBeenLastCalledWith([Math.max(...lons) + 0.0004, Math.max(...lats) + 0.0004], [Math.min(...lons) - 0.0004, Math.min(...lats) - 0.0004], 48, 0);
  const traveller = interpolate(props.route.geometry, 0.5);
  view.rerender(<SimulationMap {...props} traveller={traveller} />);
  expect(view.getByTestId('traveller')).toHaveProp('coordinate', traveller);
  expect(mockFitBounds).toHaveBeenCalledTimes(1);
  fireEvent.press(view.getByRole('button', { name: 'Fit route' }));
  expect(mockFitBounds).toHaveBeenCalledTimes(2);
});

test('blocked edges are dashed and labelled; unreachable or degenerate routes render no route source', () => {
  const blocked = graph.edges.filter(edge => presets.shelter.blocked.includes(edge.id));
  const view = render(<SimulationMap {...props} route={selectRoute('shelter', 'nearest', 'blocked').route} blocked={blocked} />);
  expect(view.getByTestId('source-blocked')).toHaveProp('shape', expect.objectContaining({ features: expect.arrayContaining([expect.objectContaining({ id: blocked[0].id })]) }));
  expect((view.getByTestId('source-blocked').props.shape as { features: unknown[] }).features).toHaveLength(blocked.length);
  expect(view.getByTestId('layer-blocked-line')).toHaveProp('layerStyle', expect.objectContaining({ lineColor: colors.critical, lineDasharray: [2, 1] }));
  expect(view.getByText('Blocked 1')).toBeTruthy();
  view.rerender(<SimulationMap {...props} route={{ reachable: false }} blocked={blocked} />);
  expect(view.queryByTestId('source-route')).toBeNull();
  expect(view.getByTestId('destination')).toBeTruthy();
  view.rerender(<SimulationMap {...props} route={{ reachable: true, distance: 0, geometry: [origin], segments: [] }} blocked={[]} />);
  expect(view.queryByTestId('source-route')).toBeNull();
});

test('long press forwards [longitude, latitude]; the sample network shows only when selection is enabled', () => {
  const view = render(<SimulationMap {...props} network={graph.edges} />);
  expect(view.queryByTestId('source-network')).toBeNull();
  const onDestinationSelect = jest.fn();
  view.rerender(<SimulationMap {...props} network={graph.edges} onDestinationSelect={onDestinationSelect} />);
  expect((view.getByTestId('source-network').props.shape as { features: unknown[] }).features).toHaveLength(graph.edges.length);
  fireEvent(view.getByTestId('mapbox-map'), 'longPress', { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [106.814, -6.264] } });
  expect(onDestinationSelect).toHaveBeenCalledWith([106.814, -6.264]);
});

test('a style that fails to load shows the readable fallback and keeps attribution', () => {
  const view = render(<SimulationMap {...props} />);
  fireEvent(view.getByTestId('mapbox-map'), 'mapLoadingError');
  expect(view.getByRole('alert')).toHaveTextContent(/map is unavailable/);
  expect(view.queryByTestId('mapbox-map')).toBeNull();
  expect(view.getByRole('link')).toHaveTextContent(/OpenStreetMap/);
});

test('a render error shows the readable fallback', () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  mockFail = true;
  const view = render(<SimulationMap {...props} />);
  expect(view.getByRole('alert')).toHaveTextContent(/map is unavailable/);
});

test('a stalled map reports its limitation and recovers when loaded', () => {
  const view = render(<SimulationMap {...props} />);
  act(() => jest.advanceTimersByTime(12000));
  expect(view.getByRole('alert')).toHaveTextContent(/background map could not load/);
  fireEvent(view.getByTestId('mapbox-map'), 'didFinishLoadingMap');
  expect(view.queryByRole('alert')).toBeNull();
});

test('Mapbox usage telemetry is turned off before any map renders', () => {
  expect(telemetryAtImport).toEqual([[false]]);
});
