import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';
import { PreferencesProvider } from '@/features/preferences/context';
import { defaults, PREFERENCES_KEY } from '@/features/preferences/storage';
import { ONBOARDING_NEEDS_KEY } from '@/features/profile/context';
import { RequestDraftProvider } from '@/features/requests/draft';
import { RequestScreen, RequestReviewScreen } from './request';
import { ContactScreen } from './buddy';
import { SetupScreen } from './setup';
import { OverviewScreen } from './overview';

const mockRouter = { push: jest.fn(), navigate: jest.fn(), back: jest.fn(), replace: jest.fn(), dismissTo: jest.fn() };
let mockContactId = 'raka';
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, useLocalSearchParams: () => ({ id: mockContactId }) }));
jest.mock('expo-router/react-navigation', () => ({ ...jest.requireActual('expo-router/react-navigation'), useHeaderHeight: () => 0 }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => jest.requireActual('../localization/en.json')[key] ?? key, i18n: { language: 'en' } }) }));
jest.mock('@/components/settings-menu', () => ({ SettingsMenu: () => null }));
jest.mock('@/localization', () => ({ selectLanguage: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));


beforeEach(async () => { jest.restoreAllMocks(); jest.clearAllMocks(); mockContactId = 'raka'; await AsyncStorage.clear(); });

test('preferences preview is local, cancel does not save, and failed saves remain retryable', async () => {
  const done = jest.fn();
  const view = render(<PreferencesProvider><SetupScreen editing onDone={done} /></PreferencesProvider>);
  await act(async () => {});
  fireEvent(view.getByRole('switch', { name: 'Larger text' }), 'valueChange', true);
  fireEvent(view.getByRole('switch', { name: 'Stronger text contrast' }), 'valueChange', true);
  expect(view.getByText('Important information, with room to read.')).toHaveStyle({ fontSize: 19.2, color: '#0B1F52' });
  fireEvent.press(view.getByRole('button', { name: 'Cancel' }));
  expect(done).toHaveBeenCalledTimes(1);
  expect(await AsyncStorage.getItem(PREFERENCES_KEY)).toBeNull();
  jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('storage'));
  fireEvent.press(view.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(view.getByText('Could not save your preferences. Please try again.')).toBeTruthy());
  expect(view.getByRole('switch', { name: 'Larger text' })).toHaveProp('value', true);
  fireEvent.press(view.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(done).toHaveBeenCalledTimes(2));
  expect(JSON.parse((await AsyncStorage.getItem(PREFERENCES_KEY))!)).toEqual({ ...defaults, completed: true, largerText: true, strongerContrast: true });
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
  expect(JSON.parse((await AsyncStorage.getItem(PREFERENCES_KEY))!)).toEqual({ ...defaults, completed: true });
});

test('onboarding walks welcome, help and an example warning, saving the chosen help', async () => {
  const done = jest.fn();
  const view = render(<PreferencesProvider><SetupScreen onDone={done} /></PreferencesProvider>);
  await act(async () => {});
  expect(view.queryByRole('progressbar')).toBeNull();
  fireEvent.press(view.getByRole('button', { name: 'Get started' }));
  expect(view.getByRole('progressbar')).toHaveProp('accessibilityValue', { min: 0, max: 2, now: 1 });
  expect(view.getByRole('checkbox', { name: 'Standard' })).toHaveProp('accessibilityState', expect.objectContaining({ checked: true }));
  fireEvent.press(view.getByRole('checkbox', { name: 'Older adult' }));
  fireEvent.press(view.getByRole('checkbox', { name: 'Limited mobility' }));
  expect(view.getByRole('checkbox', { name: 'Standard' })).toHaveProp('accessibilityState', expect.objectContaining({ checked: false }));
  expect(view.queryByRole('checkbox', { name: 'Larger text' })).toBeNull();
  fireEvent.press(view.getByRole('button', { name: 'Adjust details' }));
  expect(view.getByRole('checkbox', { name: 'Larger text' })).toHaveProp('accessibilityState', expect.objectContaining({ checked: true }));
  fireEvent.press(view.getByRole('checkbox', { name: 'Stronger text contrast' }));
  expect(view.queryByRole('switch')).toBeNull();
  fireEvent.press(view.getByRole('button', { name: 'Continue' }));
  expect(view.getByRole('progressbar')).toHaveProp('accessibilityValue', { min: 0, max: 2, now: 2 });
  expect(view.getByText('Pack an emergency bag')).toBeTruthy();
  expect(view.queryByRole('button', { name: /Read the warning aloud/i })).toBeNull();
  await act(async () => fireEvent.press(view.getByRole('button', { name: 'Request help' })));
  expect(done).toHaveBeenCalledWith('/buddy');
  expect(JSON.parse((await AsyncStorage.getItem(PREFERENCES_KEY))!)).toEqual({ ...defaults, completed: true, largerText: true, strongerContrast: false });
  expect(JSON.parse((await AsyncStorage.getItem(ONBOARDING_NEEDS_KEY))!)).toEqual(['ELDERLY', 'MOBILITY_LIMITATION']);
});

