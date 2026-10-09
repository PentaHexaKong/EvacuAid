import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert, Linking, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type BottomSheet from '@gorhom/bottom-sheet';
import { LinearGradient } from 'expo-linear-gradient';
import { AppText } from '@/components/ui';
import { DiscoverScreen } from './discover';
import { EditNameScreen, ProfileScreen } from './profile';
import { AlertsScreen, AlertScreen } from './alerts';
import { ProfileProvider, PROFILE_KEY, useProfile } from '@/features/profile/context';
import { PreferencesProvider, usePreferences } from '@/features/preferences/context';
import { defaults, PREFERENCES_KEY } from '@/features/preferences/storage';
import type { DiscoverMapProps } from '@/components/discover-map';
import { apiRequest } from '@/features/profile/api';
import { colors, sky, SystemReduceMotionContext } from '@/theme';
import { topAlert } from '@/features/alerts/alerts';
import { alertItems } from '@/features/alerts/test-fixtures';
jest.mock('@/features/alerts/use-alerts', () => ({ useAlerts: () => ({ status: 'ready', items: jest.requireActual('@/features/alerts/test-fixtures').alertItems, stale: false }), findAlert: (id: string) => jest.requireActual('@/features/alerts/test-fixtures').alertItems.find((item: { id: string }) => item.id === id) }));
import type { EvacuationState } from '@/features/navigation/use-evacuation-route';

const mockRouter = { push: jest.fn(), navigate: jest.fn(), back: jest.fn(), dismissTo: jest.fn(), replace: jest.fn() };
let mockMapProps: DiscoverMapProps;
let mockSheetProps: React.ComponentProps<typeof BottomSheet>;
let mockEvac: EvacuationState & { findRoute: jest.Mock; locate: jest.Mock; clearRoute: jest.Mock };
const mockSnapToIndex = jest.fn();
const mockEnsureGuest = jest.fn();
const mockDeleteGuest = jest.fn();
let mockId = 'rain';
let mockLanguage = 'en';
let mockProfile: Record<string, unknown>;
let mockPreferences: Record<string, unknown>;
let mockFocus: string | undefined;
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, useLocalSearchParams: () => ({ id: mockId, focus: mockFocus }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, params?: { name: string }) => {
  const text = (mockLanguage === 'en' ? jest.requireActual('../localization/en.json') : jest.requireActual('../localization/id.json'))[key] ?? key;
  return params?.name ? text.replace('{{name}}', params.name) : text;
}, i18n: { language: mockLanguage } }) }));
jest.mock('@/components/settings-menu', () => ({ SettingsMenu: () => null }));
jest.mock('@/localization', () => ({ selectLanguage: jest.fn() }));

jest.mock('@/components/discover-map', () => ({ DiscoverMap: (props: DiscoverMapProps) => { mockMapProps = props; return null; } }));
jest.mock('@gorhom/bottom-sheet', () => {
  const React = jest.requireActual('react');
  const { View, ScrollView } = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: React.forwardRef(function MockSheet(props: React.ComponentProps<typeof BottomSheet>, ref: React.Ref<unknown>) {
      React.useEffect(() => { mockSheetProps = props; });
      React.useImperativeHandle(ref, () => ({ snapToIndex: mockSnapToIndex }));
      const Background = props.backgroundComponent;
      return <View testID="discover-sheet">{Background && <Background style={{}} animatedIndex={props.animatedPosition!} animatedPosition={props.animatedPosition!} />}{props.children}</View>;
    }),
    BottomSheetScrollView: ScrollView,
    useBottomSheetSpringConfigs: (config: object) => config,
  };
});
jest.mock('@/features/navigation/use-evacuation-route', () => ({ useEvacuationRoute: () => mockEvac }));
jest.mock('@/features/profile/session', () => ({ useGuestSession: () => ({ token: 'test-token', user: { id: 'user-1' }, status: 'ready', error: null, ensureGuest: mockEnsureGuest, deleteGuest: mockDeleteGuest, startNewGuest: jest.fn() }) }));
jest.mock('@/features/profile/api', () => ({ ...jest.requireActual('@/features/profile/api'), apiRequest: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 59, bottom: 34, left: 0, right: 0 }) }));

