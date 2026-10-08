import { Children } from 'react';
import { buddyStyles } from '@/features/buddy-pilot/ui/parts';
import { Alert, AppState, View } from 'react-native';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { RouteView } from '@/features/buddy-pilot/ui/route-view';
import { BuddyPilotScreen } from './buddy-pilot';

const mockRun = jest.fn();
const mockRefresh = jest.fn();
const mockSpeak = jest.fn();
const mockEnableNotifications = jest.fn().mockResolvedValue(undefined);
const mockStartListening = jest.fn();
const mockStopListening = jest.fn();
let mockListening = false;
let mockSession: unknown = null;
let mockContacts: unknown[] = [];
let mockInvitations: unknown[] = [];
let mockParams: { code?: string } = {};
let mockAvailability = { optedIn: false };
let mockLocation: { latitude: number; longitude: number; accuracyM?: number; observedAt?: string } | null = null;
const mockBuddyRequest = jest.fn();
let mockCommand: (command: string) => void;
jest.mock('expo-router', () => {
  const { Pressable, View } = jest.requireActual('react-native');
  const Toolbar = Object.assign(({ children }: { children: React.ReactNode }) => <View>{children}</View>, {
    View: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
    Menu: ({ children, accessibilityLabel }: { children: React.ReactNode; accessibilityLabel: string }) => <View accessibilityLabel={accessibilityLabel}>{children}</View>,
    MenuAction: ({ children, onPress }: { children: string; onPress: () => void }) => <Pressable accessibilityRole="menuitem" accessibilityLabel={children} onPress={onPress} />,
  });
  return { useLocalSearchParams: () => mockParams, Stack: { Toolbar } };
});
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }));
jest.mock('@/features/profile/session', () => ({ useGuestSession: () => ({ token: 'private', user: { id: 'helper' } }) }));
jest.mock('@/features/profile/context', () => ({ useProfile: () => ({ accessibility: [] }) }));
jest.mock('@/components/discover-map.native', () => ({ DiscoverMap: () => { const { View } = jest.requireActual('react-native'); return <View testID="session-map" />; } }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('expo-router/react-navigation', () => ({ useHeaderHeight: () => 100 }));
jest.mock('@gorhom/bottom-sheet', () => {
  const { View, ScrollView } = jest.requireActual('react-native');
  return { __esModule: true, default: ({ children }: { children: React.ReactNode }) => <View testID="session-sheet">{children}</View>, BottomSheetScrollView: ScrollView, useBottomSheetSpringConfigs: (config: object) => config };
});
jest.mock('@/features/buddy-pilot/native', () => ({
  useInboxNotifications: () => {},
  useBuddyNative: () => ({ location: mockLocation, tracking: false, error: null, enableNotifications: mockEnableNotifications, enableLocation: async () => {}, obtainLocation: async () => ({ latitude: -6.2, longitude: 106.8, accuracyM: 5, observedAt: new Date().toISOString() }) }),
  useBuddySpeech: ({ onCommand }: { onCommand: (command: string) => void }) => { mockCommand = onCommand; return { speak: mockSpeak, error: null, listening: mockListening, startListening: mockStartListening, stopListening: mockStopListening }; },
}));
jest.mock('@/features/buddy-pilot/api', () => ({ ...jest.requireActual('@/features/buddy-pilot/api'), buddyRequest: (...args: unknown[]) => mockBuddyRequest(...args) }));
jest.mock('@/features/buddy-pilot/use-buddy-pilot', () => ({ useBuddyPilot: () => ({
  contacts: mockContacts, invitations: mockInvitations, incomingContacts: [], inbox: [], availability: mockAvailability, session: mockSession,
  messages: [], locations: [], error: null, loading: false, busy: false, run: mockRun, refresh: mockRefresh,
}) }));

beforeEach(() => { jest.clearAllMocks(); mockListening = false; mockSession = null; mockContacts = []; mockInvitations = []; mockParams = {}; mockAvailability = { optedIn: false }; mockLocation = null; mockRun.mockResolvedValue(undefined); });

test('empty Buddy state offers real invitation and nearby actions without sample people', () => {
  const view = render(<BuddyPilotScreen />);
  expect(view.getByText('No Buddies yet')).toBeTruthy();
  expect(view.getByText('Share an invitation with someone you trust.')).toBeTruthy();
  expect(view.getAllByRole('button', { name: 'Create invitation' })).toHaveLength(1);
  expect(view.getByRole('button', { name: 'Create invitation' })).toBeTruthy();
  expect(view.getByRole('button', { name: 'Find nearby helpers' })).toBeTruthy();
  expect(view.queryByText('Raka Pratama')).toBeNull();
  expect(mockRun).not.toHaveBeenCalled();
});

test('helper acceptance requires consent and submits the current offer identity', () => {
  mockSession = { id: 'session-1', requesterUserId: 'requester', helperUserId: null, requesterName: 'Test requester', helperName: null, status: 'WAITING', message: 'Please meet at the entrance', supportNeeds: [], attempts: [{ id: 'offer-1', helperUserId: 'helper', status: 'PENDING', expiresAt: new Date(Date.now() + 120000).toISOString() }] };
  const view = render(<BuddyPilotScreen />);
  expect(view.getByRole('button', { name: 'Accept and help' })).toBeDisabled();
  expect(mockRun).not.toHaveBeenCalled();
  fireEvent.press(view.getByRole('checkbox', { name: 'Share my precise location with my assigned partner during the accepted session.' }));
  fireEvent.press(view.getByRole('button', { name: 'Accept and help' }));
  expect(mockRun).toHaveBeenCalledWith('/requests/session-1/accept', { attemptId: 'offer-1', sharingConsent: true });
});


test('expired offers cannot be accepted', () => {
  mockSession = { id: 'expired', requesterUserId: 'requester', status: 'WAITING', supportNeeds: [], attempts: [{ id: 'old', helperUserId: 'helper', status: 'PENDING', expiresAt: '2000-01-01T00:00:00Z' }] };
  const view = render(<BuddyPilotScreen />);
  expect(view.queryByRole('button', { name: 'Accept and help' })).toBeNull();
});

test('spoken help uses the primary contact only after explicit confirmation', () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockContacts = [{ id: 'trusted', buddyUserId: 'primary-helper', name: 'Trusted person', level: 'PRIMARY' }];
  render(<BuddyPilotScreen />);
  mockCommand('help');
  expect(mockRun).not.toHaveBeenCalled();
  expect(alert).toHaveBeenCalledWith('Send request', 'Share my precise location with my assigned partner during the accepted session.', expect.any(Array));
  alert.mock.calls.at(-1)?.[2]?.[1].onPress?.();
  expect(mockRun).toHaveBeenCalledWith('/requests', expect.objectContaining({ helperUserId: 'primary-helper', sharingConsent: true }));
  alert.mockRestore();
});


test('a new invitation link updates the code on an already mounted Buddy screen', () => {
  mockParams = { code: 'first-invite' };
  const view = render(<BuddyPilotScreen />);
  expect(view.getByPlaceholderText('Invitation code')).toHaveProp('value', 'first-invite');
  mockParams = { code: 'next-invite' };
  view.rerender(<BuddyPilotScreen />);
  expect(view.getByPlaceholderText('Invitation code')).toHaveProp('value', 'next-invite');
});

test('a delayed availability refresh rejected after opt-out reloads state instead of showing an error', async () => {
  jest.useFakeTimers();
  Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
  mockAvailability = { optedIn: true };
  mockBuddyRequest.mockRejectedValue(Object.assign(new Error('availability refresh requires an active opt-in'), { status: 409 }));
  const view = render(<BuddyPilotScreen />);
  await act(async () => { jest.advanceTimersByTime(60000); });
  await act(async () => {});
  expect(mockBuddyRequest).toHaveBeenCalledWith('private', '/availability', 'PUT', expect.objectContaining({ optedIn: true, refreshOnly: true }));
  expect(mockRefresh).toHaveBeenCalled();
  expect(view.queryByText('availability refresh requires an active opt-in')).toBeNull();
  jest.useRealTimers();
});

test('the requester sees the partner labelled by their role, and no empty name while waiting', () => {
  mockSession = { id: 'mine', requesterUserId: 'helper', helperUserId: null, requesterName: null, helperName: null, status: 'WAITING', message: 'Please come', supportNeeds: [], attempts: [] };
  const view = render(<BuddyPilotScreen />);
  expect(view.queryByText('Requester')).toBeNull();
  expect(view.queryByText('Name not provided')).toBeNull();
  mockSession = { ...(mockSession as object), helperUserId: 'other', helperName: 'Pilot Helper', status: 'ACCEPTED' };
  view.rerender(<BuddyPilotScreen />);
  expect(view.getByText('Helper')).toBeTruthy();
  expect(view.getByText('Pilot Helper')).toBeTruthy();
  expect(view.queryByText('Requester')).toBeNull();
});

test('the segmented control switches between My Buddies and Nearby, and the dev simulator is dev-only', () => {
  const view = render(<BuddyPilotScreen />);
  expect(view.getByRole('button', { name: 'Create invitation' })).toBeTruthy();
  fireEvent.press(view.getByRole('tab', { name: 'Nearby' }));
  expect(view.getByRole('switch', { name: 'I am available to help' })).toBeTruthy();
  expect(view.getByText('No nearby requests yet')).toBeTruthy();
  expect(view.getByText('Turn on “I am available to help” to receive requests from people near you.')).toBeTruthy();
  mockAvailability = { optedIn: true };
  view.rerender(<BuddyPilotScreen />);
  expect(view.getByText('When there is an emergency nearby and someone needs a Buddy, their request appears here.')).toBeTruthy();
  expect(view.getByRole('button', { name: 'Simulate GPS alert request' })).toBeTruthy();
  view.unmount();
  const previous = __DEV__;
  try {
    (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
    const release = render(<BuddyPilotScreen />);
    fireEvent.press(release.getByRole('tab', { name: 'Nearby' }));
    expect(release.queryByRole('button', { name: 'Simulate GPS alert request' })).toBeNull();
  } finally { (globalThis as unknown as { __DEV__: boolean }).__DEV__ = previous; }
});

test('a redeemed invitation shows as a friend request that confirms only after the dialog', () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockInvitations = [{ id: 'inv-1', status: 'REDEEMED', expiresAt: new Date(Date.now() + 3600000).toISOString(), redeemerUserId: 'user-12345678', redeemerName: 'Baim Pratama' }];
  const view = render(<BuddyPilotScreen />);
  expect(view.getByText('Wants to be your Buddy')).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: 'Confirm' }));
  expect(mockRun).not.toHaveBeenCalled();
  alert.mock.calls.at(-1)?.[2]?.[1].onPress?.();
  expect(mockRun).toHaveBeenCalledWith('/invitations/inv-1/confirm', {});
  alert.mockRestore();
});

