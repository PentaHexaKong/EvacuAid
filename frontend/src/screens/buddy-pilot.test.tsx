import * as Speech from 'expo-speech';
import { Children } from 'react';
import { buddyStyles } from '@/features/buddy-pilot/ui/parts';
import { AccessibilityInfo, Alert, AppState, View } from 'react-native';
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
let mockReceived: unknown[] = [];
let mockIncomingContacts: unknown[] = [];
let mockAccessibility: { type: string }[] = [];
const mockPush = jest.fn();
let mockPathname = '/buddy';
let mockParams: { code?: string } = {};
let mockAvailability = { optedIn: false, enrolled: true };
let mockLocation: { latitude: number; longitude: number; accuracyM?: number; observedAt?: string } | null = null;
const mockBuddyRequest = jest.fn();
let mockCommand: (command: string) => void;
jest.mock('expo-router', () => {
  const { Pressable, View } = jest.requireActual('react-native');
  const { useEffect } = jest.requireActual('react');
  const Toolbar = Object.assign(({ children }: { children: React.ReactNode }) => <View>{children}</View>, {
    Button: ({ accessibilityLabel, onPress }: { accessibilityLabel: string; onPress: () => void }) => <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} />,
    View: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
    Menu: ({ children, accessibilityLabel }: { children: React.ReactNode; accessibilityLabel: string }) => <View accessibilityLabel={accessibilityLabel}>{children}</View>,
    MenuAction: ({ children, onPress }: { children: string; onPress: () => void }) => <Pressable accessibilityRole="menuitem" accessibilityLabel={children} onPress={onPress} />,
  });
  return { usePathname: () => mockPathname, useIsFocused: () => mockFocused, useRouter: () => ({ push: mockPush }), useFocusEffect: (callback: () => void) => useEffect(callback, [callback]), useLocalSearchParams: () => mockParams, Stack: { Toolbar } };
});
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, params?: Record<string, string>) => key.startsWith('relying') ? jest.requireActual('@/localization/en.json')[key].replace('{{time}}', params?.time ?? '') : key, i18n: { language: 'en' } }) }));
jest.mock('@/features/profile/session', () => ({ useGuestSession: () => ({ token: 'private', user: { id: 'helper' } }) }));
jest.mock('@/features/profile/context', () => ({ useProfile: () => ({ accessibility: mockAccessibility, ready: true }) }));
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
  useBuddySpeech: ({ onCommand }: { onCommand: (command: string) => void }) => { mockCommand = onCommand; return { speak: mockSpeak, error: null, listening: mockListening, startListening: mockStartListening, stopListening: mockStopListening, cancelListening: mockStopListening }; },
}));
jest.mock('@/features/buddy-pilot/api', () => ({ ...jest.requireActual('@/features/buddy-pilot/api'), buddyRequest: (...args: unknown[]) => mockBuddyRequest(...args) }));
jest.mock('@/features/buddy-pilot/use-buddy-pilot', () => ({ useBuddyCode: jest.requireActual('@/features/buddy-pilot/use-buddy-pilot').useBuddyCode, useBuddyPilot: () => ({
  contacts: mockContacts, invitations: mockInvitations, incomingContacts: mockIncomingContacts, received: mockReceived, inbox: [], availability: mockAvailability, session: mockSession,
  messages: [], locations: [], error: null, loading: false, busy: false, run: mockRun, refresh: mockRefresh,
}) }));

beforeEach(() => { jest.clearAllMocks(); mockListening = false; mockSession = null; mockContacts = []; mockInvitations = []; mockReceived = []; mockIncomingContacts = []; mockAccessibility = [{ type: 'VISUAL_IMPAIRMENT' }]; mockBuddyRequest.mockReset(); mockBuddyRequest.mockResolvedValue({ code: 'K7Q2-M9XD' }); mockParams = {}; mockAvailability = { optedIn: false, enrolled: true }; mockLocation = null; mockRun.mockResolvedValue(undefined); });