beforeEach(async () => {
  jest.restoreAllMocks(); jest.clearAllMocks(); mockId = 'rain'; mockLanguage = 'en'; await AsyncStorage.clear();
  mockEnsureGuest.mockResolvedValue(undefined);
  mockDeleteGuest.mockReset().mockResolvedValue(undefined);
  mockEvac = { phase: 'needsLocation', origin: null, shelters: null, route: null, reason: null, errorKind: null, findRoute: jest.fn(), locate: jest.fn(), clearRoute: jest.fn() };
  mockProfile = { id: 'user-1', name: null, phone: null, latitude: null, longitude: null, location_observed_at: null, location_accuracy_m: null, share_location_with_buddies: false, needs_assistance: false };
  mockPreferences = { voice_enabled: true, vibration_enabled: true, text_enabled: true, language: 'en', larger_text: false, stronger_contrast: false };
  (apiRequest as jest.Mock).mockImplementation(async (path: string, _token: string, init?: RequestInit) => {
    if (path === '/v1/me') return mockProfile;
    if (path.endsWith('/accessibility')) return [];
    if (path.endsWith('/preferences')) {
      if (init?.method === 'PUT') mockPreferences = JSON.parse(String(init.body));
      return mockPreferences;
    }
    if (init?.method === 'PATCH') { mockProfile = { ...mockProfile, ...JSON.parse(String(init.body)) }; return mockProfile; }
    return mockProfile;
  });
});

const en = jest.requireActual('../localization/en.json');
const id = jest.requireActual('../localization/id.json');
const origin = { latitude: -6.26, longitude: 106.81, accuracyM: 10, observedAt: '2026-09-17T01:00:00.000Z' };
const hall = { id: 's1', name: 'Community hall', latitude: -6.27, longitude: 106.82, status: 'OPEN', wheelchairAccessible: null, capacity: null, currentOccupancy: null, source: null, distanceM: 900 };
const school = { ...hall, id: 's2', name: 'School gym', distanceM: 2400 };
const readyRoute = {
  coordinates: [[106.81, -6.26], [106.82, -6.27]] as [number, number][],
  computedAt: new Date('2026-09-17T01:05:00.000Z'),
  response: {
    routeStatus: 'READY' as const,
    destination: { shelterId: 's1', name: 'Community hall', latitude: -6.27, longitude: 106.82, source: null },
    route: { distanceM: 900, durationSec: 660, geometry: null, profile: 'pedestrian' },
    evaluation: { safetyStatus: 'UNKNOWN' as const, accessibilityStatus: 'UNKNOWN' as const, reasonCodes: [] },
    selectionReasonCodes: [],
  },
};
function evac(state: Partial<EvacuationState>) { mockEvac = { ...mockEvac, ...state }; }

test('Discover passes safe-area and sheet insets to the fullscreen map and opens alerts from markers', () => {
  render(<DiscoverScreen />);
  expect(mockMapProps.topInset).toBe(59);
  expect(mockMapProps.bottomInset).toBeGreaterThan(34);
  expect(mockMapProps.route).toBeUndefined();
  expect(mockMapProps.items.map(item => item.kind)).toEqual(['alert', 'alert']);
  act(() => mockMapProps.onSelect('rain'));
  expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/alert/[id]', params: { id: 'rain' } });
});

test('the alert chip in the sheet header opens the current alert', () => {
  const view = render(<DiscoverScreen />);
  fireEvent.press(view.getByRole('button', { name: `${en.alertHazardWeather}. ${en.levelSiaga}` }));
  expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/alert/[id]', params: { id: 'rain' } });
});

test('the highest live alert drives the unboxed sheet banner and wash', () => {
  expect(topAlert(alertItems)).toMatchObject({ level: 'siaga', hazardType: 'EXTREME_WEATHER' });
  const view = render(<DiscoverScreen />);
  const banner = view.getByRole('button', { name: `${en.alertHazardWeather}. ${en.levelSiaga}` });
  expect(banner).toHaveStyle({ minHeight: 52, paddingVertical: 10 });
  expect(banner).not.toHaveStyle({ backgroundColor: colors.cautionSoft });
  expect(banner).not.toHaveStyle({ borderWidth: 1 });
  expect(view.getAllByText(en.alertHazardWeather)[0]).toHaveStyle({ color: sky.siaga.ink });
  expect(mockSheetProps.handleIndicatorStyle).toEqual({ backgroundColor: sky.siaga.ink, opacity: 0.25, width: 40 });
  const gradient = view.UNSAFE_getAllByType(LinearGradient).find(item => item.props.locations?.join(',') === '0,0.5,1')!;
  expect(gradient.props.colors).toEqual([sky.siaga.stops[1], sky.siaga.stops[2], colors.surface]);
  expect(gradient.props.style).toEqual(expect.objectContaining({ top: 0, height: 168 }));
  expect(gradient.parent).toHaveStyle({ backgroundColor: colors.surface, overflow: 'hidden' });
});

