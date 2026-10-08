import { speak } from '@/features/feedback/speech';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PreferencesProvider } from '@/features/preferences/context';
import { defaults, PREFERENCES_KEY } from '@/features/preferences/storage';
import { ONBOARDING_NEEDS_KEY } from '@/features/profile/context';
import { SetupScreen } from './setup';
import { OverviewScreen } from './overview';

let mockLanguage = 'en';
const mockRouter = { push: jest.fn(), navigate: jest.fn(), back: jest.fn(), replace: jest.fn(), dismissTo: jest.fn() };
// topAlert's own ranking is covered in discover-profile.test; here each level is pinned to test what Home renders.
let mockTopLevel: string | null = null;
jest.mock('@/features/content/samples', () => {
  const actual = jest.requireActual('@/features/content/samples');
  // __esModule keeps Babel's interop from copying topAlert once at import, so the getter is read on every render.
  return Object.defineProperties({ ...actual }, {
    __esModule: { value: true },
    topAlert: { enumerable: true, get: () => ({ ...(mockTopLevel ? { ...actual.sampleAlerts[1], level: mockTopLevel } : actual.topAlert), ...(mockAlertId ? { id: mockAlertId } : {}) }) },
  });
});
let mockShelters: { name: string; distanceM: number }[] | null = null;
jest.mock('@/features/navigation/use-evacuation-route', () => ({ useEvacuationRoute: () => ({ shelters: mockShelters }) }));
jest.mock('expo-router', () => {
  const Toolbar = Object.assign(({ children }: { children: React.ReactNode }) => children, { View: ({ children }: { children: React.ReactNode }) => children });
  return { useRouter: () => mockRouter, Stack: { Toolbar } };
});
jest.mock('expo-router/react-navigation', () => ({ ...jest.requireActual('expo-router/react-navigation'), useHeaderHeight: () => 100 }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => (mockLanguage === 'id' ? jest.requireActual('../localization/id.json') : jest.requireActual('../localization/en.json'))[key] ?? key, i18n: { language: mockLanguage } }) }));
jest.mock('@/components/settings-menu', () => ({ SettingsMenu: () => null }));
jest.mock('@/localization', () => ({ selectLanguage: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));


beforeEach(async () => { jest.restoreAllMocks(); jest.clearAllMocks(); mockLanguage = 'en'; await AsyncStorage.clear(); });

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
  expect(view.getByRole('header', { name: 'Caution for heavy rain and strong winds.' })).toBeTruthy();
  expect(view.getByText('08:30 to 11:30 WIB')).toBeTruthy();
  expect(view.getByText('Keep checking for updates and pack a go-bag.')).toBeTruthy();
  expect(view.getByLabelText('EvacuAid')).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: 'Find gathering point' }));
  expect(mockRouter.navigate).toHaveBeenLastCalledWith({ pathname: '/discover', params: { route: expect.any(String) } });
  expect(view.queryByLabelText('Find a destination')).toBeNull();
  expect(view.queryByText(/safe route/i)).toBeNull();
});

test('Home escalates its words and route action with the top alert, and says all clear at Normal', () => {
  try {
    mockTopLevel = 'siaga';
    const severe = render(<OverviewScreen />);
    expect(severe.getByRole('header', { name: 'Alert for water on local roads.' })).toBeTruthy();
    expect(severe.getByText('Get ready to leave. Check your route and tell your Buddy.')).toBeTruthy();
    expect(severe.queryByText('Start route')).toBeNull();
    severe.unmount();
    mockTopLevel = 'awas';
    const awas = render(<OverviewScreen />);
    fireEvent.press(awas.getByRole('button', { name: 'Find gathering point. See gathering points on the map. Start route' }));
    expect(mockRouter.navigate).toHaveBeenLastCalledWith({ pathname: '/discover', params: { route: expect.any(String) } });
    awas.unmount();
    mockTopLevel = 'normal';
    const clear = render(<OverviewScreen />);
    expect(clear.getByRole('header', { name: 'Conditions are normal. No active warnings.' })).toBeTruthy();
    expect(clear.queryByText(/go-bag|Get ready|gathering point now/)).toBeNull();
    expect(clear.queryByText(/Find gathering point|See gathering points on the map/)).toBeNull();
    expect(clear.queryByText('Read the full alert')).toBeNull();
    expect(clear.getByRole('header', { name: 'Recent alerts' })).toBeTruthy();
    expect(clear.getByLabelText(/^Caution\. Heavy rain and strong winds\./)).toBeTruthy();
  } finally {
    mockTopLevel = null;
  }
});

test('Home names the nearest gathering point and its distance once shelters load', () => {
  mockShelters = [{ name: 'Example Point A', distanceM: 250 }];
  try {
    const view = render(<OverviewScreen />);
    fireEvent.press(view.getByRole('button', { name: 'Example Point A. Nearest · 250 m' }));
    expect(mockRouter.navigate).toHaveBeenLastCalledWith({ pathname: '/discover', params: { route: expect.any(String) } });
  } finally { mockShelters = null; }
});

