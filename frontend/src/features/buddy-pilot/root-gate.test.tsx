import { act, render, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import RootLayout from '@/app/_layout';

let mockCompleted = false;
let mockToken: string | null = null;
let mockProfileReady = false;
let mockReach: (permissions: import('@/screens/setup').ReachPermissions) => void;
const mockSaveLocation = jest.fn().mockResolvedValue(undefined);
const mockRegisterPush = jest.fn().mockResolvedValue(undefined);
const mockReplace = jest.fn();
let mockNotification: (value: unknown) => void;
jest.mock('@/features/alerts/alert-gate', () => ({ AlertGate: () => null, markAlertPresented: jest.fn() }));
jest.mock('expo-router', () => {
  const Stack = ({ children }: { children: React.ReactNode }) => children;
  Stack.Screen = function Screen() { return null; };
  Stack.Protected = ({ children }: { children: React.ReactNode }) => children;
  return { Stack, useRouter: () => ({ replace: mockReplace }) };
});
jest.mock('expo-notifications', () => ({ addNotificationResponseReceivedListener: jest.fn(callback => { mockNotification = callback; return { remove: jest.fn() }; }), getLastNotificationResponseAsync: jest.fn().mockResolvedValue(null), clearLastNotificationResponseAsync: jest.fn().mockResolvedValue(undefined) }));
jest.mock('expo-linking', () => ({ addEventListener: jest.fn(() => ({ remove: jest.fn() })), getInitialURL: jest.fn().mockResolvedValue('evacuaid://buddy-invite?code=pilot-code'), parse: () => ({ hostname: 'buddy-invite', queryParams: { code: 'pilot-code' } }) }));
jest.mock('expo-splash-screen', () => ({ preventAutoHideAsync: jest.fn().mockResolvedValue(undefined), hideAsync: jest.fn().mockResolvedValue(undefined) }));
jest.mock('react-native-gesture-handler', () => ({ GestureHandlerRootView: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children, SafeAreaView: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));
jest.mock('@/features/location/alert-area', () => ({}));
jest.mock('@/features/location/push-token', () => ({ registerPushToken: (...args: unknown[]) => mockRegisterPush(...args) }));
jest.mock('@/features/profile/context', () => ({ ProfileProvider: ({ children }: { children: React.ReactNode }) => children, useProfile: () => ({ ready: mockProfileReady, saveLocation: mockSaveLocation }) }));
jest.mock('@/features/preferences/context', () => ({ PreferencesProvider: ({ children }: { children: React.ReactNode }) => children, usePreferences: () => ({ ready: true, preferences: { completed: mockCompleted } }) }));
jest.mock('@/features/profile/session', () => ({ GuestSessionProvider: ({ children }: { children: React.ReactNode }) => children, useGuestSession: () => ({ token: mockToken, status: 'ready', ensureGuest: jest.fn() }) }));
jest.mock('@/screens/setup', () => ({ SetupScreen: ({ onReach }: { onReach: typeof mockReach }) => { mockReach = onReach; return null; } }));
jest.mock('@/components/page-scroll-view', () => ({ pageHeaderLayout: undefined }));
jest.mock('@/localization', () => ({ i18n: {}, localizationReady: Promise.resolve() }));
jest.mock('react-i18next', () => ({ I18nextProvider: ({ children }: { children: React.ReactNode }) => children, useTranslation: () => ({ t: (key: string) => key }) }));

test('retains Buddy target through onboarding and allows repeated notification opens', async () => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
  const view = render(<RootLayout />);
  await act(async () => {});
  expect(mockReplace).not.toHaveBeenCalled();
  mockCompleted = true;
  view.rerender(<RootLayout />);
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/buddy-invite?code=pilot-code'));
  const response = { notification: { request: { content: { data: { requestId: 'session-id' } } } } };
  await act(async () => { mockNotification(response); });
  await act(async () => { mockNotification(response); });
  expect(mockReplace.mock.calls.filter(([path]) => path === '/buddy?requestId=session-id')).toHaveLength(2);
});


test('reach registration survives finishing setup before the guest profile is ready', async () => {
  mockCompleted = false;
  mockToken = null;
  mockProfileReady = false;
  mockSaveLocation.mockClear();
  mockRegisterPush.mockClear();
  const view = render(<RootLayout />);
  await act(async () => {});
  await act(async () => mockReach({ notifications: true, location: { coords: { latitude: 1, longitude: 2, accuracy: 5 }, timestamp: 1000 } as import('expo-location').LocationObject }));
  expect(mockSaveLocation).not.toHaveBeenCalled();
  expect(mockRegisterPush).not.toHaveBeenCalled();
  mockCompleted = true;
  view.rerender(<RootLayout />);
  mockToken = 'guest';
  mockProfileReady = true;
  view.rerender(<RootLayout />);
  await waitFor(() => expect(mockSaveLocation).toHaveBeenCalledWith(1, 2, 5, '1970-01-01T00:00:01.000Z'));
  expect(mockRegisterPush).toHaveBeenCalledTimes(1);
  expect(mockRegisterPush).toHaveBeenCalledWith('guest');
  expect(mockSaveLocation).toHaveBeenCalledTimes(1);
});


test('alert notification wins over inbox routing', async () => {
  mockCompleted = true;
  mockToken = 'guest';
  render(<RootLayout />);
  await act(async () => {});
  await act(async () => { mockNotification({ notification: { request: { content: { data: { alertId: 'alert-id', inboxId: 'inbox-id' } } } } }); });
  expect(mockReplace).toHaveBeenCalledWith('/emergency/alert-id');
  expect(jest.requireMock('@/features/alerts/alert-gate').markAlertPresented).toHaveBeenCalledWith('alert-id');
});
