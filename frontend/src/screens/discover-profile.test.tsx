import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppText } from '@/components/ui';
import { DiscoverScreen } from './discover';
import { EditNameScreen, ProfileScreen } from './profile';
import { AlertsScreen, AlertScreen } from './alerts';
import { OverviewScreen } from './overview';
import { ProfileProvider, PROFILE_KEY, useProfile } from '@/features/profile/context';
import { PreferencesProvider } from '@/features/preferences/context';
import { PREFERENCES_KEY } from '@/features/preferences/storage';
import { sampleAlerts, sampleDestinations } from '@/features/content/samples';
import type { DiscoverMapProps } from '@/components/discover-map';

const mockRouter = { push: jest.fn(), navigate: jest.fn(), back: jest.fn(), dismissTo: jest.fn() };
let mockMapProps: DiscoverMapProps;
let mockId = 'rain';
let mockLanguage = 'en';
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, useLocalSearchParams: () => ({ id: mockId }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, params?: { name: string }) => {
  const text = (mockLanguage === 'en' ? jest.requireActual('../localization/en.json') : jest.requireActual('../localization/id.json'))[key] ?? key;
  return params?.name ? text.replace('{{name}}', params.name) : text;
}, i18n: { language: mockLanguage } }) }));
jest.mock('@/components/settings-menu', () => ({ SettingsMenu: () => null }));
jest.mock('@/components/discover-map', () => ({ DiscoverMap: (props: DiscoverMapProps) => { mockMapProps = props; return null; } }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 59, bottom: 34, left: 0, right: 0 }) }));
jest.mock('heroui-native/card', () => {
  const { View } = jest.requireActual('react-native');
  return { Card: Object.assign(({ children }: { children: React.ReactNode }) => <View>{children}</View>, { Body: View }) };
});
jest.mock('heroui-native/button', () => {
  const { Pressable } = jest.requireActual('react-native');
  return { Button: (props: React.ComponentProps<typeof Pressable>) => <Pressable accessibilityRole="button" {...props} /> };
});
jest.mock('heroui-native/input', () => ({ Input: jest.requireActual('react-native').TextInput }));
jest.mock('heroui-native/chip', () => ({ Chip: jest.requireActual('react-native').View }));

beforeEach(async () => { jest.restoreAllMocks(); jest.clearAllMocks(); mockId = 'rain'; mockLanguage = 'en'; await AsyncStorage.clear(); });

test('Discover filters markers and cards together, selects markers and opens existing details', () => {
  const view = render(<DiscoverScreen />);
  expect(mockMapProps.items).toHaveLength(4);
  fireEvent.press(view.getByRole('tab', { name: 'Alerts' }));
  expect(mockMapProps.items.map(item => item.kind)).toEqual(['alert', 'alert']);
  expect(view.queryByText('Community hall · example')).toBeNull();
  act(() => mockMapProps.onSelect('rain'));
  expect(mockMapProps.selected).toBe('rain');
  expect(view.getByText('Selected on the map')).toBeTruthy();
  fireEvent.press(view.getByText(mockMapProps.items[0].title));
  expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/alert/[id]', params: { id: 'rain' } });
  fireEvent.press(view.getByRole('tab', { name: 'Destinations' }));
  expect(mockMapProps.items).toHaveLength(2);
  expect(mockMapProps.selected).toBeNull();
  fireEvent.press(view.getByText('Community hall · example'));
  expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/destinations/[id]', params: { id: 'community-hall' } });
  view.rerender(<DiscoverScreen />);
  expect(view.getByRole('tab', { name: 'Destinations' })).toHaveProp('accessibilityState', { selected: true });
});

test('Discover and notifications retain readable empty states', () => {
  const mutableAlerts = sampleAlerts as unknown as (typeof sampleAlerts)[number][];
  const mutableDestinations = sampleDestinations as unknown as (typeof sampleDestinations)[number][];
  const alerts = mutableAlerts.splice(0);
  const destinations = mutableDestinations.splice(0);
  try {
    const discover = render(<DiscoverScreen />);
    expect(mockMapProps.items).toHaveLength(0);
    expect(discover.getByText('No examples match this filter. Choose another category.')).toBeTruthy();
    discover.unmount();
    const notifications = render(<AlertsScreen sheet />);
    expect(notifications.getByText(jest.requireActual('../localization/en.json').noAlerts)).toBeTruthy();
  } finally { mutableAlerts.push(...alerts); mutableDestinations.push(...destinations); }
});

