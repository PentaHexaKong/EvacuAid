import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as Speech from 'expo-speech';
import { EmergencyScreen } from './emergency';
import { alertItems } from '@/features/alerts/test-fixtures';
import { respondToAlert } from '@/features/alerts/api';
import { applyResponse } from '@/features/alerts/use-alerts';
import { askAlwaysAndStart } from '@/features/location/alert-area';

let mockItem: typeof alertItems[number] | undefined;
let mockNeeds: string[] = [];
let mockAccess = { voiceHome: false, listen: false, autoRead: false, soundFree: false };
let mockBuddy: string | null = null;
let mockIncoming: { name: string }[] = [];
let mockFocused = true;
const mockRouter = { canGoBack: jest.fn(), replace: jest.fn(), back: jest.fn() };
const mockReload = jest.fn().mockResolvedValue(undefined);
const mockHaptics = { tap: jest.fn(), alert: jest.fn() };
const mockVoice = { listening: false, startListening: jest.fn(), stopListening: jest.fn(), cancelListening: jest.fn() };
let mockCommand: (text: string) => void;
jest.mock('expo-router', () => ({ useIsFocused: () => mockFocused, useRouter: () => mockRouter, useLocalSearchParams: () => ({ id: 'rain' }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, values?: Record<string, string>) => {
  let text = jest.requireActual('../localization/en.json')[key] ?? key;
  for (const [name, value] of Object.entries(values ?? {})) text = text.replace(`{{${name}}}`, value);
  return text;
}, i18n: { language: 'en' } }) }));
jest.mock('@/features/alerts/use-alerts', () => ({ useAlerts: () => ({ items: mockItem ? [mockItem] : [], reload: mockReload }), findAlert: () => mockItem, applyResponse: jest.fn() }));
jest.mock('@/features/alerts/api', () => ({ respondToAlert: jest.fn() }));
jest.mock('@/features/alerts/alert-gate', () => ({ markAlertPresented: jest.fn() }));
jest.mock('@/features/access/use-access', () => ({ useAccess: () => mockAccess }));
jest.mock('@/features/profile/context', () => ({ useProfile: () => ({ accessibility: mockNeeds }) }));
jest.mock('@/features/profile/session', () => ({ useGuestSession: () => ({ token: 'guest', user: { id: 'user' } }) }));
jest.mock('@/features/buddy-pilot/use-primary-buddy', () => ({ usePrimaryBuddy: () => mockBuddy }));
jest.mock('@/features/buddy-pilot/use-incoming-contacts', () => ({ useIncomingContacts: () => mockIncoming }));
jest.mock('@/features/buddy-pilot/native', () => ({ useBuddySpeech: ({ onCommand }: { onCommand: typeof mockCommand }) => { mockCommand = onCommand; return mockVoice; } }));
jest.mock('@/features/navigation/use-evacuation-route', () => ({ useEvacuationRoute: () => ({ shelters: [{ name: 'Town Hall', distanceM: 250 }] }) }));
jest.mock('@/features/feedback/haptics', () => ({ useHaptics: () => mockHaptics }));
jest.mock('@/features/location/alert-area', () => ({ askAlwaysAndStart: jest.fn().mockResolvedValue('granted') }));
jest.mock('expo-location', () => ({ getBackgroundPermissionsAsync: jest.fn().mockResolvedValue({ granted: false }) }));
jest.mock('expo-speech', () => ({ stop: jest.fn().mockResolvedValue(undefined), speak: jest.fn() }));

