import { render, fireEvent } from '@testing-library/react-native';
import { OfflineMap } from './offline-map';
import { fixtureManifest } from './test-fixture';

jest.mock('@/components/ui', () => {
  const React = require('react');
  const { Pressable, Text } = require('react-native');
  return {
    AppText: ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>,
    ActionButton: ({ label, onPress }: { label: string; onPress: () => void }) => <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}><Text>{label}</Text></Pressable>,
  };
});
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
test('renders local streets, coverage and GPS with interactive zoom without network calls', () => {
  const fetch = jest.spyOn(global, 'fetch');
  const polygon = { geometry: { type: 'Polygon', coordinates: [[[106, -7], [107, -7], [107, -6], [106, -7]]] } };
  const view = render(<OfflineMap manifest={fixtureManifest()} position={{ latitude: -6.5, longitude: 106.5 }} onShelter={jest.fn()} data={{
    streets: { features: [{ geometry: { type: 'LineString', coordinates: [[106, -7], [107, -6]] } }] },
    boundary: polygon, coverage: polygon, hazards: [], shelters: [], cachedRoutes: [],
  }} />);
  fireEvent.press(view.getByRole('button', { name: 'offlineZoomIn' }));
  fireEvent.press(view.getByRole('button', { name: 'offlineResetMap' }));
  expect(fetch).not.toHaveBeenCalled();
  expect(view.getByText('Public test fixture')).toBeTruthy();
  fetch.mockRestore();
});