test('a person with no Buddy can search nearby, add a Buddy or call 112, with no helper controls', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockRun.mockResolvedValueOnce({ id: 'new-request' });
  const view = render(<BuddyPilotScreen />);
  expect(view.getByText('You have no Buddy yet. Look for a helper nearby, or add someone you trust.')).toBeTruthy();
  expect(view.getByRole('link', { name: 'Call 112' })).toBeTruthy();
  expect(view.queryByRole('switch')).toBeNull();
  expect(view.queryByRole('tab')).toBeNull();
  expect(view.queryByLabelText('Invitation code')).toBeNull();
  fireEvent.press(view.getAllByRole('button', { name: 'Add Buddy' })[1]);
  expect(mockPush).toHaveBeenCalledWith('/buddy-add');
  fireEvent.press(view.getByRole('button', { name: 'Find help nearby' }));
  expect(mockRun).not.toHaveBeenCalled();
  expect(alert).toHaveBeenCalledWith('Find help nearby?', 'We look for registered helpers near you. Your precise location is shared only after someone accepts.', expect.any(Array));
  alert.mock.calls.at(-1)?.[2]?.[1].onPress?.();
  await waitFor(() => expect(mockRun).toHaveBeenCalledWith('/requests/new-request/nearby', expect.objectContaining({ latitude: -6.2 })));
  expect(mockRun).toHaveBeenCalledWith('/requests', expect.objectContaining({ helperUserId: null, sharingConsent: true }));
  alert.mockRestore();
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
  expect(alert).toHaveBeenCalledWith('Ask Trusted person for help?', 'Your location is shared with Trusted person during this session. You can stop it any time.', expect.any(Array));
  alert.mock.calls.at(-1)?.[2]?.[1].onPress?.();
  expect(mockRun).toHaveBeenCalledWith('/requests', expect.objectContaining({ helperUserId: 'primary-helper', sharingConsent: true }));
  alert.mockRestore();
});



test('a delayed availability refresh rejected after opt-out reloads state instead of showing an error', async () => {
  jest.useFakeTimers();
  Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
  mockAvailability = { optedIn: true, enrolled: true };
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


test('a redeemed invitation shows as a friend request that confirms only after the dialog', () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockInvitations = [{ id: 'inv-1', status: 'REDEEMED', expiresAt: new Date(Date.now() + 3600000).toISOString(), redeemerUserId: 'user-12345678', redeemerName: 'Baim Pratama' }];
  const view = render(<BuddyPilotScreen />);
  expect(view.getByText('Wants to be your Buddy')).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: 'Confirm' }));
  expect(view.getByText('ID 12345678')).toBeTruthy();
  expect(alert).toHaveBeenCalledWith('Confirm this person', 'Baim Pratama · ID 12345678', expect.any(Array));
  expect(mockRun).not.toHaveBeenCalled();
  alert.mock.calls.at(-1)?.[2]?.[1].onPress?.();
  expect(mockRun).toHaveBeenCalledWith('/invitations/inv-1/confirm', {});
  alert.mockRestore();
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

test('asking a Buddy names them and the location sharing, and sends only after confirming', () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockContacts = [{ id: 'trusted', buddyUserId: 'trusted-helper', name: 'Trusted person', level: 'PRIMARY', available: true }, { id: 'second', buddyUserId: 'second-helper', name: 'Second person', level: 'SECONDARY', available: false }];
  const view = render(<BuddyPilotScreen />);
  fireEvent.press(view.getByRole('button', { name: 'Ask Trusted for help' }));
  expect(alert).toHaveBeenCalledWith('Ask Trusted person for help?', 'Your location is shared with Trusted person during this session. You can stop it any time.', expect.any(Array));
  expect(mockRun).not.toHaveBeenCalled();
  alert.mock.calls.at(-1)?.[2]?.[1].onPress?.();
  expect(mockRun).toHaveBeenCalledWith('/requests', expect.objectContaining({ helperUserId: 'trusted-helper', sharingConsent: true }));
  fireEvent.press(view.getByRole('button', { name: 'Second person, Unavailable. Tap to ask for help.' }));
  alert.mock.calls.at(-1)?.[2]?.[1].onPress?.();
  expect(mockRun).toHaveBeenCalledWith('/requests', expect.objectContaining({ helperUserId: 'second-helper' }));
  alert.mockRestore();
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
let mockVoiceHome = false;
let mockFocused = true;
jest.mock('expo-speech', () => ({ stop: jest.fn(() => Promise.resolve()), speak: jest.fn() }));
jest.mock('@/features/access/use-access', () => ({ useAccess: () => ({ soundFree: mockSoundFree, voiceHome: mockVoiceHome, listen: !mockSoundFree }) }));
beforeEach(() => { mockSoundFree = false; mockVoiceHome = false; mockFocused = true; jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false); });
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
  const view = render(<RouteView route={{ routeStatus: 'UNAVAILABLE', leg: 'TO_SHELTER', destination: null, route: null, evaluation: null, selectionReasonCodes: [] }} guidance={{ arrived: false, ready: false, progress: null, maneuver: null, next: null, after: null, instruction: null, upcoming: null, remainingM: 0, minutes: 0, nextManeuverM: 0, walked: 0 }} speak={mockSpeak} reroute={jest.fn()} />);
  expect(view.getByText('Last location is old, not the current position.')).toBeTruthy();
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
  await waitFor(() => expect(view.getByText('Start walking')).toBeTruthy());
  if (soundFree) expect(mockSpeak).not.toHaveBeenCalled();
  else expect(mockSpeak).toHaveBeenCalledWith('Start walking');
});