beforeEach(async () => {
  jest.clearAllMocks();
  mockRouter.canGoBack.mockReturnValue(true);
  await AsyncStorage.clear();
  mockItem = { ...alertItems[0], myResponse: null };
  mockFocused = true;
  mockNeeds = [];
  mockAccess = { voiceHome: false, listen: false, autoRead: false, soundFree: false };
  mockBuddy = null;
  mockIncoming = [];
  jest.mocked(respondToAlert).mockImplementation(async (_token, _id, response) => ({ ...alertItems[0], myResponse: response }));
  jest.mocked(Location.getBackgroundPermissionsAsync).mockResolvedValue({ granted: false } as Location.PermissionResponse);
  jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

test.each([
  ['Start evacuation', 'EVACUATING', '/discover', 'route'],
  ['I need help', 'NEEDS_HELP', '/buddy', 'help'],
] as const)('%s posts and immediately navigates', async (label, response, pathname, param) => {
  jest.mocked(respondToAlert).mockReturnValue(new Promise(() => {}));
  const view = render(<EmergencyScreen />);
  fireEvent.press(view.getByRole('button', { name: label }));
  expect(respondToAlert).toHaveBeenCalledWith('guest', 'rain', response);
  expect(mockRouter.replace).toHaveBeenCalledWith({ pathname, params: { [param]: expect.any(String), ...(param === 'help' ? { consented: '1' } : {}) } });
  expect(Alert.alert).not.toHaveBeenCalled();
});
test.each([null, 'Sari'])('buddy action shares caption and goes to help (%s)', async buddy => {
  mockNeeds = ['MOBILITY_LIMITATION'];
  mockBuddy = buddy;
  const view = render(<EmergencyScreen />);
  fireEvent.press(view.getByRole('button', { name: buddy ? "Ask Sari for help. Shares your location with Sari" : "Find a helper nearby. Shares your location with helpers nearby" }));
  expect(respondToAlert).toHaveBeenCalledWith('guest', 'rain', 'NEEDS_HELP');
  expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/buddy', params: { help: expect.any(String), consented: '1' } });
  await waitFor(() => expect(applyResponse).toHaveBeenCalledWith('rain', 'NEEDS_HELP'));
  expect(Alert.alert).not.toHaveBeenCalled();
});
test('safe posts, closes, and asks Always only once', async () => {
  const view = render(<EmergencyScreen />);
  fireEvent.press(view.getByRole('button', { name: "I'm safe" }));
  expect(mockRouter.back).toHaveBeenCalledTimes(1);
  expect(respondToAlert).toHaveBeenCalledWith('guest', 'rain', 'SAFE');
  await waitFor(() => expect(Alert.alert).toHaveBeenCalledTimes(1));
  expect(await AsyncStorage.getItem('evacuaid.always-asked.v1')).toBe('true');
  const buttons = jest.mocked(Alert.alert).mock.calls[0][2]!;
  buttons[1].onPress?.();
  expect(askAlwaysAndStart).toHaveBeenCalledWith('guest', 'user');
  view.unmount();
  const again = render(<EmergencyScreen />);
  fireEvent.press(again.getByRole('button', { name: "I'm safe" }));
  await act(async () => {});
  expect(Alert.alert).toHaveBeenCalledTimes(1);
});
test('safe does not prompt when background permission is already granted', async () => {
  jest.mocked(Location.getBackgroundPermissionsAsync).mockResolvedValue({ granted: true } as Location.PermissionResponse);
  const view = render(<EmergencyScreen />);
  fireEvent.press(view.getByRole('button', { name: "I'm safe" }));
  await act(async () => {});
  expect(Alert.alert).not.toHaveBeenCalled();
});
test.each([false, true])('blind evacuation speaks only with listening enabled (%s)', async listen => {
  mockNeeds = ['VISUAL_IMPAIRMENT'];
  mockAccess = { voiceHome: true, listen, autoRead: false, soundFree: false };
  const view = render(<EmergencyScreen />);
  fireEvent.press(view.getByRole('button', { name: 'Start evacuation' }));
  await act(async () => {});
  expect(respondToAlert).toHaveBeenCalledWith('guest', 'rain', 'EVACUATING');
  expect(mockRouter.back).toHaveBeenCalledTimes(1);
  expect(mockRouter.replace).not.toHaveBeenCalled();
  if (listen) expect(Speech.speak).toHaveBeenCalledWith('Nearest gathering point: Town Hall, 250 m', { language: 'en-US' });
  else expect(Speech.speak).not.toHaveBeenCalled();
});
test('check people navigates without posting', () => {
  mockIncoming = [{ name: 'Sari' }];
  const view = render(<EmergencyScreen />);
  fireEvent.press(view.getByRole('button', { name: 'Check on Sari' }));
  expect(mockRouter.replace).toHaveBeenCalledWith('/buddy');
  expect(respondToAlert).not.toHaveBeenCalled();
});
test('close posts nothing and does not ask Always', async () => {
  const view = render(<EmergencyScreen />);
  fireEvent.press(view.getByRole('button', { name: 'Close' }));
  await act(async () => {});
  expect(mockRouter.back).toHaveBeenCalledTimes(1);
  expect(respondToAlert).not.toHaveBeenCalled();
  expect(Alert.alert).not.toHaveBeenCalled();
});
test('ended warning reloads once and offers Close', async () => {
  mockItem = undefined;
  const view = render(<EmergencyScreen />);
  await waitFor(() => expect(view.getByText('This warning has ended.')).toBeTruthy());
  expect(mockReload).toHaveBeenCalledTimes(1);
  fireEvent.press(view.getByRole('button', { name: 'Close' }));
  expect(mockRouter.back).toHaveBeenCalled();
});
test.each(['close', 'safe', 'blind evacuate', 'ended'] as const)('%s returns Home when there is no navigation history', async action => {
  mockRouter.canGoBack.mockReturnValue(false);
  if (action === 'ended') mockItem = undefined;
  if (action === 'blind evacuate') {
    mockNeeds = ['VISUAL_IMPAIRMENT'];
    mockAccess = { voiceHome: true, listen: true, autoRead: false, soundFree: false };
  }
  const view = render(<EmergencyScreen />);
  if (action === 'ended') await waitFor(() => expect(view.getByText('This warning has ended.')).toBeTruthy());
  fireEvent.press(view.getByRole('button', { name: action === 'safe' ? "I'm safe" : action === 'blind evacuate' ? 'Start evacuation' : 'Close' }));
  await act(async () => {});
  expect(mockRouter.replace).toHaveBeenCalledWith('/');
  expect(mockRouter.back).not.toHaveBeenCalled();
  if (action === 'safe' || action === 'blind evacuate') expect(respondToAlert).toHaveBeenCalledWith('guest', 'rain', action === 'safe' ? 'SAFE' : 'EVACUATING');
  else expect(respondToAlert).not.toHaveBeenCalled();
});
test('response retries once then swallows failures', async () => {
  jest.mocked(respondToAlert).mockRejectedValue(new Error('offline'));
  const view = render(<EmergencyScreen />);
  fireEvent.press(view.getByRole('button', { name: 'Start evacuation' }));
  await waitFor(() => expect(respondToAlert).toHaveBeenCalledTimes(2));
  expect(applyResponse).not.toHaveBeenCalled();
});
test('404 reloads without retry or extra navigation', async () => {
  jest.mocked(respondToAlert).mockRejectedValue(Object.assign(new Error('alert not found'), { status: 404 }));
  const view = render(<EmergencyScreen />);
  fireEvent.press(view.getByRole('button', { name: "I'm safe" }));
  await waitFor(() => expect(mockReload).toHaveBeenCalledTimes(1));
  expect(respondToAlert).toHaveBeenCalledTimes(1);
  expect(mockRouter.back).toHaveBeenCalledTimes(1);
});
test('blind narration finishes before listening, with only one unknown retry', async () => {
  mockNeeds = ['VISUAL_IMPAIRMENT'];
  mockAccess = { voiceHome: true, listen: true, autoRead: true, soundFree: false };
  render(<EmergencyScreen />);
  await waitFor(() => expect(Speech.speak).toHaveBeenCalledTimes(1));
  expect(mockVoice.startListening).not.toHaveBeenCalled();
  await act(async () => { jest.mocked(Speech.speak).mock.calls[0][1]?.onDone?.(); });
  expect(mockVoice.startListening).toHaveBeenCalledTimes(1);
  await act(async () => mockCommand('hello'));
  await act(async () => { jest.mocked(Speech.speak).mock.calls[1][1]?.onDone?.(); });
  expect(mockVoice.startListening).toHaveBeenCalledTimes(2);
  await act(async () => mockCommand('hello'));
  await act(async () => { jest.mocked(Speech.speak).mock.calls[2][1]?.onDone?.(); });
  expect(mockVoice.startListening).toHaveBeenCalledTimes(2);
});
test('sound-free suppresses narration and voice commands', async () => {
  mockAccess = { voiceHome: true, listen: true, autoRead: true, soundFree: true };
  const view = render(<EmergencyScreen />);
  await act(async () => mockCommand('help'));
  expect(Speech.speak).not.toHaveBeenCalled();
  expect(respondToAlert).not.toHaveBeenCalled();
  expect(view.queryByRole('button', { name: 'Speak' })).toBeNull();
});


test('leaving cancels narration and prevents late speech completion from listening', async () => {
  mockNeeds = ['VISUAL_IMPAIRMENT'];
  mockAccess = { voiceHome: true, listen: true, autoRead: true, soundFree: false };
  const view = render(<EmergencyScreen />);
  await waitFor(() => expect(Speech.speak).toHaveBeenCalledTimes(1));
  const finish = jest.mocked(Speech.speak).mock.calls[0][1]?.onDone;
  mockFocused = false;
  view.rerender(<EmergencyScreen />);
  await act(async () => finish?.());
  expect(mockVoice.cancelListening).toHaveBeenCalled();
  expect(mockVoice.startListening).not.toHaveBeenCalled();
});
