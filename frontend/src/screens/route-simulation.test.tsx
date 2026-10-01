import { act, fireEvent, render } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { RouteSimulationScreen } from './route-simulation';
import RouteSimulationPage from '@/app/route-simulation';
import { SimulationMap } from '@/features/route-simulation/map';
import { endpoints, graph } from '@/features/route-simulation/sample';
import { PreferencesPreview } from '@/features/preferences/context';
import { defaults } from '@/features/preferences/storage';

jest.mock('expo-router', () => ({
  Redirect: () => null,
  useFocusEffect: (effect: () => (() => void)) => jest.requireActual('react').useEffect(effect, [effect]),
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, values?: Record<string, unknown>) => {
  let text = jest.requireActual('../localization/en.json')[key] ?? key;
  for (const [name, value] of Object.entries(values ?? {})) text = text.replaceAll(`{{${name}}}`, String(value));
  return text;
} }) }));
jest.mock('@/features/route-simulation/map', () => ({ SimulationMap: jest.fn(() => null) }));

beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); Object.defineProperty(AppState, 'currentState', { value: 'active', writable: true }); });
afterEach(() => jest.useRealTimers());

const mapProps = () => jest.mocked(SimulationMap).mock.calls.at(-1)![0];

test('destination, preset, and scenario changes reset playback; explicit unreachable destination persists and clears the route', () => {
  const view = render(<RouteSimulationScreen />);
  expect(view.getByRole('radio', { name: /Nearest reachable/ })).toHaveProp('accessibilityState', { checked: true });
  fireEvent.press(view.getByRole('button', { name: 'Play' }));
  act(() => jest.advanceTimersByTime(5000));
  expect(mapProps().traveller).not.toEqual(mapProps().origin);
  fireEvent.press(view.getByRole('radio', { name: /Community hall/ }));
  expect(mapProps().traveller).toEqual(mapProps().origin);
  expect(view.getByText('Paused')).toBeTruthy();
  const destination = mapProps().destination;
  fireEvent.press(view.getByRole('radio', { name: /Access cut off/ }));
  expect(mapProps().route).toEqual({ reachable: false });
  expect(mapProps().destination).toEqual(destination);
  expect(view.getByRole('radio', { name: /Community hall/ })).toHaveProp('accessibilityState', { checked: true });
  expect(view.getByRole('button', { name: 'Play' })).toBeDisabled();
  expect(view.getByText('No active route segments.')).toBeTruthy();
  fireEvent.press(view.getByRole('radio', { name: /Blocked path/ }));
  expect(mapProps().route.reachable).toBe(true);
  expect(mapProps().traveller).toEqual(mapProps().origin);
  fireEvent.press(view.getByRole('button', { name: 'Play' }));
  act(() => jest.advanceTimersByTime(2000));
  fireEvent.press(view.getByRole('radio', { name: /Buddy to requester/ }));
  expect(mapProps().traveller).toEqual(mapProps().origin);
  expect(view.queryByRole('radio', { name: /Community hall/ })).toBeNull();
  expect(view.getByText('Paused')).toBeTruthy();
  view.unmount();
});

test('completion only reports simulation complete and reset makes replay possible', () => {
  const view = render(<PreferencesPreview preferences={{ ...defaults, completed: true, largerText: true, strongerContrast: true }}><RouteSimulationScreen /></PreferencesPreview>);
  expect(view.getByText('Route simulation')).toHaveStyle({ fontSize: 33.6 });
  fireEvent.press(view.getByRole('button', { name: 'Play' }));
  act(() => jest.advanceTimersByTime(30000));
  expect(view.getByText('Simulation complete')).toBeTruthy();
  expect(mapProps().traveller).toEqual(mapProps().destination);
  expect(view.getByRole('button', { name: 'Play' })).toBeDisabled();
  fireEvent.press(view.getByRole('button', { name: 'Reset' }));
  expect(view.getByRole('button', { name: 'Play' })).not.toBeDisabled();
  expect(mapProps().traveller).toEqual(mapProps().origin);
  expect(endpoints.person).not.toBe(endpoints.buddy);
});