const helperOffer = (nearby = false) => ({ id: 'helper-session', requesterUserId: 'friend', helperUserId: null, requesterName: 'Test friend', helperName: null, status: 'WAITING', nearby, message: '', supportNeeds: ['HEARING_IMPAIRMENT'], createdAt: new Date().toISOString(), attempts: [{ id: 'helper-offer', helperUserId: 'helper', status: 'PENDING', expiresAt: new Date(Date.now() + 120000).toISOString() }] });

test('helpers see Added friends and Auto search without requester actions', async () => {
  mockAccessibility = [];
  const view = render(<BuddyPilotScreen />);
  expect(view.getByRole('tab', { name: 'Added friends' })).toBeTruthy();
  expect(view.getByRole('tab', { name: 'Auto search' })).toBeTruthy();
  expect(view.queryByRole('button', { name: 'Request help' })).toBeNull();
  expect(view.queryByRole('button', { name: 'Find nearby helpers' })).toBeNull();
  await waitFor(() => expect(view.getByText('K7Q2-M9XD')).toBeTruthy());
  expect(mockBuddyRequest).toHaveBeenCalledWith('private', '/me/code', 'GET', undefined, expect.any(AbortSignal));
});

test('helper friend acceptance confirms location sharing and submits the offer identity', async () => {
  mockAccessibility = [];
  mockSession = helperOffer();
  mockRun.mockResolvedValue({ id: 'helper-session' });
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const view = render(<BuddyPilotScreen />);
  expect(view.getByRole('button', { name: 'Decline' })).toBeTruthy();
  expect(view.queryByRole('checkbox')).toBeNull();
  fireEvent.press(view.getByRole('button', { name: 'Accept & help' }));
  expect(mockRun).not.toHaveBeenCalled();
  expect(alert).toHaveBeenCalledWith('Help Test friend?', 'Your location is shared with Test friend during this session. You can stop it any time.', expect.any(Array));
  await act(async () => { alert.mock.calls.at(-1)?.[2]?.[1].onPress?.(); });
  expect(mockRun).toHaveBeenCalledWith('/requests/helper-session/accept', { attemptId: 'helper-offer', sharingConsent: true });
  alert.mockRestore();
});

test('a friend who is asking for help is the card at the top and is not repeated in the list', () => {
  mockAccessibility = [];
  mockIncomingContacts = [{ id: 'c1', userId: 'friend', buddyUserId: 'helper', name: 'Test friend', level: 'PRIMARY', status: 'ACTIVE' }, { id: 'c2', userId: 'other', buddyUserId: 'helper', name: 'Other friend', level: 'PRIMARY', status: 'ACTIVE' }];
  mockSession = helperOffer();
  const view = render(<BuddyPilotScreen />);
  expect(view.getAllByText('Test friend')).toHaveLength(1);
  expect(view.getByText('Other friend')).toBeTruthy();
  mockIncomingContacts = [mockIncomingContacts[0]];
  view.rerender(<BuddyPilotScreen />);
  expect(view.queryByText('People you help')).toBeNull();
});

test('helper received invite acceptance posts to its invitation endpoint', async () => {
  mockAccessibility = [];
  mockReceived = [{ id: 'received-1', status: 'SENT', ownerName: 'Test friend', ownerNeeds: ['VISUAL_IMPAIRMENT'], relation: 'TEMAN' }];
  const view = render(<BuddyPilotScreen />);
  fireEvent.press(view.getByRole('button', { name: 'Accept' }));
  expect(mockRun).toHaveBeenCalledWith('/invitations/received-1/accept', {});
  await act(async () => {});
});