test('notification details stay in the sheet and onward actions dismiss it', () => {
  const view = render(<View><AlertsScreen sheet /></View>);
  fireEvent.press(view.getByText(jest.requireActual('../localization/en.json').rainTitle));
  expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/alerts/[id]', params: { id: 'rain' } });
  view.rerender(<View><AlertScreen sheet /></View>);
  fireEvent.press(view.getByRole('button', { name: 'Request help' }));
  expect(mockRouter.dismissTo).toHaveBeenLastCalledWith('/buddy');
  fireEvent.press(view.getByRole('button', { name: 'View destinations' }));
  expect(mockRouter.dismissTo).toHaveBeenLastCalledWith('/destinations');
  view.rerender(<View><AlertScreen /></View>);
  fireEvent.press(view.getByRole('button', { name: 'Request help' }));
  expect(mockRouter.navigate).toHaveBeenLastCalledWith('/buddy');
});

function SavedName() { return <AppText>{useProfile().name || 'fallback'}</AppText>; }
test('name form cancels without saving, retains failed drafts, retries, and updates Home', async () => {
  await AsyncStorage.setItem(PROFILE_KEY, '{"name":"Billy"}');
  const view = render(<ProfileProvider><EditNameScreen /><SavedName /></ProfileProvider>);
  await waitFor(() => expect(view.getByDisplayValue('Billy')).toBeTruthy());
  expect(view.getByLabelText('Name')).toHaveProp('maxLength', 60);
  fireEvent.changeText(view.getByLabelText('Name'), '  New name  ');
  fireEvent.press(view.getByRole('button', { name: 'Cancel' }));
  expect(await AsyncStorage.getItem(PROFILE_KEY)).toBe('{"name":"Billy"}');
  jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('storage'));
  fireEvent.press(view.getByRole('button', { name: 'Save name' }));
  await waitFor(() => expect(view.getByRole('alert')).toBeTruthy());
  expect(view.getByLabelText('Name')).toHaveProp('value', '  New name  ');
  fireEvent.press(view.getByRole('button', { name: 'Save name' }));
  await waitFor(() => expect(view.getByText('New name')).toBeTruthy());
  view.rerender(<ProfileProvider><OverviewScreen /></ProfileProvider>);
  expect(view.getByText('Hello, New name')).toBeTruthy();
});

test('logout keeps name, language and support preferences', async () => {
  await AsyncStorage.setItem(PROFILE_KEY, '{"name":"Billy"}');
  await AsyncStorage.setItem('evacuaid.language', 'id');
  await AsyncStorage.setItem(PREFERENCES_KEY, '{"completed":true,"largerText":true,"strongerContrast":true}');
  const view = render(<PreferencesProvider><ProfileProvider><ProfileScreen /></ProfileProvider></PreferencesProvider>);
  await waitFor(() => expect(view.getByText('Billy')).toBeTruthy());
  fireEvent.press(view.getByRole('button', { name: 'Log out' }));
  await waitFor(() => expect(JSON.parse((AsyncStorage.setItem as jest.Mock).mock.calls.at(-1)[1]).completed).toBe(false));
  expect(await AsyncStorage.getItem(PROFILE_KEY)).toBe('{"name":"Billy"}');
  expect(await AsyncStorage.getItem('evacuaid.language')).toBe('id');
  expect(JSON.parse((await AsyncStorage.getItem(PREFERENCES_KEY))!)).toEqual({ completed: false, largerText: true, strongerContrast: true });
});

test('new copy has Indonesian parity and Profile uses the localized fallback', async () => {
  const en = jest.requireActual('../localization/en.json');
  const id = jest.requireActual('../localization/id.json');
  expect(Object.keys(en).sort()).toEqual(Object.keys(id).sort());
  mockLanguage = 'id';
  const view = render(<ProfileProvider><ProfileScreen /></ProfileProvider>);
  await waitFor(() => expect(view.getByText('Profil Anda')).toBeTruthy());
  expect(view.getByText('Disimpan di perangkat ini')).toBeTruthy();
});