test('direct page access renders no simulation in production', () => {
  const previous = __DEV__;
  try {
    (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
    const view = render(<RouteSimulationPage />);
    expect(view.queryByText('Route simulation')).toBeNull();
    expect(SimulationMap).not.toHaveBeenCalled();
  } finally { (globalThis as unknown as { __DEV__: boolean }).__DEV__ = previous; }
});

test('a long-pressed destination recalculates, resets playback, survives restrictions, and can be replaced by a shelter', () => {
  const view = render(<RouteSimulationScreen />);
  const initialRoute = mapProps().route;
  if (!initialRoute.reachable) throw new Error('Expected initial route');
  const target = graph.nodes.find(node => node.id === initialRoute.segments[3].to)!;
  fireEvent.press(view.getByRole('button', { name: 'Play' }));
  act(() => jest.advanceTimersByTime(5000));
  act(() => mapProps().onDestinationSelect!([target.coordinate[0], target.coordinate[1] + 0.000001]));
  expect(mapProps().destination).toEqual(target.coordinate);
  expect(mapProps().traveller).toEqual(mapProps().origin);
  expect(view.getByText('Paused')).toBeTruthy();
  expect(view.getByRole('radio', { name: /Selected map destination/ })).toHaveProp('accessibilityState', { checked: true });
  const route = mapProps().route;
  if (!route.reachable) throw new Error('Expected custom route');
  expect(route.geometry.at(-1)).toEqual(target.coordinate);
  expect(route.distance).toBeLessThan(initialRoute.distance);
  fireEvent.press(view.getByRole('radio', { name: /Access cut off/ }));
  expect(mapProps().destination).toEqual(target.coordinate);
  expect(mapProps().route).toEqual({ reachable: false });
  expect(view.getByRole('button', { name: 'Play' })).toBeDisabled();
  act(() => mapProps().onDestinationSelect!([0, 0]));
  expect(view.getByRole('alert', { name: /No sample routing point/ })).toBeTruthy();
  expect(mapProps().destination).toEqual(target.coordinate);
  fireEvent.press(view.getByRole('radio', { name: /Community hall/ }));
  expect(mapProps().destination).toEqual(graph.nodes.find(node => node.id === endpoints.hall)!.coordinate);
  expect(view.queryByRole('radio', { name: /Selected map destination/ })).toBeNull();
  expect(view.queryByText(/No sample routing point/)).toBeNull();
});

test('buddy mode accepts a picked requester location and the example destination can be restored', () => {
  const view = render(<RouteSimulationScreen />);
  const target = graph.nodes.find(node => node.id === endpoints.center)!;
  act(() => mapProps().onDestinationSelect!(target.coordinate));
  fireEvent.press(view.getByRole('radio', { name: /Buddy to requester/ }));
  expect(mapProps().destination).toEqual(graph.nodes.find(node => node.id === endpoints.person)!.coordinate);
  act(() => mapProps().onDestinationSelect!(target.coordinate));
  expect(mapProps().destination).toEqual(target.coordinate);
  expect(mapProps().route.reachable).toBe(true);
  fireEvent.press(view.getByRole('button', { name: 'Use example destination' }));
  expect(mapProps().destination).toEqual(graph.nodes.find(node => node.id === endpoints.person)!.coordinate);
});

test('selecting the origin shows already at destination without a stationary playback', () => {
  const view = render(<RouteSimulationScreen />);
  act(() => mapProps().onDestinationSelect!(mapProps().origin));
  expect(view.getByText('Already at the selected routing point.')).toBeTruthy();
  expect(view.getByRole('button', { name: 'Play' })).toBeDisabled();
  expect(mapProps().route).toMatchObject({ reachable: true, distance: 0 });
});