test('a received invitation says which way the help goes', async () => {
  mockAccessibility = [];
  mockReceived = [{ id: 'asked', status: 'SENT', ownerName: 'Asker', direction: 'SEEK_HELP' }, { id: 'offered', status: 'SENT', ownerName: 'Offerer', direction: 'OFFER_HELP' }];
  const view = render(<BuddyPilotScreen />);
  expect(await view.findByText('You will receive help requests from Asker.')).toBeTruthy();
  expect(view.getByText('Offerer is offering to be your Buddy and will receive your help requests.')).toBeTruthy();
});

test('helper GPS offers force Auto search and use Skip and confirmed Help this person', async () => {
  mockAccessibility = [];
  mockSession = { ...helperOffer(true), message: 'Please hurry' };
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const view = render(<BuddyPilotScreen />);
  expect(view.getByRole('tab', { name: 'Auto search' })).toHaveProp('accessibilityState', { selected: true });
  expect(view.getByText('The system found Test friend in an emergency area with no Buddy helping yet.')).toBeTruthy();
  expect(view.getByText('“Please hurry”')).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: 'Help this person' }));
  expect(mockRun).not.toHaveBeenCalled();
  await act(async () => { alert.mock.calls.at(-1)?.[2]?.[1].onPress?.(); });
  expect(mockRun).toHaveBeenCalledWith('/requests/helper-session/accept', { attemptId: 'helper-offer', sharingConsent: true });
  mockRun.mockClear();
  fireEvent.press(view.getByRole('button', { name: 'Skip' }));
  expect(mockRun).toHaveBeenCalledWith('/requests/helper-session/decline', { attemptId: 'helper-offer' });
  alert.mockRestore();
});

test('a friend offer forces Added friends after the helper selects Auto search', async () => {
  mockAccessibility = [];
  const view = render(<BuddyPilotScreen />);
  fireEvent.press(view.getByRole('tab', { name: 'Auto search' }));
  mockSession = helperOffer();
  view.rerender(<BuddyPilotScreen />);
  expect(view.getByRole('tab', { name: 'Added friends' })).toHaveProp('accessibilityState', { selected: true });
  expect(view.getByRole('button', { name: 'Accept & help' })).toBeTruthy();
  await act(async () => {});
});

test('helper friend decline requires confirmation', async () => {
  mockAccessibility = [];
  mockSession = helperOffer();
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const view = render(<BuddyPilotScreen />);
  fireEvent.press(view.getByRole('button', { name: 'Decline' }));
  expect(mockRun).not.toHaveBeenCalled();
  expect(alert).toHaveBeenCalledWith("Decline Test friend's request?", "Test friend will be told you can't help right now.", expect.any(Array));
  await act(async () => { alert.mock.calls.at(-1)?.[2]?.[1].onPress?.(); });
  expect(mockRun).toHaveBeenCalledWith('/requests/helper-session/decline', { attemptId: 'helper-offer' });
  alert.mockRestore();
});

test('a helper who is nobody\'s Buddy yet sees how auto search turns on instead of the availability switch', async () => {
  mockAccessibility = [];
  mockAvailability = { optedIn: false, enrolled: false };
  const view = render(<BuddyPilotScreen />);
  fireEvent.press(await view.findByRole('tab', { name: 'Auto search' }));
  expect(view.getByText('Become a Buddy first')).toBeTruthy();
  expect(view.queryByRole('switch', { name: 'I am available to help' })).toBeNull();
});

test('a person with support needs accepts a helper\'s offer and cancels an invitation they sent', () => {
  mockReceived = [{ id: 'offered', status: 'SENT', ownerName: 'Offerer', direction: 'OFFER_HELP', relation: 'TEMAN' }];
  mockInvitations = [{ id: 'asked', status: 'SENT', direction: 'SEEK_HELP', redeemerName: 'Asked person', redeemerUserId: 'asked-user', expiresAt: '2030-01-01T00:00:00Z' }];
  const view = render(<BuddyPilotScreen />);
  expect(view.getByText('Wants to be your Buddy')).toBeTruthy();
  expect(view.getByText('Offerer is offering to be your Buddy and will receive your help requests.')).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: 'Accept' }));
  expect(mockRun).toHaveBeenCalledWith('/invitations/offered/accept', {});
  expect(view.getByText('Asked person')).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: 'Cancel' }));
  expect(mockRun).toHaveBeenCalledWith('/invitations/asked', undefined, 'DELETE');
  expect(view.queryByText('Your code')).toBeNull();
});