test('choosing Standard clears support tiles and restores default help', async () => {
  const view = render(<PreferencesProvider><SetupScreen /></PreferencesProvider>);
  await act(async () => {});
  fireEvent.press(view.getByRole('button', { name: 'Get started' }));
  fireEvent.press(view.getByRole('checkbox', { name: 'Blind or low vision' }));
  fireEvent.press(view.getByRole('checkbox', { name: 'Standard' }));
  expect(view.getByRole('checkbox', { name: 'Blind or low vision' })).toHaveProp('accessibilityState', expect.objectContaining({ checked: false }));
  fireEvent.press(view.getByRole('button', { name: 'Adjust details' }));
  expect(view.getByRole('checkbox', { name: 'Larger text' })).toHaveProp('accessibilityState', expect.objectContaining({ checked: false }));
});

test('finishing onboarding from the warning step returns Home', async () => {
  const done = jest.fn();
  const view = render(<PreferencesProvider><SetupScreen onDone={done} /></PreferencesProvider>);
  await act(async () => {});
  fireEvent.press(view.getByRole('button', { name: 'Get started' }));
  fireEvent.press(view.getByRole('button', { name: 'Continue' }));
  await act(async () => fireEvent.press(view.getByRole('button', { name: 'Go to Home' })));
  expect(done).toHaveBeenCalledWith(undefined);
});

test('Home shows the sample alert level with its label and routes to a gathering point', () => {
  const view = render(<OverviewScreen />);
  expect(view.getByRole('header', { name: 'Caution for heavy rain and strong winds, 08:30 to 11:30 WIB.' })).toBeTruthy();
  expect(view.getByLabelText('EvacuAid')).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: 'Find gathering point' }));
  expect(mockRouter.navigate).toHaveBeenLastCalledWith({ pathname: '/discover', params: { route: expect.any(String) } });
  expect(view.queryByLabelText('Find a destination')).toBeNull();
  expect(view.queryByText(/safe route/i)).toBeNull();
});

test('Home opens the latest alert and the full list', () => {
  const view = render(<OverviewScreen />);
  fireEvent.press(view.getByRole('button', { name: 'See all' }));
  expect(mockRouter.navigate).toHaveBeenLastCalledWith('/alerts');
  expect(view.getByText('Open alert')).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: 'Caution. Heavy rain and strong winds. Open alert' }));
  expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/alert/[id]', params: { id: 'rain' } });
});

test('Home quick-access tiles open the map, help request, Buddy and alerts', () => {
  const view = render(<OverviewScreen />);
  fireEvent.press(view.getByRole('button', { name: 'Risk map' }));
  expect(mockRouter.navigate).toHaveBeenLastCalledWith('/discover');
  fireEvent.press(view.getByRole('button', { name: 'Get help' }));
  expect(mockRouter.push).toHaveBeenLastCalledWith('/request');
  fireEvent.press(view.getByRole('button', { name: 'Buddy' }));
  expect(mockRouter.navigate).toHaveBeenLastCalledWith('/buddy');
  fireEvent.press(view.getByRole('button', { name: 'Alerts' }));
  expect(mockRouter.navigate).toHaveBeenLastCalledWith('/alerts');
});