test('topAlert is independent of the feed order', () => {
  expect(topAlert([...alertItems].reverse())).toEqual(topAlert(alertItems));
});

test('sheet credits ride peek and middle, stay at middle when expanded and resync after layout', () => {
  const view = render(<DiscoverScreen />);
  const middle = mockMapProps.bottomInset;
  expect(mockMapProps.creditsInset).toBe(middle);
  act(() => mockSheetProps.onAnimate!(1, 0, 0, 0));
  expect(mockMapProps.creditsInset).toBe((mockSheetProps.snapPoints as number[])[0]);
  const beforeLayout = mockMapProps.creditsInset;
  const primary = view.UNSAFE_getAllByType(View).find(item => item.props.onLayout)!;
  fireEvent(primary, 'layout', { nativeEvent: { layout: { height: 260 } } });
  expect(mockMapProps.creditsInset).toBe((mockSheetProps.snapPoints as number[])[0]);
  expect(mockMapProps.creditsInset).not.toBe(beforeLayout);
  expect(mockMapProps.bottomInset).toBe(middle);
  act(() => mockSheetProps.onAnimate!(0, 1, 0, 0));
  expect(mockMapProps.creditsInset).toBe(middle);
  act(() => mockSheetProps.onAnimate!(1, 2, 0, 0));
  expect(mockMapProps.creditsInset).toBe(middle);
  fireEvent(primary, 'layout', { nativeEvent: { layout: { height: 280 } } });
  expect(mockMapProps.creditsInset).toBe(middle);
});

test('nearby reported hazards become estimated map zones, each named in the sheet', async () => {
  const quake = { id: 'q1', type: 'earthquake', occurredAt: '2026-10-03T01:00:00Z', source: 'BMKG', latitude: -6.5, longitude: 106.9, magnitude: 5.2, depthKm: 10, region: null, felt: null, reportCount: null };
  const far = { ...quake, id: 'q2', latitude: 2.5, longitude: 128.4 };
  const fallback = (apiRequest as jest.Mock).getMockImplementation()!;
  (apiRequest as jest.Mock).mockImplementation(async (path: string, ...rest: unknown[]) => (path === '/v1/hazards/recent' ? { items: [quake, far], sources: { bmkg: { status: 'available', error: null } } } : fallback(path, ...rest)));
  const view = render(<DiscoverScreen />);
  expect(await view.findByText(`${en.hazard_earthquake} M5.2`)).toBeTruthy();
  expect(view.getByLabelText(`${en.impactEstimate}: ${en.hazard_earthquake} M5.2. ${en.impactEstimateNote}`)).toBeTruthy();
  expect(mockMapProps.zones!.features.map(zone => zone.id)).toEqual(['q1-0', 'q1-1']);
});