test('a nearby GPS offer surfaces on the Nearby tab with consent-gated Help this person', () => {
  mockSession = { id: 'gps', requesterUserId: 'nina', helperUserId: null, requesterName: 'Nina Rahma', status: 'WAITING', nearby: true, message: 'Saya perlu bantuan', supportNeeds: ['VISUAL_IMPAIRMENT'], attempts: [{ id: 'offer-gps', helperUserId: 'helper', status: 'PENDING', expiresAt: new Date(Date.now() + 120000).toISOString() }] };
  const view = render(<BuddyPilotScreen />);
  expect(view.getByText('Nearby emergency')).toBeTruthy();
  expect(view.getByRole('button', { name: 'Help this person' })).toBeDisabled();
  fireEvent.press(view.getByRole('checkbox', { name: 'Share my precise location with my assigned partner during the accepted session.' }));
  fireEvent.press(view.getByRole('button', { name: 'Help this person' }));
  expect(mockRun).toHaveBeenCalledWith('/requests/gps/accept', { attemptId: 'offer-gps', sharingConsent: true });
});

test('the helper session shows one primary action for the current status', () => {
  const base = { id: 'live', requesterUserId: 'nina', helperUserId: 'helper', requesterName: 'Nina Rahma', helperName: 'Me', message: '', supportNeeds: [], attempts: [], meetingConfirmed: false };
  mockSession = { ...base, status: 'ACCEPTED' };
  const view = render(<BuddyPilotScreen />);
  expect(view.getByText('Nina Rahma needs help')).toBeTruthy();
  expect(view.getByRole('button', { name: 'Start travelling to requester' })).toBeTruthy();
  expect(view.queryByRole('button', { name: 'I have arrived' })).toBeNull();
  mockSession = { ...base, status: 'EN_ROUTE' };
  view.rerender(<BuddyPilotScreen />);
  expect(view.getByRole('button', { name: 'I have arrived' })).toBeTruthy();
  expect(view.queryByRole('button', { name: 'Start travelling to requester' })).toBeNull();
});

