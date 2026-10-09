import { speak } from '@/features/feedback/speech';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PreferencesProvider } from '@/features/preferences/context';
import { defaults, PREFERENCES_KEY } from '@/features/preferences/storage';
import { ONBOARDING_NEEDS_KEY } from '@/features/profile/context';
import { SetupScreen } from './setup';
import { OverviewScreen } from './overview';

let mockAccessibility: { type: string; severity: null }[] = [];
let mockIncomingContacts: { name: string | null }[] = [];
let mockNotifications: boolean | undefined;
jest.mock('@/features/profile/context', () => ({ ...jest.requireActual('@/features/profile/context'), useProfile: () => ({ accessibility: mockAccessibility }) }));
jest.mock('@/features/buddy-pilot/use-incoming-contacts', () => ({ useIncomingContacts: () => mockIncomingContacts }));
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
  return { useRouter: () => mockRouter, useIsFocused: () => mockFocused, Stack: { Toolbar } };
});
jest.mock('expo-router/react-navigation', () => ({ ...jest.requireActual('expo-router/react-navigation'), useHeaderHeight: () => 100 }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => (mockLanguage === 'id' ? jest.requireActual('../localization/id.json') : jest.requireActual('../localization/en.json'))[key] ?? key, i18n: { language: mockLanguage } }) }));
jest.mock('@/components/settings-menu', () => ({ SettingsMenu: ({ notifications }: { notifications?: boolean }) => { mockNotifications = notifications; return null; } }));
jest.mock('@/localization', () => ({ selectLanguage: jest.fn() }));
const { selectLanguage } = jest.requireMock('@/localization') as { selectLanguage: jest.Mock };
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));


beforeEach(async () => { jest.restoreAllMocks(); jest.clearAllMocks(); mockLanguage = 'en'; mockAccessibility = []; mockIncomingContacts = []; await AsyncStorage.clear(); });

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
  // The menu names the current language; each option is written in its own language.
  expect(view.getByRole('button', { name: 'Language, English' })).toBeTruthy();
  await act(async () => fireEvent.press(view.getByRole('menuitem', { name: 'Bahasa Indonesia' })));
  expect(selectLanguage).toHaveBeenCalledWith('id');
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