test('a map focus is honoured only for a hazard in the feed and never hides the hazards near the user', async () => {
  const quake = { id: 'q1', type: 'earthquake', occurredAt: '2026-10-03T01:00:00Z', source: 'BMKG', latitude: -6.5, longitude: 106.9, magnitude: 5.2, depthKm: 10, region: null, felt: null, reportCount: null };
  const far = { ...quake, id: 'q2', latitude: 2.5, longitude: 128.4, magnitude: 6.1 };
  const fallback = (apiRequest as jest.Mock).getMockImplementation()!;
  (apiRequest as jest.Mock).mockImplementation(async (path: string, ...rest: unknown[]) => (path === '/v1/hazards/recent' ? { items: [quake, far], sources: { bmkg: { status: 'available', error: null } } } : fallback(path, ...rest)));
  try {
    // Coordinates that match no hazard, as a crafted deep link could carry: ignored.
    mockFocus = '10,20';
    const stray = render(<DiscoverScreen />);
    expect(await stray.findByText(`${en.hazard_earthquake} M5.2`)).toBeTruthy();
    expect(mockMapProps.focus).toBeNull();
    expect(mockMapProps.zones!.features.map(zone => zone.id)).toEqual(['q1-0', 'q1-1']);
    stray.unmount();
    // A hazard from the feed: the map frames it and adds its rings, while the nearby hazard stays on the map and in the legend.
    mockFocus = '2.5,128.4';
    const view = render(<DiscoverScreen />);
    expect(await view.findByText(`${en.hazard_earthquake} M5.2`)).toBeTruthy();
    expect(mockMapProps.focus).toEqual(expect.objectContaining({ latitude: 2.5, longitude: 128.4 }));
    expect(mockMapProps.zones!.features.map(zone => zone.id)).toEqual(['q1-0', 'q1-1', 'q2-0', 'q2-1']);
    expect(view.getByText(`${en.hazard_earthquake} M6.1`)).toBeTruthy();
  } finally { mockFocus = undefined; }
});

test('the map opens in 3D, flips to flat and back from its control, and starts flat under Reduce Motion', () => {
  const view = render(<SystemReduceMotionContext.Provider value={false}><DiscoverScreen /></SystemReduceMotionContext.Provider>);
  expect(mockMapProps.mode).toBe('3d');
  act(() => mockMapProps.onToggleMode!());
  expect(mockMapProps.mode).toBe('2d');
  act(() => mockMapProps.onToggleMode!());
  expect(mockMapProps.mode).toBe('3d');
  view.unmount();
  render(<SystemReduceMotionContext.Provider value><DiscoverScreen /></SystemReduceMotionContext.Provider>);
  expect(mockMapProps.mode).toBe('2d');
});

test('without a location Discover offers to find a route and asks the hook to do it', () => {
  const view = render(<DiscoverScreen />);
  expect(view.getByText(en.findShelterTitle)).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: en.findRouteToShelter }));
  expect(mockEvac.findRoute).toHaveBeenCalledTimes(1);
  expect(mockSnapToIndex).toHaveBeenCalledWith(0);
  act(() => mockMapProps.onLocate());
  expect(mockEvac.locate).toHaveBeenCalledTimes(1);
});

test('a located user sees the nearest shelter, other shelters and can route to a chosen one', () => {
  evac({ phase: 'located', origin, shelters: [hall, school] });
  const view = render(<DiscoverScreen />);
  expect(mockMapProps.items.filter(item => item.kind === 'destination').map(item => item.id)).toEqual(['s1', 's2']);
  expect(view.getByText(en.nearestShelter)).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: en.routeToShelter }));
  expect(mockEvac.findRoute).toHaveBeenLastCalledWith(undefined);
  fireEvent.press(view.getByText('School gym'));
  expect(mockSnapToIndex).toHaveBeenLastCalledWith(0);
  view.rerender(<DiscoverScreen />);
  expect(view.getByText(en.selectedShelter)).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: en.routeHere }));
  expect(mockEvac.findRoute).toHaveBeenLastCalledWith('s2');
});

test('a ready route shows the figures and unknown evidence, with no external map handoff', () => {
  evac({ phase: 'ready', origin, shelters: [hall], route: readyRoute });
  const view = render(<DiscoverScreen />);
  expect(mockMapProps.route).toEqual(readyRoute.coordinates);
  expect(view.getByText(/^900 m · /)).toBeTruthy();
  expect(view.getByText('Walk to Community hall')).toBeTruthy();
  expect(view.getByText(en.hazard_UNKNOWN)).toBeTruthy();
  expect(view.getByText(en.routeAccess_UNKNOWN)).toBeTruthy();
  expect(view.queryByRole('button', { name: /Apple Maps|Google Maps/ })).toBeNull();
  fireEvent.press(view.getByRole('button', { name: en.chooseAnotherShelter }));
  expect(mockEvac.clearRoute).toHaveBeenCalledTimes(1);
});

test('an unverified route never claims to be safe', () => {
  evac({ phase: 'ready', origin, shelters: [hall], route: readyRoute });
  mockLanguage = 'id';
  const view = render(<DiscoverScreen />);
  expect(view.getByText(id.hazard_UNKNOWN)).toBeTruthy();
  expect(view.queryAllByText(/\baman\b/i)).toHaveLength(0);
});

