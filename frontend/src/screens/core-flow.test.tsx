import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';
import { PreferencesProvider } from '@/features/preferences/context';
import { PREFERENCES_KEY } from '@/features/preferences/storage';
import { RequestDraftProvider } from '@/features/requests/draft';
import { RequestScreen, RequestReviewScreen } from './request';
import { ContactScreen } from './buddy';
import { SetupScreen } from './setup';
import { OverviewScreen } from './overview';

const mockRouter = { push: jest.fn(), navigate: jest.fn(), back: jest.fn(), replace: jest.fn(), dismissTo: jest.fn() };
let mockContactId = 'raka';
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, useLocalSearchParams: () => ({ id: mockContactId }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => jest.requireActual('../localization/en.json')[key] ?? key, i18n: { language: 'en' } }) }));
jest.mock('@/components/settings-menu', () => ({ SettingsMenu: () => null }));
jest.mock('@/localization', () => ({ selectLanguage: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('heroui-native/card', () => {
  const { View } = jest.requireActual('react-native');
  const Card = Object.assign(({ children }: { children: React.ReactNode }) => <View>{children}</View>, { Body: View });
  return { Card };
});

jest.mock('heroui-native/button', () => {
  const { Pressable } = jest.requireActual('react-native');
  return { Button: (props: React.ComponentProps<typeof Pressable>) => <Pressable accessibilityRole="button" {...props} /> };
});
jest.mock('heroui-native/input', () => ({ Input: jest.requireActual('react-native').TextInput }));
jest.mock('heroui-native/chip', () => ({ Chip: jest.requireActual('react-native').View }));

beforeEach(async () => { jest.restoreAllMocks(); jest.clearAllMocks(); mockContactId = 'raka'; await AsyncStorage.clear(); });

test('preferences preview is local, cancel does not save, and failed saves remain retryable', async () => {
  const done = jest.fn();
  const view = render(<PreferencesProvider><SetupScreen editing onDone={done} /></PreferencesProvider>);
  await act(async () => {});
  fireEvent(view.getByRole('switch', { name: 'Larger text' }), 'valueChange', true);
  fireEvent(view.getByRole('switch', { name: 'Stronger text contrast' }), 'valueChange', true);
  expect(view.getByText('Important information, with room to read.')).toHaveStyle({ fontSize: 19.2, color: '#12284B' });
  fireEvent.press(view.getByRole('button', { name: 'Cancel' }));
  expect(done).toHaveBeenCalledTimes(1);
  expect(await AsyncStorage.getItem(PREFERENCES_KEY)).toBeNull();
  jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('storage'));
  fireEvent.press(view.getByRole('button', { name: 'Save preferences' }));
  await waitFor(() => expect(view.getByText('Could not save your preferences. Please try again.')).toBeTruthy());
  expect(view.getByRole('switch', { name: 'Larger text' })).toHaveProp('value', true);
  fireEvent.press(view.getByRole('button', { name: 'Save preferences' }));
  await waitFor(() => expect(done).toHaveBeenCalledTimes(2));
  expect(JSON.parse((await AsyncStorage.getItem(PREFERENCES_KEY))!)).toEqual({ completed: true, largerText: true, strongerContrast: true });
});

test('request survives screen changes, rejects blank text, and cannot be sent', async () => {
  const screen = (stage: 'contact' | 'request' | 'review') => <RequestDraftProvider>{stage === 'contact' ? <ContactScreen /> : stage === 'request' ? <RequestScreen /> : <RequestReviewScreen />}</RequestDraftProvider>;
  const view = render(screen('contact'));
  fireEvent.press(view.getByRole('button', { name: 'Request help' }));
  view.rerender(screen('request'));
  fireEvent.changeText(view.getByLabelText('What help do you need?'), '   ');
  fireEvent.press(view.getByRole('button', { name: 'Review request' }));
  expect(view.getByText('Write a message before reviewing your request.')).toBeTruthy();
  fireEvent.changeText(view.getByLabelText('What help do you need?'), 'Please meet me at the entrance.');
  fireEvent.press(view.getByRole('button', { name: 'Review request' }));
  expect(mockRouter.push).toHaveBeenLastCalledWith('/request/review');
  view.rerender(screen('review'));
  expect(view.getByText('Please meet me at the entrance.')).toBeTruthy();
  expect(view.getByRole('button', { name: 'Send request' })).toBeDisabled();
  fireEvent.press(view.getByRole('button', { name: 'Send request' }));
  expect(view.getByText('Sending is not available yet')).toBeTruthy();
  view.rerender(screen('request'));
  expect(view.getByDisplayValue('Please meet me at the entrance.')).toBeTruthy();
  view.unmount();
  const fresh = render(screen('review'));
  expect(fresh.getByText('Choose a contact and write a message first.')).toBeTruthy();
});

test('discarding or replacing an edited draft requires confirmation', () => {
  const confirm = jest.spyOn(Alert, 'alert');
  const screen = (contact: boolean) => <RequestDraftProvider>{contact ? <ContactScreen /> : <RequestScreen />}</RequestDraftProvider>;
  const view = render(screen(true));
  fireEvent.press(view.getByRole('button', { name: 'Request help' }));
  view.rerender(screen(false));
  fireEvent.changeText(view.getByLabelText('What help do you need?'), 'Please help.');
  fireEvent.press(view.getByRole('button', { name: 'Discard draft' }));
  expect(confirm).toHaveBeenCalled();
  expect(view.getByDisplayValue('Please help.')).toBeTruthy();
  mockContactId = 'sinta';
  view.rerender(screen(true));
  fireEvent.press(view.getByRole('button', { name: 'Request help' }));
  expect(confirm).toHaveBeenLastCalledWith('Replace this draft?', expect.any(String), expect.any(Array));
  act(() => confirm.mock.calls.at(-1)![2]![1].onPress!());
  view.rerender(screen(false));
  expect(view.getByText('Sinta Nuraini')).toBeTruthy();
  expect(view.getByLabelText('What help do you need?')).toHaveProp('value', '');
});

test('missing sample contact leaves a readable unavailable state', () => {
  mockContactId = 'missing';
  const view = render(<ContactScreen />);
  expect(view.getByText('This information is unavailable. Go back to choose another item.')).toBeTruthy();
  expect(view.queryByRole('button', { name: 'Request help' })).toBeNull();
});

test('welcome exposes language immediately and skipping setup enters Home without support changes', async () => {
  const view = render(<PreferencesProvider><SetupScreen /></PreferencesProvider>);
  await act(async () => {});
  expect(view.getByRole('button', { name: 'Bahasa: Indonesia' })).toBeTruthy();
  expect(view.queryByRole('switch')).toBeNull();
  await act(async () => fireEvent.press(view.getByRole('button', { name: 'Skip setup' })));
  expect(JSON.parse((await AsyncStorage.getItem(PREFERENCES_KEY))!)).toEqual({ completed: true, largerText: false, strongerContrast: false });
});

test('Home search filters sample destinations and opens the selected destination', () => {
  const view = render(<OverviewScreen />);
  expect(view.getByText('Live conditions are not connected yet. Explore the example alerts below.')).toBeTruthy();
  const search = view.getByLabelText('Find a destination');
  fireEvent.changeText(search, 'center');
  expect(view.getByText('Community center · example')).toBeTruthy();
  expect(view.queryByText('Community hall · example')).toBeNull();
  fireEvent.press(view.getByText('Community center · example'));
  expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/destinations/[id]', params: { id: 'community-center' } });
  expect(search).toHaveProp('value', '');
  fireEvent.changeText(search, 'no-such-place');
  expect(view.getByText('No example destinations match your search.')).toBeTruthy();
  expect(view.queryByRole('button', { name: 'Request help' })).toBeNull();
});

test('Home quick access opens the matching existing destinations and reports its unavailable action', () => {
  const alert = jest.spyOn(Alert, 'alert');
  const view = render(<OverviewScreen />);
  for (const [label, route] of [['Risk Map', '/discover'], ['Safe Routes', '/destinations'], ['Preparedness', '/alerts']]) {
    fireEvent.press(view.getByRole('button', { name: label }));
    expect(mockRouter.navigate).toHaveBeenLastCalledWith(route);
  }
  fireEvent.press(view.getByRole('button', { name: 'Report' }));
  expect(alert).toHaveBeenCalledWith('Report', 'Reporting is not available yet. No report has been created or sent.');
  const id = jest.requireActual('../localization/id.json');
  expect([id.homeRiskMap, id.homeSafeRoutes, id.homeReport, id.homePreparedness]).toEqual(['Peta Risiko', 'Rute Aman', 'Laporkan', 'Siaga']);
});

test('route simulation is reachable from Home only in development', () => {
  const view = render(<OverviewScreen />);
  fireEvent.press(view.getByRole('button', { name: 'Route simulation' }));
  expect(mockRouter.push).toHaveBeenLastCalledWith('/route-simulation');
  view.unmount();
  const previous = __DEV__;
  try {
    (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
    const production = render(<OverviewScreen />);
    expect(production.queryByRole('button', { name: 'Route simulation' })).toBeNull();
  } finally { (globalThis as unknown as { __DEV__: boolean }).__DEV__ = previous; }
});