test('the header menu enables notifications and starts or stops listening', () => {
  const view = render(<BuddyPilotScreen />);
  expect(view.getByLabelText('More')).toBeTruthy();
  fireEvent.press(view.getByRole('menuitem', { name: 'Enable notifications' }));
  expect(mockEnableNotifications).toHaveBeenCalledTimes(1);
  fireEvent.press(view.getByRole('menuitem', { name: 'Speak a command' }));
  expect(mockStartListening).toHaveBeenCalledTimes(1);
  mockListening = true;
  view.rerender(<BuddyPilotScreen />);
  fireEvent.press(view.getByRole('menuitem', { name: 'Listening…' }));
  expect(mockStopListening).toHaveBeenCalledTimes(1);
});

test('request consent uses a native switch before sending to a Buddy', () => {
  mockContacts = [{ id: 'trusted', buddyUserId: 'trusted-helper', name: 'Trusted person', level: 'PRIMARY' }];
  const view = render(<BuddyPilotScreen />);
  fireEvent.press(view.getByRole('button', { name: 'Request help' }));
  const consent = view.getByRole('switch', { name: 'Share my precise location with my assigned partner during the accepted session.' });
  expect(consent).toHaveProp('value', false);
  fireEvent.changeText(view.getByLabelText('What help do you need?'), 'Meet at the entrance');
  fireEvent(consent, 'valueChange', true);
  fireEvent.press(view.getByRole('button', { name: 'Send request' }));
  expect(mockRun).toHaveBeenCalledWith('/requests', expect.objectContaining({ helperUserId: 'trusted-helper', sharingConsent: true }));
});

