import { act, render } from '@testing-library/react-native';
import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
import { HelpRequestScreen } from './help-request';

let mockSession: any = null;
let mockLoading = true;
let mockError: string | null = null;
const mockRefresh = jest.fn(() => new Promise(() => {}));
jest.mock('@/components/use-armed', () => ({ useArmed: () => true }));
jest.mock('expo-constants', () => ({ __esModule: true, default: {} }));
jest.mock('expo-location', () => ({ requestForegroundPermissionsAsync: jest.fn(), requestBackgroundPermissionsAsync: jest.fn().mockResolvedValue({ granted: false }), watchPositionAsync: jest.fn().mockResolvedValue({ remove: jest.fn() }), getCurrentPositionAsync: jest.fn(), hasStartedLocationUpdatesAsync: jest.fn().mockResolvedValue(true), stopLocationUpdatesAsync: jest.fn(), startLocationUpdatesAsync: jest.fn(), Accuracy: { High: 4 } }));
jest.mock('expo-notifications', () => ({ setNotificationHandler: jest.fn(), getPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }), scheduleNotificationAsync: jest.fn().mockResolvedValue('id'), getLastNotificationResponseAsync: jest.fn().mockResolvedValue(null), addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })), addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })) }));
jest.mock('expo-secure-store', () => ({ deleteItemAsync: jest.fn().mockResolvedValue(undefined), setItemAsync: jest.fn().mockResolvedValue(undefined), getItemAsync: jest.fn().mockResolvedValue(null) }));
jest.mock('expo-task-manager', () => ({ isTaskDefined: jest.fn(() => false), defineTask: jest.fn() }));
jest.mock('expo-speech', () => ({ stop: jest.fn(), speak: jest.fn() }));
jest.mock('expo-speech-recognition', () => ({ ExpoSpeechRecognitionModule: {}, useSpeechRecognitionEvent: jest.fn() }));
jest.mock('@/features/profile/api', () => ({ apiRequest: jest.fn().mockResolvedValue(undefined) }));

jest.mock('expo-router', () => ({ useIsFocused: () => true, useLocalSearchParams: () => ({ id: 'request' }), useRouter: () => ({ back: jest.fn(), replace: jest.fn() }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }));
jest.mock('@/features/profile/session', () => ({ useGuestSession: () => ({ token: 'token', user: { id: 'helper' } }) }));
jest.mock('@/features/profile/context', () => ({ useProfile: () => ({ accessibility: [] }) }));
jest.mock('@/features/preferences/context', () => ({ usePreferences: () => ({ preferences: { voiceEnabled: false, textEnabled: true, vibrationEnabled: false } }) }));
jest.mock('@/features/feedback/haptics', () => ({ useHaptics: () => ({ alert: jest.fn(), tap: jest.fn() }) }));
jest.mock('@/features/buddy-pilot/use-buddy-pilot', () => ({ useBuddyPilot: () => ({
  session: mockSession, loading: mockLoading, error: mockError, busy: false, refresh: mockRefresh, incomingContacts: [], contacts: [], locations: [], availability: null,
}) }));

test('mounting, refreshing and closing the takeover never stops another session background sharing', async () => {
  jest.clearAllMocks();
  jest.mocked(SecureStore.getItemAsync).mockResolvedValue(JSON.stringify({ token: 'token', sessionId: 'active-session' }));
  const view = render(<HelpRequestScreen />);
  await act(async () => {});
  expect(mockRefresh).toHaveBeenCalledWith('request');
  mockLoading = false; mockError = 'Connection unavailable';
  view.rerender(<HelpRequestScreen />);
  await act(async () => {});
  mockError = null;
  mockSession = { id: 'request', requesterUserId: 'requester', requesterName: 'Ari', status: 'WAITING', nearby: false, supportNeeds: [], attempts: [{ id: 'attempt', helperUserId: 'helper', status: 'PENDING', expiresAt: new Date(Date.now() + 60000).toISOString() }] };
  view.rerender(<HelpRequestScreen />);
  await act(async () => {});
  mockSession = { ...mockSession, status: 'ACCEPTED' };
  view.rerender(<HelpRequestScreen />);
  await act(async () => {});
  mockSession = null;
  view.rerender(<HelpRequestScreen />);
  view.unmount();
  await act(async () => {});
  expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
  expect(Location.hasStartedLocationUpdatesAsync).not.toHaveBeenCalled();
  expect(Location.stopLocationUpdatesAsync).not.toHaveBeenCalled();
  expect(Location.startLocationUpdatesAsync).not.toHaveBeenCalled();
  expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  expect(SecureStore.getItemAsync).not.toHaveBeenCalled();
});