test('presents each pending attempt once and leaves the card after answering later', () => {
  mockAccessibility = [];
  mockSession = { id: 'takeover', requesterUserId: 'nina', requesterName: 'Nina', status: 'WAITING', supportNeeds: [], attempts: [{ id: 'takeover-first', helperUserId: 'helper', status: 'PENDING', expiresAt: new Date(Date.now() + 120000).toISOString() }] };
  const view = render(<BuddyPilotScreen />);
  expect(mockPush).toHaveBeenCalledWith('/help-request/takeover');
  view.rerender(<BuddyPilotScreen />);
  expect(mockPush).toHaveBeenCalledTimes(1);
  expect(view.getByRole('button', { name: 'Accept & help' })).toBeTruthy();
  mockSession = { ...(mockSession as object), attempts: [{ id: 'takeover-next', helperUserId: 'helper', status: 'PENDING', expiresAt: new Date(Date.now() + 120000).toISOString() }] };
  view.rerender(<BuddyPilotScreen />);
  expect(mockPush).toHaveBeenCalledTimes(2);
});

test('does not present a takeover while already on a help request route', () => {
  mockAccessibility = [];
  mockPathname = '/help-request/already-open';
  mockSession = { id: 'already-open', requesterUserId: 'nina', status: 'WAITING', supportNeeds: [], attempts: [{ id: 'already-open-attempt', helperUserId: 'helper', status: 'PENDING', expiresAt: new Date(Date.now() + 120000).toISOString() }] };
  const view = render(<BuddyPilotScreen />);
  expect(mockPush).not.toHaveBeenCalled();
  mockPathname = '/buddy';
  view.rerender(<BuddyPilotScreen />);
  expect(mockPush).toHaveBeenCalledWith('/help-request/already-open');
});

test('friends render and order all alert answer states', () => {
  mockAccessibility = [];
  const at = new Date().toISOString();
  mockIncomingContacts = [
    { id: 'safe', name: 'Ari', latestAlertResponse: { response: 'SAFE', at } },
    { id: 'none', name: 'Budi', needs: ['VISUAL_IMPAIRMENT'], relation: 'TEMAN' },
    { id: 'evacuating', name: 'Citra', latestAlertResponse: { response: 'EVACUATING', at } },
    { id: 'needs', name: 'Dewi', latestAlertResponse: { response: 'NEEDS_HELP', at } },
  ];
  const view = render(<BuddyPilotScreen />);
  expect(view.getByText('Safe · timeJustNow')).toBeTruthy();
  expect(view.getByText('Evacuating · timeJustNow')).toBeTruthy();
  expect(view.getByText('Needs help · timeJustNow')).toBeTruthy();
  expect(view.getByText('accessibility_VISUAL_IMPAIRMENT · Friend')).toBeTruthy();
  const names = view.getAllByText(/^(Ari|Budi|Citra|Dewi)$/).map(node => node.props.children);
  expect(names).toEqual(['Dewi', 'Citra', 'Budi', 'Ari']);
});
test.each([false, true])('voice Buddy idle shows status and the mic with Buddy=%s', async hasBuddy => {
  mockVoiceHome = true;
  if (hasBuddy) mockContacts = [{ id: 'trusted', buddyUserId: 'buddy', name: 'Sari', level: 'PRIMARY' }];
  const view = render(<BuddyPilotScreen />);
  expect(view.getByText('Buddy status')).toBeTruthy();
  expect(view.getByRole('button', { name: 'Tap to speak' })).toBeTruthy();
  expect(view.getByText(hasBuddy ? 'Sari is your Buddy. Say “help” to ask them.' : 'You have no Buddy yet. Say “nearby” to find a helper near you.')).toBeTruthy();
  expect(view.queryByLabelText('More')).toBeNull();
  expect(view.queryByText('My Buddies')).toBeNull();
  await waitFor(() => expect(Speech.speak).toHaveBeenCalledTimes(1));
  view.rerender(<BuddyPilotScreen />);
  expect(Speech.speak).toHaveBeenCalledTimes(1);
  mockContacts = [{ id: 'changed', buddyUserId: 'other', name: 'Nina', level: 'PRIMARY' }];
  view.rerender(<BuddyPilotScreen />);
  await waitFor(() => expect(Speech.speak).toHaveBeenCalledTimes(2));
  mockFocused = false;
  view.rerender(<BuddyPilotScreen />);
  expect(mockStopListening).toHaveBeenCalled();
});