test.each(['id', 'en'])('support-needs Home has two quick rows, help and the map, and no alerts tile (%s)', language => {
  mockLanguage = language;
  mockAccessibility = [{ type: 'MOBILITY_LIMITATION', severity: null }];
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
jest.mock('@/features/access/use-access', () => ({ useAccess: () => ({ autoRead: mockAutoRead, simpleHome: mockSimpleHome, voiceHome: mockVoiceHome, listen: mockListen, soundFree: mockSoundFree }) }));
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


let mockVoiceHome = false;
let mockListen = true;
let mockSoundFree = false;
let mockListening = false;
let mockFocused = true;
let mockOnCommand: (transcript: string) => void = () => {};
const mockStartListening = jest.fn(() => Promise.resolve());
const mockStopListening = jest.fn();
const mockCancelListening = jest.fn();
jest.mock('@/features/buddy-pilot/native', () => ({ useBuddySpeech: ({ onCommand }: { onCommand: (transcript: string) => void }) => { mockOnCommand = onCommand; return { listening: mockListening, error: mockVoiceError, startListening: mockStartListening, stopListening: mockStopListening, cancelListening: mockCancelListening }; } }));
let mockVoiceError: string | null = null;
beforeEach(() => { mockVoiceHome = false; mockListen = true; mockSoundFree = false; mockListening = false; mockFocused = true; mockVoiceError = null; });

test('the voice Home leads with Speak and three spoken-word actions, and leaves the map wording to everyone else', () => {
  const standard = render(<OverviewScreen />);
  expect(standard.queryByRole('button', { name: 'Speak' })).toBeNull();
  expect(standard.getByText('Risk map')).toBeTruthy();
  standard.unmount();
  mockVoiceHome = true;
  mockShelters = [{ name: 'Aula Kelurahan', distanceM: 250 }];
  try {
    const view = render(<OverviewScreen />);
    expect(view.getByRole('button', { name: 'Speak' })).toHaveProp('accessibilityHint', 'Then say what you need. A two-finger double-tap anywhere on this screen does the same. Say “read the alert”, “nearest gathering point” or “help me”.');
    expect(view.getByText('Read the alert aloud')).toBeTruthy();
    expect(view.getByText('Aula Kelurahan · 250 m')).toBeTruthy();
    expect(view.getByText('Ask for help')).toBeTruthy();
    expect(view.queryByText('Risk map')).toBeNull();
    // Other alerts and the disaster strip wait behind More, so VoiceOver reaches the actions in a few swipes.
    expect(view.queryByText('Other alerts')).toBeNull();
    expect(view.getByRole('button', { name: /More information/ })).toBeTruthy();
    fireEvent.press(view.getByRole('button', { name: 'Speak' }));
    expect(mockStartListening).toHaveBeenCalledTimes(1);
  } finally { mockShelters = null; }
});

test.each(['id', 'en'])('the Speak hint includes command examples without reading the visible line twice (%s)', language => {
  mockLanguage = language;
  mockVoiceHome = true;
  const copy = jest.requireActual(`../localization/${language}.json`);
  const view = render(<OverviewScreen />);
  expect(view.getByRole('button', { name: copy.voiceSpeak })).toHaveProp('accessibilityHint', `${copy.voiceHint} ${copy.voiceExamples}`);
  expect(view.queryByText(copy.voiceExamples)).toBeNull();
  expect(view.getByText(copy.voiceExamples, { includeHiddenElements: true })).toHaveProp('accessibilityElementsHidden', true);
  expect(view.getByText(copy.voiceExamples, { includeHiddenElements: true })).toHaveProp('importantForAccessibility', 'no-hide-descendants');
});

test('the voice Home stops listening from the same button and starts from a Magic Tap anywhere', () => {
  mockVoiceHome = true;
  mockListening = true;
  const view = render(<OverviewScreen />);
  const button = view.getByRole('button', { name: 'Listening…' });
  expect(button).toHaveProp('accessibilityState', { busy: true });
  fireEvent.press(button);
  expect(mockStopListening).toHaveBeenCalledTimes(1);
  mockListening = false;
  view.rerender(<OverviewScreen />);
  fireEvent(view.getByText('Ask for help'), 'magicTap');
  expect(mockStartListening).toHaveBeenCalledTimes(1);
});

test('spoken commands on the voice Home read the alert, open the gathering points, ask for help, or say they were not understood', () => {
  mockVoiceHome = true;
  mockShelters = [{ name: 'Aula Kelurahan', distanceM: 250 }];
  try {
    render(<OverviewScreen />);
    jest.mocked(speak).mockClear();
    act(() => mockOnCommand('read the alert'));
    expect(jest.mocked(speak).mock.calls.at(-1)![0]).toContain('Heavy rain and strong winds');
    act(() => mockOnCommand('titik kumpul terdekat'));
    expect(jest.mocked(speak).mock.calls.at(-1)![0]).toBe('Nearest gathering point: Aula Kelurahan, 250 m');
    expect(mockRouter.navigate).toHaveBeenLastCalledWith('/discover');
    // Help wins even when the sentence also names a gathering point, and it goes to Buddy, which confirms before sending.
    act(() => mockOnCommand('tolong, di mana titik kumpul'));
    expect(mockRouter.navigate).toHaveBeenLastCalledWith({ pathname: '/buddy', params: { help: expect.any(String) } });
    act(() => mockOnCommand('what time is it'));
    expect(jest.mocked(speak).mock.calls.at(-1)![0]).toBe('Sorry, I didn’t catch that. Say read the alert, nearest gathering point or help me.');
  } finally { mockShelters = null; }
});

test('when voice fails the voice Home says so on screen as well as aloud, and the buttons stay', () => {
  mockVoiceHome = true;
  const view = render(<OverviewScreen />);
  expect(view.getByText('Say “read the alert”, “nearest gathering point” or “help me”.', { includeHiddenElements: true })).toBeTruthy();
  jest.mocked(speak).mockClear();
  mockVoiceError = 'Speech recognition stopped.';
  view.rerender(<OverviewScreen />);
  expect(view.getByRole('alert')).toHaveTextContent('Voice isn’t available right now. The buttons below still work.');
  expect(jest.mocked(speak).mock.calls.at(-1)![0]).toBe('Voice isn’t available right now. The buttons below still work.');
  expect(view.getByText('Ask for help')).toBeTruthy();
});


test.each([false, true])('the voice Home stays silent without listening, including sound-free mode (%s)', soundFree => {
  mockVoiceHome = true;
  mockListen = false;
  mockSoundFree = soundFree;
  mockVoiceError = 'Speech recognition stopped.';
  const view = render(<OverviewScreen />);
  expect(view.queryByRole('button', { name: 'Speak' })).toBeNull();
  expect(view.queryByText('Read the alert aloud')).toBeNull();
  expect(view.queryByText('Say “read the alert”, “nearest gathering point” or “help me”.', { includeHiddenElements: true })).toBeNull();
  expect(view.queryByRole('alert')).toBeNull();
  expect(view.getByRole('button', { name: /More information/ })).toHaveProp('accessibilityState', { expanded: false });
  expect(view.queryByText('Other alerts')).toBeNull();
  expect(view.UNSAFE_getAllByType(View).some(node => node.props.onMagicTap)).toBe(false);
  fireEvent.press(view.getByRole('button', { name: 'Nearest gathering point' }));
  expect(mockRouter.navigate).toHaveBeenLastCalledWith('/discover');
  fireEvent.press(view.getByRole('button', { name: 'Ask for help' }));
  expect(mockRouter.navigate).toHaveBeenLastCalledWith({ pathname: '/buddy', params: { help: expect.any(String) } });
  fireEvent(view.getByText('Ask for help'), 'magicTap');
  act(() => { mockOnCommand('read the alert'); mockOnCommand('what time is it'); });
  expect(mockStartListening).not.toHaveBeenCalled();
  expect(speak).not.toHaveBeenCalled();
});


test('the voice Home ignores speech commands while unfocused and resumes on return', () => {
  mockVoiceHome = true;
  const view = render(<OverviewScreen />);
  mockFocused = false;
  view.rerender(<OverviewScreen />);
  act(() => { mockOnCommand('read the alert'); mockOnCommand('nearest gathering point'); mockOnCommand('help me'); mockOnCommand('what time is it'); });
  expect(mockRouter.navigate).not.toHaveBeenCalled();
  expect(speak).not.toHaveBeenCalled();
  mockFocused = true;
  view.rerender(<OverviewScreen />);
  act(() => mockOnCommand('help me'));
  expect(mockRouter.navigate).toHaveBeenCalledWith({ pathname: '/buddy', params: { help: expect.any(String) } });
});

test('leaving the voice Home while listening cancels recognition without stopping it', () => {
  mockVoiceHome = true;
  mockListening = true;
  const view = render(<OverviewScreen />);
  expect(mockCancelListening).not.toHaveBeenCalled();
  mockFocused = false;
  view.rerender(<OverviewScreen />);
  expect(mockCancelListening).toHaveBeenCalledTimes(1);
  expect(mockStopListening).not.toHaveBeenCalled();
  act(() => mockOnCommand('help me'));
  expect(mockRouter.navigate).not.toHaveBeenCalled();
});

test('helper Home shows the map without Get help or a notification bell', () => {
  const view = render(<OverviewScreen />);
  expect(view.queryByText('Get help')).toBeNull();
  expect(view.queryByText('People who rely on you')).toBeNull();
  expect(view.getByText('Risk map')).toBeTruthy();
  expect(mockNotifications).toBeUndefined();
});

test('helper Home names people relying on them and opens Buddy', () => {
  mockIncomingContacts = [{ name: 'Ari' }, { name: 'Budi' }, { name: 'Citra' }];
  const view = render(<OverviewScreen />);
  const row = view.getByRole('button', { name: 'People who rely on you. Ari, Budi, +1' });
  fireEvent.press(row);
  expect(mockRouter.navigate).toHaveBeenLastCalledWith('/buddy');
  expect(view.queryByText('Get help')).toBeNull();
  mockIncomingContacts = [{ name: null }];
  view.rerender(<OverviewScreen />);
  expect(view.getByRole('button', { name: 'People who rely on you. See who might need you' })).toBeTruthy();
  mockAccessibility = [{ type: 'HEARING_IMPAIRMENT', severity: null }];
  view.rerender(<OverviewScreen />);
  expect(view.queryByText('People who rely on you')).toBeNull();
  expect(view.getByText('Get help')).toBeTruthy();
});