test('the no-known-hazard note is always paired with its disclaimer', () => {
  evac({ phase: 'ready', origin, shelters: [hall], route: { ...readyRoute, response: { ...readyRoute.response, evaluation: { safetyStatus: 'NO_KNOWN_HAZARD', accessibilityStatus: 'COMPATIBLE', reasonCodes: [] } } } });
  mockLanguage = 'id';
  const view = render(<DiscoverScreen />);
  expect(view.getByText(id.hazard_NO_KNOWN_HAZARD)).toBeTruthy();
  expect(id.hazard_NO_KNOWN_HAZARD).toMatch(/bukan jaminan/);
  expect(view.queryAllByText(/\baman\b/i)).toHaveLength(1);
});

test('an unavailable route explains the reason and offers a retry', () => {
  evac({ phase: 'unavailable', origin, shelters: [hall], reason: 'ROUTING_PROVIDER_UNAVAILABLE' });
  const view = render(<DiscoverScreen />);
  expect(view.getByText(en.routeUnavailableTitle)).toBeTruthy();
  expect(view.getByText(en.routeReason_ROUTING_PROVIDER_UNAVAILABLE)).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: en.tryAgain }));
  expect(mockEvac.findRoute).toHaveBeenCalledTimes(1);
});

test('hazard-aware routing statuses have their own copy', () => {
  evac({ phase: 'ready', origin, shelters: [hall], route: { ...readyRoute, response: { ...readyRoute.response, evaluation: { safetyStatus: 'EXPOSED', accessibilityStatus: 'UNKNOWN', reasonCodes: [] } } } });
  expect(render(<DiscoverScreen />).getByText(en.hazard_EXPOSED)).toBeTruthy();
  evac({ phase: 'unavailable', origin, shelters: [hall], reason: 'NO_FEASIBLE_ROUTE' });
  expect(render(<DiscoverScreen />).getByText(en.routeReason_NO_FEASIBLE_ROUTE)).toBeTruthy();
});

test('a denied permission points to Settings', () => {
  evac({ phase: 'denied' });
  const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
  const view = render(<DiscoverScreen />);
  expect(view.getByText(en.locationDeniedTitle)).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: en.openSettings }));
  expect(openSettings).toHaveBeenCalledTimes(1);
});

test('a network error shows the connection message and a missing session asks for a new guest instead of routing', () => {
  evac({ phase: 'error', errorKind: 'network' });
  const view = render(<DiscoverScreen />);
  expect(view.getByText(en.routeErrorTitle)).toBeTruthy();
  expect(view.getByText(en.routeErrorConnection)).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: en.tryAgain }));
  expect(mockEvac.findRoute).toHaveBeenCalledTimes(1);
  evac({ errorKind: 'session' });
  view.rerender(<DiscoverScreen />);
  fireEvent.press(view.getByRole('button', { name: en.tryAgain }));
  expect(mockEnsureGuest).toHaveBeenCalledTimes(1);
  expect(mockEvac.findRoute).toHaveBeenCalledTimes(1);
});

test('notification details stay in the sheet and onward actions dismiss it', () => {
  const view = render(<View><AlertsScreen sheet /></View>);
  fireEvent.press(view.getByText(jest.requireActual('../localization/en.json').alertHazardWeather));
  expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/alerts/[id]', params: { id: 'rain' } });
  view.rerender(<View><AlertScreen sheet /></View>);
  expect(view.getByText('Alert')).toBeTruthy();
  for (const step of ['Check your route to the nearest gathering point', 'Tell the people who rely on you', 'Be ready to leave']) expect(view.getByText(step)).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: 'Request help' }));
  expect(mockRouter.dismissTo).toHaveBeenLastCalledWith({ pathname: '/buddy', params: undefined });
  fireEvent.press(view.getByRole('button', { name: 'Find gathering point' }));
  expect(mockRouter.dismissTo).toHaveBeenLastCalledWith({ pathname: '/discover', params: { route: expect.any(String) } });
  view.rerender(<View><AlertScreen /></View>);
  fireEvent.press(view.getByRole('button', { name: 'Request help' }));
  expect(mockRouter.navigate).toHaveBeenLastCalledWith({ pathname: '/buddy', params: undefined });
});