test('Home links the header alert and lists only the other alerts below', () => {
  const view = render(<OverviewScreen />);
  fireEvent.press(view.getByRole('button', { name: 'Read the full alert' }));
  expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/alert/[id]', params: { id: 'rain' } });
  expect(view.getByRole('header', { name: 'Other alerts' })).toBeTruthy();
  expect(view.queryByLabelText(/^Caution\. Heavy rain and strong winds\./)).toBeNull();
  fireEvent.press(view.getByLabelText(/^Normal\. Water on local roads\./));
  expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/alert/[id]', params: { id: 'water' } });
  fireEvent.press(view.getByRole('button', { name: 'See all' }));
  expect(mockRouter.navigate).toHaveBeenLastCalledWith('/alerts');
});

test.each(['id', 'en'])('Home has two quick rows, help and the map, and no alerts tile (%s)', language => {
  mockLanguage = language;
  const view = render(<OverviewScreen />);
  const [help, map, alerts] = language === 'id' ? ['Minta bantuan', 'Peta Risiko', 'Peringatan'] : ['Get help', 'Risk map', 'Alerts'];
  fireEvent.press(view.getByRole('button', { name: help }));
  expect(mockRouter.navigate).toHaveBeenLastCalledWith('/buddy');
  fireEvent.press(view.getByRole('button', { name: map }));
  expect(mockRouter.navigate).toHaveBeenLastCalledWith('/discover');
  expect(view.queryByRole('button', { name: alerts })).toBeNull();
  expect(view.queryByRole('button', { name: 'Buddy' })).toBeNull();
});


let mockAutoRead = false;
jest.mock('@/features/access/use-access', () => ({ useAccess: () => ({ autoRead: mockAutoRead, simpleHome: mockSimpleHome }) }));
jest.mock('@/features/feedback/speech', () => ({ speak: jest.fn(() => Promise.resolve()) }));
beforeEach(() => { mockAutoRead = false; });

test('Home reads an alert once across re-renders and remounts', () => {
  mockAutoRead = true;
  const view = render(<OverviewScreen />);
  view.rerender(<OverviewScreen />);
  view.unmount();
  render(<OverviewScreen />);
  expect(speak).toHaveBeenCalledTimes(1);
  expect(speak).toHaveBeenCalledWith(expect.stringContaining('Heavy rain and strong winds'), 'en');
  expect(jest.mocked(speak).mock.calls[0][0]).toContain('08:30 to 11:30 WIB');
  expect(jest.mocked(speak).mock.calls[0][0]).toContain('Keep checking for updates and pack a go-bag.');
  mockTopLevel = 'siaga';
  try {
    const second = render(<OverviewScreen />);
    expect(speak).toHaveBeenCalledTimes(2);
    expect(speak).toHaveBeenLastCalledWith(expect.stringContaining('Water on local roads'), 'en');
    second.unmount();
  } finally { mockTopLevel = null; }
  render(<OverviewScreen />);
  expect(speak).toHaveBeenCalledTimes(2);
});

test('Home stays silent at Normal even with autoRead', () => {
  mockAutoRead = true;
  mockTopLevel = 'normal';
  try { render(<OverviewScreen />); expect(speak).not.toHaveBeenCalled(); }
  finally { mockTopLevel = null; }
});


let mockSimpleHome = false;
let mockAlertId: string | null = null;
const mockAlertHaptic = jest.fn();
jest.mock('@/features/feedback/haptics', () => ({ useHaptics: () => ({ alert: mockAlertHaptic, tap: jest.fn(), selection: jest.fn() }) }));
beforeEach(() => { mockSimpleHome = false; mockAlertId = null; });

test('Home vibrates once per alert id across rerenders and tab remounts', () => {
  mockAlertId = 'haptic-first';
  const view = render(<OverviewScreen />);
  view.rerender(<OverviewScreen />);
  view.unmount();
  const second = render(<OverviewScreen />);
  expect(mockAlertHaptic).toHaveBeenCalledTimes(1);
  mockAlertId = 'haptic-second';
  second.rerender(<OverviewScreen />);
  expect(mockAlertHaptic).toHaveBeenCalledTimes(2);
});

test('Home never vibrates for Normal', () => {
  mockAlertId = 'haptic-normal';
  mockTopLevel = 'normal';
  try { render(<OverviewScreen />); expect(mockAlertHaptic).not.toHaveBeenCalled(); }
  finally { mockTopLevel = null; }
});

test('simple Home reveals other alerts and disasters from its expanded disclosure', async () => {
  mockSimpleHome = true;
  const view = render(<OverviewScreen />);
  const row = view.getByRole('button', { name: /More information/ });
  expect(row).toHaveProp('accessibilityState', { expanded: false });
  expect(view.queryByText('Other alerts')).toBeNull();
  expect(view.queryByText('Discover disaster')).toBeNull();
  await act(async () => fireEvent.press(row));
  expect(view.getByRole('button', { name: /More information/ })).toHaveProp('accessibilityState', { expanded: true });
  expect(view.getByText('Other alerts')).toBeTruthy();
  expect(view.getByText('Discover disaster')).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: /More information/ }));
  expect(view.queryByText('Other alerts')).toBeNull();
  expect(view.queryByText('Discover disaster')).toBeNull();
});
