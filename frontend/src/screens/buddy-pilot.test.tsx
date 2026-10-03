import { Alert, AppState } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { BuddyPilotScreen } from './buddy-pilot';

const mockRun = jest.fn();
const mockRefresh = jest.fn();
const mockSpeak = jest.fn();
let mockSession: unknown = null;
let mockContacts: unknown[] = [];
let mockInvitations: unknown[] = [];
let mockParams: { code?: string } = {};
let mockAvailability = { optedIn: false };
const mockBuddyRequest = jest.fn();
let mockCommand: (command: string) => void;
jest.mock('expo-router', () => ({ useLocalSearchParams: () => mockParams }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }));
jest.mock('@/features/profile/session', () => ({ useGuestSession: () => ({ token: 'private', user: { id: 'helper' } }) }));
jest.mock('@/features/profile/context', () => ({ useProfile: () => ({ accessibility: [] }) }));
jest.mock('@/components/discover-map.native', () => ({ DiscoverMap: () => null }));
jest.mock('@/features/buddy-pilot/native', () => ({
  useInboxNotifications: () => {},
  useBuddyNative: () => ({ location: null, tracking: false, error: null, enableLocation: async () => {}, obtainLocation: async () => ({ latitude: -6.2, longitude: 106.8, accuracyM: 5, observedAt: new Date().toISOString() }) }),
  useBuddySpeech: ({ onCommand }: { onCommand: (command: string) => void }) => { mockCommand = onCommand; return { speak: mockSpeak, error: null, listening: false }; },
}));
jest.mock('@/features/buddy-pilot/api', () => ({ ...jest.requireActual('@/features/buddy-pilot/api'), buddyRequest: (...args: unknown[]) => mockBuddyRequest(...args) }));
jest.mock('@/features/buddy-pilot/use-buddy-pilot', () => ({ useBuddyPilot: () => ({
  contacts: mockContacts, invitations: mockInvitations, incomingContacts: [], inbox: [], availability: mockAvailability, session: mockSession,
  messages: [], locations: [], error: null, loading: false, busy: false, run: mockRun, refresh: mockRefresh,
}) }));

beforeEach(() => { jest.clearAllMocks(); mockSession = null; mockContacts = []; mockInvitations = []; mockParams = {}; mockAvailability = { optedIn: false }; mockRun.mockResolvedValue(undefined); });

test('empty Buddy state offers real invitation and nearby actions without sample people', () => {
  const view = render(<BuddyPilotScreen />);
  expect(view.getByText('No Buddies yet. Share an invitation with someone you trust.')).toBeTruthy();
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
  fireEvent.press(view.getByRole('menuitem', { name: 'Nearby' }));
  expect(view.getByRole('switch', { name: 'I am available to help' })).toBeTruthy();
  expect(view.getByText('No nearby requests yet')).toBeTruthy();
  expect(view.getByRole('button', { name: 'Simulate GPS alert request' })).toBeTruthy();
  view.unmount();
  const previous = __DEV__;
  try {
    (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
    const release = render(<BuddyPilotScreen />);
    fireEvent.press(release.getByRole('menuitem', { name: 'Nearby' }));
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