function SavedName() { return <AppText>{useProfile().name || 'fallback'}</AppText>; }
test('profile form retains failed drafts and retries', async () => {
  await AsyncStorage.setItem(PROFILE_KEY, '{"name":"Billy"}');
  const view = render(<ProfileProvider><EditNameScreen /><SavedName /></ProfileProvider>);
  await waitFor(() => expect(view.getByDisplayValue('Billy')).toBeTruthy());
  expect(view.getByLabelText('Name')).toHaveProp('maxLength', 60);
  fireEvent.changeText(view.getByLabelText('Name'), '  New name  ');
  (apiRequest as jest.Mock).mockRejectedValueOnce(new Error('network'));
  fireEvent.press(view.getByRole('button', { name: 'Save profile' }));
  await waitFor(() => expect(view.getByRole('alert')).toBeTruthy());
  expect(view.getByLabelText('Name')).toHaveProp('value', '  New name  ');
  fireEvent.press(view.getByRole('button', { name: 'Save profile' }));
  await waitFor(() => expect(view.getByText('New name')).toBeTruthy());
  expect(await AsyncStorage.getItem(PROFILE_KEY)).toBeNull();
});

test('resetting first-time guide keeps server profile and support preferences', async () => {
  await AsyncStorage.setItem(PROFILE_KEY, '{"name":"Billy"}');
  await AsyncStorage.setItem('evacuaid.language', 'id');
  await AsyncStorage.setItem(PREFERENCES_KEY, '{"completed":true,"largerText":true,"strongerContrast":true}');
  const view = render(<PreferencesProvider><ProfileProvider><ProfileScreen /></ProfileProvider></PreferencesProvider>);
  await waitFor(() => expect(view.getByText('Billy')).toBeTruthy());
  fireEvent.press(view.getByRole('button', { name: 'Replay guide, Start' }));
  await waitFor(async () => expect(JSON.parse((await AsyncStorage.getItem(PREFERENCES_KEY))!).completed).toBe(false));
  expect(mockProfile.name).toBe('Billy');
  expect(await AsyncStorage.getItem(PROFILE_KEY)).toBeNull();
  expect(await AsyncStorage.getItem('evacuaid.language')).toBe('id');
  expect(JSON.parse((await AsyncStorage.getItem(PREFERENCES_KEY))!)).toEqual({ completed: false });
});

function ProfileDeleteGate() {
  const { preferences, ready } = usePreferences();
  return <View><AppText testID="preferences">{JSON.stringify(preferences)}</AppText>{ready && preferences.completed ? <ProfileScreen /> : <AppText>Setup</AppText>}</View>;
}

test('a failed profile delete restores completed onboarding and all preferences without changing saved storage', async () => {
  const value = { ...defaults, completed: true, largerText: true, strongerContrast: true, voiceEnabled: false, vibrationEnabled: false, textEnabled: false, language: 'en' as const };
  await AsyncStorage.setItem(PREFERENCES_KEY, JSON.stringify(value));
  mockProfile.name = 'Billy';
  mockDeleteGuest.mockRejectedValueOnce(new Error('network'));
  const alert = jest.spyOn(Alert, 'alert');
  const view = render(<PreferencesProvider><ProfileProvider><ProfileDeleteGate /></ProfileProvider></PreferencesProvider>);
  await waitFor(() => expect(view.getByRole('button', { name: en.deleteProfile })).toBeTruthy());
  expect(JSON.parse(view.getByTestId('preferences').props.children)).toEqual(value);
  const saved = await AsyncStorage.getItem(PREFERENCES_KEY);
  expect(saved).toBe('{"completed":true}');
  fireEvent.press(view.getByRole('button', { name: en.deleteProfile }));
  await act(async () => alert.mock.calls[0][2]![1].onPress!());
  await waitFor(() => expect(alert).toHaveBeenCalledWith(en.deleteProfileError));
  expect(JSON.parse(view.getByTestId('preferences').props.children)).toEqual(value);
  expect(await AsyncStorage.getItem(PREFERENCES_KEY)).toBe(saved);
  expect(view.getByText('Billy')).toBeTruthy();
  expect(view.getByRole('button', { name: en.deleteProfile })).toBeTruthy();
  expect(mockDeleteGuest).toHaveBeenCalledTimes(1);
});

