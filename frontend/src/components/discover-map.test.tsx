import { act, fireEvent, render } from '@testing-library/react-native';
import { DiscoverMap } from './discover-map.rnmaps';
import type { DiscoverMapProps } from './discover-map';

const mockFit = jest.fn();
const mockAnimate = jest.fn();
let mockReady: () => void;
let mockFail = false;
jest.mock('react-native-maps', () => {
  const React = jest.requireActual('react');
  const { View, Pressable, Text } = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: React.forwardRef(function MockMap({ onMapReady, children }: { onMapReady: () => void; children: React.ReactNode }, ref: React.Ref<unknown>) {
      React.useImperativeHandle(ref, () => ({ fitToCoordinates: mockFit, animateCamera: mockAnimate }));
      mockReady = onMapReady;
      if (mockFail) throw new Error('Map unavailable');
      return <View>{children}</View>;
    }),
    Polyline: ({ coordinates }: { coordinates: object[] }) => <View testID="route-line" coordinates={coordinates} />,
    Marker: ({ title, onPress }: { title: string; onPress: () => void }) => <Pressable accessibilityRole="button" onPress={onPress}><Text>{title}</Text></Pressable>,
  };
});
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => jest.requireActual('../localization/en.json')[key] ?? key }) }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { appOwnership: 'expo' } }));
const items: DiscoverMapProps['items'] = [{ id: 'rain', title: 'Rain', kind: 'alert', coordinate: { latitude: -6.26, longitude: 106.81 } }];
const insets = { onLocate: jest.fn(), topInset: 10, bottomInset: 20 };
const settle = () => act(() => { jest.advanceTimersByTime(150); });
beforeEach(() => { jest.clearAllMocks(); mockFail = false; jest.useFakeTimers(); });
afterEach(() => jest.useRealTimers());

test('marker taps select the matching item and a single item is centered', () => {
  const onSelect = jest.fn();
  const view = render(<DiscoverMap items={items} selected={null} onSelect={onSelect} {...insets} />);
  act(() => mockReady());
  settle();
  expect(mockAnimate).toHaveBeenLastCalledWith({ center: items[0].coordinate, zoom: 14 });
  fireEvent.press(view.getByText('Rain'));
  expect(onSelect).toHaveBeenCalledWith('rain');
  view.rerender(<DiscoverMap items={[]} selected={null} onSelect={onSelect} {...insets} />);
  expect(view.queryByText('Rain')).toBeNull();
});
test('several items fit inside the insets', () => {
  const two = [...items, { id: 'hall', title: 'Hall', kind: 'destination' as const, coordinate: { latitude: -6.27, longitude: 106.82 } }];
  render(<DiscoverMap items={two} selected={null} onSelect={jest.fn()} {...insets} />);
  act(() => mockReady());
  settle();
  expect(mockFit).toHaveBeenLastCalledWith([two[0].coordinate, two[1].coordinate], { edgePadding: { top: 50, right: 56, bottom: 76, left: 56 }, animated: true });
});
test('the route polyline renders only when a route is given', () => {
  const route: [number, number][] = [[106.81, -6.26], [106.82, -6.27]];
  const view = render(<DiscoverMap items={items} selected={null} onSelect={jest.fn()} {...insets} />);
  expect(view.queryByTestId('route-line')).toBeNull();
  view.rerender(<DiscoverMap items={items} selected={null} onSelect={jest.fn()} route={route} {...insets} />);
  expect(view.getByTestId('route-line')).toHaveProp('coordinates', [{ latitude: -6.26, longitude: 106.81 }, { latitude: -6.27, longitude: 106.82 }]);
});
test('the center button asks for the location until there is one', () => {
  const onLocate = jest.fn();
  const view = render(<DiscoverMap items={items} selected={null} onSelect={jest.fn()} {...insets} onLocate={onLocate} />);
  fireEvent.press(view.getByRole('button', { name: 'Center map on my location' }));
  expect(onLocate).toHaveBeenCalledTimes(1);
  view.rerender(<DiscoverMap items={items} selected={null} onSelect={jest.fn()} {...insets} onLocate={onLocate} userLocation={{ latitude: -6.3, longitude: 106.9 }} />);
  act(() => mockReady());
  settle();
  mockAnimate.mockClear();
  fireEvent.press(view.getByRole('button', { name: 'Center map on my location' }));
  expect(onLocate).toHaveBeenCalledTimes(1);
  expect(mockAnimate).toHaveBeenLastCalledWith({ center: { latitude: -6.3, longitude: 106.9 }, zoom: 14 });
});
test('map render errors explain the list fallback', () => {
  const error = jest.spyOn(console, 'error').mockImplementation(() => {});
  mockFail = true;
  const view = render(<DiscoverMap items={items} selected={null} onSelect={jest.fn()} {...insets} />);
  expect(view.getByText('The map is unavailable. All example items remain available in the list below.')).toBeTruthy();
  view.unmount();
  error.mockRestore();

});
test('a map that never becomes ready exposes the list fallback', () => {
  jest.useFakeTimers();
  const view = render(<DiscoverMap items={items} selected={null} onSelect={jest.fn()} {...insets} />);
  act(() => jest.advanceTimersByTime(12000));
  expect(view.getByRole('alert')).toBeTruthy();
  act(() => mockReady());
  settle();
  expect(view.queryByRole('alert')).toBeNull();
  view.unmount();
  jest.useRealTimers();
});
