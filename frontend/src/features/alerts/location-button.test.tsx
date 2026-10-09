import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import * as Location from 'expo-location';
import { AlertLocationButton } from './location-button';

const mockSaveLocation = jest.fn();
jest.mock('@/features/profile/context', () => ({ useProfile: () => ({ saveLocation: mockSaveLocation, accessibility: [] }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('expo-location', () => ({ Accuracy: { Balanced: 3 }, requestForegroundPermissionsAsync: jest.fn(), getCurrentPositionAsync: jest.fn() }));
beforeEach(() => { jest.clearAllMocks(); });
afterEach(() => { jest.restoreAllMocks(); });

test('saving uses Profile consent and saves the observed fix before reloading', async () => {
  jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue({ granted: true } as Location.LocationPermissionResponse);
  jest.mocked(Location.getCurrentPositionAsync).mockResolvedValue({ coords: { latitude: -6.2, longitude: 106.8, accuracy: 20 }, timestamp: Date.parse('2026-09-17T01:30:00Z') } as Location.LocationObject);
  const dialog = jest.spyOn(Alert, 'alert');
  const reload = jest.fn().mockResolvedValue(undefined);
  const view = render(<AlertLocationButton reload={reload} />);
  fireEvent.press(view.getByRole('button', { name: 'saveLocation' }));
  await waitFor(() => expect(dialog).toHaveBeenCalledWith('locationConsentTitle', 'locationConsentBody', expect.any(Array), { cancelable: false }));
  expect(mockSaveLocation).not.toHaveBeenCalled();
  await act(async () => { dialog.mock.calls[0][2]![1].onPress!(); });
  await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  expect(mockSaveLocation).toHaveBeenCalledWith(-6.2, 106.8, 20, '2026-09-17T01:30:00.000Z');
  expect(mockSaveLocation.mock.invocationCallOrder[0]).toBeLessThan(reload.mock.invocationCallOrder[0]);
});

test('denied permission explains the failure without saving or reloading', async () => {
  jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue({ granted: false } as Location.LocationPermissionResponse);
  const dialog = jest.spyOn(Alert, 'alert');
  const reload = jest.fn();
  const view = render(<AlertLocationButton reload={reload} />);
  fireEvent.press(view.getByRole('button', { name: 'saveLocation' }));
  await waitFor(() => expect(dialog).toHaveBeenCalledWith('locationSaveErrorTitle', 'locationPermissionDenied'));
  expect(mockSaveLocation).not.toHaveBeenCalled();
  expect(reload).not.toHaveBeenCalled();
});