test('a successful profile delete resets onboarding before deleting the guest', async () => {
  await AsyncStorage.setItem(PREFERENCES_KEY, '{"completed":true}');
  const alert = jest.spyOn(Alert, 'alert');
  const view = render(<PreferencesProvider><ProfileProvider><ProfileDeleteGate /></ProfileProvider></PreferencesProvider>);
  await waitFor(() => expect(view.getByRole('button', { name: en.deleteProfile })).toBeTruthy());
  mockDeleteGuest.mockImplementationOnce(async () => {
    expect(await AsyncStorage.getItem(PREFERENCES_KEY)).toBe('{"completed":false}');
  });
  fireEvent.press(view.getByRole('button', { name: en.deleteProfile }));
  await act(async () => alert.mock.calls[0][2]![1].onPress!());
  await waitFor(() => expect(mockDeleteGuest).toHaveBeenCalledTimes(1));
  await act(async () => {});
  expect(JSON.parse(view.getByTestId('preferences').props.children)).toEqual({ ...defaults, completed: false, language: 'en' });
  expect(await AsyncStorage.getItem(PREFERENCES_KEY)).toBe('{"completed":false}');
  expect(view.getByText('Setup')).toBeTruthy();
  expect(alert).not.toHaveBeenCalledWith(en.deleteProfileError);
});

test('a failed onboarding restore still shows the profile deletion error', async () => {
  await AsyncStorage.setItem(PREFERENCES_KEY, '{"completed":true}');
  mockDeleteGuest.mockImplementationOnce(async () => {
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('storage'));
    throw new Error('network');
  });
  const alert = jest.spyOn(Alert, 'alert');
  const view = render(<PreferencesProvider><ProfileProvider><ProfileDeleteGate /></ProfileProvider></PreferencesProvider>);
  await waitFor(() => expect(view.getByRole('button', { name: en.deleteProfile })).toBeTruthy());
  fireEvent.press(view.getByRole('button', { name: en.deleteProfile }));
  await act(async () => alert.mock.calls[0][2]![1].onPress!());
  await waitFor(() => expect(alert).toHaveBeenCalledWith(en.deleteProfileError));
  expect(mockDeleteGuest).toHaveBeenCalledTimes(1);
});

test('Larger Text grows the settings row labels', async () => {
  await AsyncStorage.setItem(PROFILE_KEY, '{"name":"Billy"}');
  await AsyncStorage.setItem(PREFERENCES_KEY, '{"completed":true,"largerText":true}');
  const view = render(<PreferencesProvider><ProfileProvider><ProfileScreen /></ProfileProvider></PreferencesProvider>);
  await waitFor(() => expect(view.getByText('Billy')).toBeTruthy());
  expect(view.getByText('Replay guide')).toHaveStyle({ fontSize: 26.4 });
});

test('new copy has Indonesian parity and Profile uses the localized fallback', async () => {
  expect(Object.keys(en).sort()).toEqual(Object.keys(id).sort());
  mockLanguage = 'id';
  const view = render(<ProfileProvider><ProfileScreen /></ProfileProvider>);
  await waitFor(() => expect(view.getByText('Profil tamu')).toBeTruthy());
  expect(view.queryByText('Profil tamu · perangkat ini')).toBeNull();
});

test('settings toggles save immediately, without a Save button', async () => {
  await AsyncStorage.setItem(PREFERENCES_KEY, '{"completed":true}');
  const view = render(<PreferencesProvider><ProfileProvider><ProfileScreen /></ProfileProvider></PreferencesProvider>);
  await waitFor(() => expect(view.getByText('Guest profile')).toBeTruthy());
  expect(view.queryByRole('button', { name: 'Save changes' })).toBeNull();
  fireEvent(view.getByRole('switch', { name: 'Larger text' }), 'valueChange', true);
  await waitFor(() => expect(mockPreferences.larger_text).toBe(true));
  expect(view.getByRole('button', { name: 'Language, English' })).toBeTruthy();
  expect(view.getByRole('button', { name: 'Reduce motion, System' })).toBeTruthy();
});