test('an active session with a known position becomes a full-screen map with the next step in its sheet', () => {
  mockSession = { id: 'live', requesterUserId: 'nina', helperUserId: 'helper', requesterName: 'Nina Rahma', status: 'ACCEPTED', supportNeeds: [], attempts: [] };
  const page = render(<BuddyPilotScreen />);
  expect(page.queryByTestId('session-map')).toBeNull();
  expect(page.getByRole('button', { name: 'Start travelling to requester' })).toBeTruthy();
  page.unmount();
  mockLocation = { latitude: -6.2, longitude: 106.8 };
  const map = render(<BuddyPilotScreen />);
  expect(map.getByTestId('session-map')).toBeTruthy();
  expect(within(map.getByTestId('session-sheet')).getByRole('button', { name: 'Start travelling to requester' })).toBeTruthy();
});


let mockSoundFree = false;
jest.mock('@/features/access/use-access', () => ({ useAccess: () => ({ soundFree: mockSoundFree }) }));
beforeEach(() => { mockSoundFree = false; });
test.each([false, true])('voice controls and status speech follow soundFree (%s)', soundFree => {
  mockSoundFree = soundFree;
  mockSession = { id: 'voice', requesterUserId: 'nina', helperUserId: 'helper', requesterName: 'Nina', status: 'ACCEPTED', supportNeeds: [], attempts: [] };
  const view = render(<BuddyPilotScreen />);
  expect(Boolean(view.queryByRole('menuitem', { name: 'Speak a command' }))).toBe(!soundFree);
  expect(Boolean(view.queryByRole('button', { name: 'Read status aloud' }))).toBe(!soundFree);
  if (soundFree) expect(mockSpeak).not.toHaveBeenCalled();
  else expect(mockSpeak).toHaveBeenCalled();
});

test.each([false, true])('repeat guidance is hidden without a gap for soundFree (%s)', soundFree => {
  mockSoundFree = soundFree;
  const view = render(<RouteView route={{ routeStatus: 'UNAVAILABLE', leg: 'TO_SHELTER', destination: null, route: null, evaluation: null, selectionReasonCodes: [] }} position={null} target={null} onInstruction={jest.fn()} speak={mockSpeak} reroute={jest.fn()} voiceEnabled={false} />);
  expect(view.getByText('Last location is stale. Do not treat it as the current position.')).toBeTruthy();
  expect(Boolean(view.queryByRole('button', { name: 'Repeat instruction' }))).toBe(!soundFree);
  expect(view.getByRole('button', { name: 'Recalculate route' })).toBeTruthy();
  const actions = view.UNSAFE_getAllByType(View).find(node => node.props.style === buddyStyles.actions);
  expect(Children.toArray(actions?.props.children)).toHaveLength(soundFree ? 1 : 2);
});


test.each([false, true])('automatic maneuver speech follows soundFree with voice enabled (%s)', async soundFree => {
  mockSoundFree = soundFree;
  mockSession = { id: 'guidance', requesterUserId: 'nina', helperUserId: 'helper', requesterName: 'Nina', status: 'EVACUATING', meetingConfirmed: true, supportNeeds: [], attempts: [] };
  mockLocation = { latitude: -6.2, longitude: 106.8, accuracyM: 5, observedAt: new Date().toISOString() };
  mockBuddyRequest.mockResolvedValue({ routeStatus: 'READY', leg: 'TO_SHELTER', destination: { name: 'Shelter', latitude: -6.201, longitude: 106.801 }, route: { geometry: { type: 'LineString', coordinates: [[106.8, -6.2], [106.801, -6.201]] }, distanceM: 150, durationSec: 120, profile: 'PEDESTRIAN', maneuvers: [{ instruction: 'Continue to the shelter', beginShapeIndex: 0, endShapeIndex: 1, distanceM: 150, durationSec: 120, type: 1 }] }, evaluation: null, selectionReasonCodes: [] });
  const view = render(<BuddyPilotScreen />);
  fireEvent.press(view.getByRole('button', { name: 'Route to gathering point' }));
  await waitFor(() => expect(view.getByText('Continue to the shelter')).toBeTruthy());
  if (soundFree) expect(mockSpeak).not.toHaveBeenCalled();
  else expect(mockSpeak).toHaveBeenCalledWith('Continue to the shelter');
});