test.each(['yes', 'no'])('voice Buddy cancel asks before %s and has no cancel control or contact rows', async answer => {
  mockVoiceHome = true;
  mockSession = { id: 'live', requesterUserId: 'helper', status: 'WAITING', attempts: [] };
  mockContacts = [{ id: 'trusted', buddyUserId: 'buddy', name: 'Sari', level: 'PRIMARY' }];
  mockRun.mockResolvedValue({ id: 'live' });
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const view = render(<BuddyPilotScreen />);
  expect(view.queryByRole('button', { name: 'End session' })).toBeNull();
  expect(view.queryByText('Sari')).toBeNull();
  await waitFor(() => expect(Speech.speak).toHaveBeenCalledTimes(1));
  expect(mockSpeak).not.toHaveBeenCalled();
  act(() => mockCommand('cancel'));
  await waitFor(() => expect(Speech.speak).toHaveBeenLastCalledWith('Cancel your help request? Say yes or no.', expect.any(Object)));
  expect(mockStartListening).not.toHaveBeenCalled();
  await act(async () => { jest.mocked(Speech.speak).mock.calls.at(-1)?.[1]?.onDone?.(); });
  expect(mockStartListening).toHaveBeenCalledTimes(1);
  await act(async () => mockCommand(answer));
  if (answer === 'yes') {
    expect(mockRun).toHaveBeenCalledWith('/requests/live/interrupt', {});
    await waitFor(() => expect(Speech.speak).toHaveBeenLastCalledWith('Your request is cancelled.', expect.any(Object)));
  } else {
    expect(mockRun).not.toHaveBeenCalled();
    await waitFor(() => expect(Speech.speak).toHaveBeenLastCalledWith('Okay, your request stays active.', expect.any(Object)));
  }
  expect(alert).not.toHaveBeenCalled();
  alert.mockRestore();
});

test('voice Buddy touch still opens the help dialog', async () => {
  mockVoiceHome = true;
  mockContacts = [{ id: 'trusted', buddyUserId: 'buddy', name: 'Sari', level: 'PRIMARY' }];
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const view = render(<BuddyPilotScreen />);
  fireEvent.press(view.getByRole('button', { name: 'Ask Sari for help' }));
  expect(alert).toHaveBeenCalledWith('Ask Sari for help?', expect.any(String), expect.any(Array));
  expect(mockRun).not.toHaveBeenCalled();
  await act(async () => {});
  alert.mockRestore();
});

test.each(['help', 'nearby', 'complete'])('voice Buddy %s shares or completes only after yes', async command => {
  mockVoiceHome = true;
  mockContacts = [{ id: 'trusted', buddyUserId: 'buddy', name: 'Sari', level: 'PRIMARY' }];
  if (command === 'complete') mockSession = { id: 'live', requesterUserId: 'helper', status: 'COMPLETION_PENDING', attempts: [] };
  mockRun.mockResolvedValue({ id: 'live' });
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  render(<BuddyPilotScreen />);
  await waitFor(() => expect(Speech.speak).toHaveBeenCalledTimes(1));
  act(() => mockCommand(command));
  const question = command === 'help' ? 'Ask Sari for help and share your location? Say yes or no.' : command === 'nearby' ? 'Search for helpers nearby and share your location? Say yes or no.' : 'Confirm you are safe and finished? Say yes or no.';
  await waitFor(() => expect(Speech.speak).toHaveBeenLastCalledWith(question, expect.any(Object)));
  expect(mockRun).not.toHaveBeenCalled();
  await act(async () => { jest.mocked(Speech.speak).mock.calls.at(-1)?.[1]?.onDone?.(); });
  await act(async () => mockCommand('ya'));
  if (command === 'complete') expect(mockRun).toHaveBeenCalledWith('/requests/live/confirm-complete', {});
  else expect(mockRun).toHaveBeenCalledWith('/requests', expect.objectContaining({ helperUserId: command === 'help' ? 'buddy' : null, sharingConsent: true }));
  expect(alert).not.toHaveBeenCalled();
  alert.mockRestore();
});