test('the status card asks to save a location, then offers an update once one is shared', async () => {
  const first = render(<PreferencesProvider><ProfileProvider><ProfileScreen /></ProfileProvider></PreferencesProvider>);
  await waitFor(() => expect(first.getByText('No location saved')).toBeTruthy());
  expect(first.getByRole('button', { name: 'Save location' })).toBeTruthy();
  expect(first.queryByLabelText('Share distance with contacts')).toBeNull();
  first.unmount();
  mockProfile = { ...mockProfile, latitude: -6.2, longitude: 106.8, location_observed_at: new Date(Date.now() - 2 * 60_000).toISOString(), location_accuracy_m: 20 };
  const second = render(<PreferencesProvider><ProfileProvider><ProfileScreen /></ProfileProvider></PreferencesProvider>);
  await waitFor(() => expect(second.getByText('Location shared')).toBeTruthy());
  expect(second.getByRole('button', { name: 'Update' })).toBeTruthy();
  expect(second.getByLabelText('Share distance with contacts')).toBeTruthy();
});

test('the language row opens a native menu whose choice saves the language', async () => {
  const view = render(<PreferencesProvider><ProfileProvider><ProfileScreen /></ProfileProvider></PreferencesProvider>);
  await waitFor(() => expect(view.getByRole('button', { name: 'Language, English' })).toBeTruthy());
  fireEvent.press(view.getByRole('menuitem', { name: 'Bahasa Indonesia' }));
  await waitFor(() => expect(mockPreferences.language).toBe('id'));
});

let mockListFirst = false;
jest.mock('@/features/access/use-access', () => ({ useAccess: () => ({ listen: false, autoRead: false, listFirst: mockListFirst, stepFree: mockStepFree }) }));
beforeEach(() => { mockListFirst = false; });

test.each([false, true])('Discover starts on the tall list only with listFirst (%s)', async listFirst => {
  mockListFirst = listFirst;
  render(<DiscoverScreen />);
  await act(async () => {});
  expect(mockSheetProps.index).toBe(listFirst ? 2 : 1);
  expect(mockMapProps).toBeDefined();
});


let mockStepFree = false;
beforeEach(() => { mockStepFree = false; });
test.each([false, true])('other shelters keep stable accessibility groups only with stepFree (%s)', async stepFree => {
  mockStepFree = stepFree;
  mockEvac.phase = 'located';
  mockEvac.origin = { latitude: -6.2, longitude: 106.8, accuracyM: 5, observedAt: new Date().toISOString() };
  const values = [null, false, null, true, false, true, null];
  mockEvac.shelters = values.map((wheelchairAccessible, index) => ({ id: String(index), name: `Point ${index}`, latitude: -6.2, longitude: 106.8, wheelchairAccessible, distanceM: index * 100, status: 'OPEN', capacity: null, currentOccupancy: null, source: null }));
  const view = render(<DiscoverScreen />);
  await act(async () => {});
  const labels = view.getAllByRole('button').map(row => row.props.accessibilityLabel ?? row.findAllByType(AppText).map(text => text.props.children).join(' ')).filter(label => String(label).startsWith('Point'));
  expect(labels.map(label => String(label).slice(0, 7))).toEqual((stepFree ? [3, 5, 2, 6, 1, 4] : [1, 2, 3, 4, 5, 6]).map(index => `Point ${index}`));
  expect(view.getByText('Point 0')).toBeTruthy();
});

test.each([false, true])('Discover offers buddy help only for support needs (has origin: %s)', async hasOrigin => {
  if (hasOrigin) evac({ phase: 'located', origin, shelters: [hall, school] });
  const view = render(<ProfileProvider><DiscoverScreen /></ProfileProvider>);
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/v1/users/user-1/accessibility', 'test-token'));
  expect(view.queryByRole('button', { name: en.askBuddy })).toBeNull();
  view.unmount();
  (apiRequest as jest.Mock).mockImplementation(async (path: string) => path.endsWith('/accessibility') ? [{ type: 'MOBILITY_LIMITATION', severity: null }] : mockProfile);
  const needs = render(<ProfileProvider><DiscoverScreen /></ProfileProvider>);
  await waitFor(() => expect(needs.getByRole('button', { name: en.askBuddy })).toBeTruthy());
  fireEvent.press(needs.getByRole('button', { name: en.askBuddy }));
  expect(mockRouter.navigate).toHaveBeenLastCalledWith({ pathname: '/buddy', params: { help: expect.any(String) } });
});
