import { act, render, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import RootLayout from '@/app/_layout';

let mockCompleted = false;
const mockReplace = jest.fn();
let mockNotification: (value: unknown) => void;
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
jest.mock('@/features/profile/context', () => ({ ProfileProvider: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('@/features/preferences/context', () => ({ PreferencesProvider: ({ children }: { children: React.ReactNode }) => children, usePreferences: () => ({ ready: true, preferences: { completed: mockCompleted } }) }));
jest.mock('@/features/profile/session', () => ({ GuestSessionProvider: ({ children }: { children: React.ReactNode }) => children, useGuestSession: () => ({ status: 'ready', ensureGuest: jest.fn() }) }));
jest.mock('@/screens/setup', () => ({ SetupScreen: () => null }));
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
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/buddy?code=pilot-code'));
  const response = { notification: { request: { content: { data: { requestId: 'session-id' } } } } };
  await act(async () => { mockNotification(response); });
  await act(async () => { mockNotification(response); });
  expect(mockReplace.mock.calls.filter(([path]) => path === '/buddy?requestId=session-id')).toHaveLength(2);
});
