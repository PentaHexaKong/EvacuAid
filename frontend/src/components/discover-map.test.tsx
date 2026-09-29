import { act, fireEvent, render } from '@testing-library/react-native';
import { DiscoverMap } from './discover-map.rnmaps';
import type { DiscoverMapProps } from './discover-map';

const mockFit = jest.fn();
let mockReady: () => void;
let mockFail = false;
jest.mock('react-native-maps', () => {
  const React = jest.requireActual('react');
  const { View, Pressable, Text } = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: React.forwardRef(function MockMap({ onMapReady, children }: { onMapReady: () => void; children: React.ReactNode }, ref: React.Ref<unknown>) {
      React.useImperativeHandle(ref, () => ({ fitToCoordinates: mockFit }));
      mockReady = onMapReady;
      if (mockFail) throw new Error('Map unavailable');
      return <View>{children}</View>;
    }),
    Marker: ({ title, onPress }: { title: string; onPress: () => void }) => <Pressable accessibilityRole="button" onPress={onPress}><Text>{title}</Text></Pressable>,
  };
});
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => jest.requireActual('../localization/en.json')[key] ?? key }) }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { appOwnership: 'expo' } }));
jest.mock('heroui-native/card', () => ({ Card: jest.requireActual('react-native').View }));
const items: DiscoverMapProps['items'] = [{ id: 'rain', title: 'Rain', kind: 'alert', coordinate: { latitude: -6.26, longitude: 106.81 } }];
beforeEach(() => { jest.clearAllMocks(); mockFail = false; });

test('native fit uses only filtered coordinates and marker taps select the matching card', () => {
  const onSelect = jest.fn();
  const view = render(<DiscoverMap items={items} selected={null} onSelect={onSelect} />);
  act(() => mockReady());
  fireEvent.press(view.getByRole('button', { name: 'Show all filtered markers' }));
  expect(mockFit).toHaveBeenLastCalledWith([items[0].coordinate], expect.objectContaining({ animated: false }));
  fireEvent.press(view.getByText('Rain'));
  expect(onSelect).toHaveBeenCalledWith('rain');
  view.rerender(<DiscoverMap items={[]} selected={null} onSelect={onSelect} />);
  expect(view.getByRole('button', { name: 'Show all filtered markers' })).toBeDisabled();
  expect(view.queryByText('Rain')).toBeNull();
});
test('map render errors explain the list fallback', () => {
  const error = jest.spyOn(console, 'error').mockImplementation(() => {});
  mockFail = true;
  const view = render(<DiscoverMap items={items} selected={null} onSelect={jest.fn()} />);
  expect(view.getByText('The map is unavailable. All example items remain available in the list below.')).toBeTruthy();
  view.unmount();
  error.mockRestore();

});
test('a map that never becomes ready exposes the list fallback', () => {
  jest.useFakeTimers();
  const view = render(<DiscoverMap items={items} selected={null} onSelect={jest.fn()} />);
  act(() => jest.advanceTimersByTime(12000));
  expect(view.getByRole('alert')).toBeTruthy();
  act(() => mockReady());
  expect(view.queryByRole('alert')).toBeNull();
  view.unmount();
  jest.useRealTimers();
});
