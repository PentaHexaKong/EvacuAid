import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { OfflineRegionsScreen } from './offline-regions';
import { fixtureManifest } from '@/features/offline/test-fixture';
import * as packages from '@/features/offline/package-manager';
const mockTranslate = (key: string) => key;

jest.mock('@/features/offline/package-manager', () => ({
  installedPackages: jest.fn(), discoverRegions: jest.fn(),
  storageUsage: jest.fn().mockResolvedValue({ bytes: 100 }), loadPackage: jest.fn(),
  installPackage: jest.fn(), cancelDownload: jest.fn(), deletePackage: jest.fn(), rollbackPackage: jest.fn(),
}));
jest.mock('@react-native-community/netinfo', () => ({ __esModule: true, default: { addEventListener: () => () => {} } }));
jest.mock('@/features/profile/context', () => ({ useProfile: () => ({ accessibility: [{ type: 'VISUAL_IMPAIRMENT' }, { type: 'MOBILITY_LIMITATION' }] }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockTranslate }) }));
jest.mock('@/features/offline/offline-map', () => ({ OfflineMap: () => null }));
jest.mock('@/components/ui', () => {
  const React = require('react');
  const { Text, View, Pressable } = require('react-native');
  return {
    Page: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
    AppText: ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>,
    ActionButton: ({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) => <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress}><Text>{label}</Text></Pressable>,
  };
});
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(packages.installedPackages).mockResolvedValue([{ manifest: fixtureManifest(), directory: 'file:///fixture/' }]);
  jest.mocked(packages.loadPackage).mockResolvedValue({ streets: { features: [] }, boundary: {}, coverage: {}, shelters: [], hazards: [], cachedRoutes: [] });
});
test('installed public data remains available when synchronization cannot reach the server', async () => {
  jest.mocked(packages.discoverRegions).mockRejectedValue(new Error('offline'));
  const view = render(<OfflineRegionsScreen />);
  await waitFor(() => expect(view.getByText('offlineSyncUnavailable')).toBeTruthy());
  expect(view.getByText('Public test fixture')).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: 'offlineOpenMap' }));
  await waitFor(() => expect(packages.loadPackage).toHaveBeenCalled());
  expect(packages.installPackage).not.toHaveBeenCalled();
});
test('update discovery does not automatically download or replace an active map', async () => {
  jest.mocked(packages.discoverRegions).mockResolvedValue([{ regionId: fixtureManifest().regionId, regionName: 'Public test fixture', buildStatus: 'READY', manifest: fixtureManifest('b') }]);
  const view = render(<OfflineRegionsScreen />);
  await waitFor(() => expect(view.getByRole('button', { name: 'offlineUpdate' })).toBeTruthy());
  expect(packages.installPackage).not.toHaveBeenCalled();
});
