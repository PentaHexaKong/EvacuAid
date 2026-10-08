import { Alert, Linking } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { ActionButton } from '@/components/ui';
import type { Session, SharedPosition } from '../api';
import { useBuddyActions } from '../use-buddy-actions';
import { useBuddyPilot } from '../use-buddy-pilot';
import { SessionMap, SessionView } from './session-view';

const mockRun = jest.fn();
const mockRefresh = jest.fn();
const mockDismiss = jest.fn();
const mockSpeak = jest.fn();
const mockBuddyRequest = jest.fn();
let mockUserId = 'helper';
let mockSoundFree = false;
let mockLocations: SharedPosition[] = [];
let mockMapProps: Record<string, unknown> = {};
let mockSession: Session;
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({}) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }));
jest.mock('@/features/profile/context', () => ({ useProfile: () => ({ accessibility: [] }) }));
jest.mock('@/features/access/use-access', () => ({ useAccess: () => ({ soundFree: mockSoundFree }) }));
jest.mock('@/components/discover-map.native', () => ({ DiscoverMap: (props: Record<string, unknown>) => { mockMapProps = props; return null; } }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('expo-router/react-navigation', () => ({ useHeaderHeight: () => 100 }));
jest.mock('@gorhom/bottom-sheet', () => {
  const { View, ScrollView } = jest.requireActual('react-native');
  return { __esModule: true, default: View, BottomSheetScrollView: ScrollView, useBottomSheetSpringConfigs: (config: object) => config };
});
jest.mock('@/features/buddy-pilot/native', () => ({
  useBuddyNative: () => ({ location: null, tracking: false, error: null, enableLocation: async () => {}, stopLocation: async () => {}, obtainLocation: async () => ({ latitude: -6.2, longitude: 106.8, accuracyM: 5, observedAt: new Date().toISOString() }) }),
  useBuddySpeech: () => ({ speak: mockSpeak, error: null }),
}));
jest.mock('@/features/buddy-pilot/api', () => ({ ...jest.requireActual('@/features/buddy-pilot/api'), buddyRequest: (...args: unknown[]) => mockBuddyRequest(...args) }));
jest.mock('@/features/buddy-pilot/use-buddy-pilot', () => ({ useBuddyPilot: () => ({
  contacts: [], invitations: [], incomingContacts: [], inbox: [], availability: { optedIn: false }, session: mockSession,
  messages: [], locations: mockLocations, error: null, loading: false, busy: false, run: mockRun, refresh: mockRefresh, dismissSession: mockDismiss,
}) }));

function Harness({ map = false }: { map?: boolean }) {
  const state = useBuddyPilot('private');
  const a = useBuddyActions({ token: 'private', userId: mockUserId, state });
  return map ? <SessionMap a={a} token="private" userId={mockUserId} /> : <SessionView a={a} token="private" userId={mockUserId} />;
}

beforeEach(() => {
  jest.clearAllMocks(); mockUserId = 'helper'; mockSoundFree = false; mockLocations = []; mockRun.mockResolvedValue(undefined); mockSpeak.mockResolvedValue(undefined); mockBuddyRequest.mockResolvedValue({ routeStatus: 'UNAVAILABLE' });
  mockSession = { id: 'session-1', requesterUserId: 'requester', helperUserId: 'helper', requesterName: 'Test Person', helperName: 'Test Helper', status: 'ACCEPTED', message: '', supportNeeds: [], sharingConsent: true, phoneShared: false, nearby: false, meetingConfirmed: false, selectedShelterId: null, attempts: [], createdAt: '2026-10-08T00:00:00Z', updatedAt: '2026-10-08T00:00:00Z' };
});
afterEach(() => jest.restoreAllMocks());

test('the accepted helper sees one primary step, Call and a named route', () => {
  const view = render(<Harness />);
  expect(view.getByText('Ready to head to Test Person')).toBeTruthy();
  expect(view.getByText('Live location is on during this session')).toBeTruthy();
  expect(view.getByRole('button', { name: 'Call' })).toBeTruthy();
  expect(view.getByRole('button', { name: 'Route to Test' })).toBeTruthy();
  const primary = view.UNSAFE_getAllByType(ActionButton).filter(node => !node.props.variant || node.props.variant === 'primary');
  expect(primary.map(node => node.props.label)).toEqual(['Start travelling to requester']);
  fireEvent.press(view.getByRole('button', { name: 'Start travelling to requester' }));
  expect(mockRun).toHaveBeenCalledWith('/requests/session-1/depart', {});
});

test('arrival posts only after the helper confirms the native alert', () => {
  mockSession.status = 'EN_ROUTE';
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const view = render(<Harness />);
  expect(view.getByText('Heading to Test Person')).toBeTruthy();
  expect(view.queryByRole('button', { name: 'Start travelling to requester' })).toBeNull();
  fireEvent.press(view.getByRole('button', { name: 'I have arrived' }));
  expect(mockRun).not.toHaveBeenCalled();
  expect(alert).toHaveBeenCalledWith('I have arrived', 'I have arrived', expect.any(Array));
  act(() => alert.mock.calls.at(-1)?.[2]?.[1].onPress?.());
  expect(mockRun).toHaveBeenCalledWith('/requests/session-1/arrive', {});
});

test('the requester retains the existing ARRIVED meeting confirmation path', () => {
  mockUserId = 'requester'; mockSession.status = 'ARRIVED';
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const view = render(<Harness />);
  expect(view.getByText('Test Helper')).toBeTruthy();
  expect(view.getByText('Helper reported arrival')).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: 'Confirm we have met' }));
  expect(mockRun).not.toHaveBeenCalled();
  act(() => alert.mock.calls.at(-1)?.[2]?.[1].onPress?.());
  expect(mockRun).toHaveBeenCalledWith('/requests/session-1/confirm-meeting', {});
});

test('pickup waits for meeting confirmation and report complete remains secondary', () => {
  mockSession.status = 'ARRIVED';
  const view = render(<Harness />);
  expect(view.getByText('Waiting for requester to confirm meeting')).toBeTruthy();
  expect(view.getByRole('button', { name: 'Confirm pickup' })).toBeDisabled();
  expect(view.UNSAFE_getAllByType(ActionButton).find(node => node.props.label === 'Report assistance completed')?.props.variant).toBe('secondary');
  mockSession = { ...mockSession, meetingConfirmed: true };
  view.rerender(<Harness />);
  expect(view.getByText('Meeting confirmed')).toBeTruthy();
  expect(view.getByRole('button', { name: 'Confirm pickup' })).toBeEnabled();
});

test('evacuation has a primary completion step; pending and terminal sessions have none', () => {
  mockSession.status = 'EVACUATING';
  const view = render(<Harness />);
  expect(view.getByText('Heading to the gathering point together')).toBeTruthy();
  expect(view.UNSAFE_getAllByType(ActionButton).find(node => node.props.label === 'Report assistance completed')?.props.variant).toBeUndefined();
  mockSession = { ...mockSession, status: 'COMPLETION_PENDING' };
  view.rerender(<Harness />);
  expect(view.queryByRole('button', { name: 'Report assistance completed' })).toBeNull();
  mockSession = { ...mockSession, status: 'COMPLETED' };
  view.rerender(<Harness />);
  expect(view.queryByRole('button', { name: 'End session' })).toBeNull();
  fireEvent.press(view.getByRole('button', { name: 'Back to Buddy' }));
  expect(mockDismiss).toHaveBeenCalledTimes(1);
});

test('Call uses the existing contact lookup and phone handler', async () => {
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  mockBuddyRequest.mockResolvedValue({ phone: '+620000000000' });
  const view = render(<Harness />);
  fireEvent.press(view.getByRole('button', { name: 'Call' }));
  await waitFor(() => expect(open).toHaveBeenCalledWith('tel:%2B620000000000'));
  expect(mockBuddyRequest).toHaveBeenCalledWith('private', '/requests/session-1/contact');
});

test('the session map uses the partner person pin and omits self and stale markers', () => {
  const position = { latitude: -6.2, longitude: 106.8, accuracyM: 5, observedAt: '2026-10-08T00:00:00Z', stale: false };
  mockLocations = [{ ...position, userId: 'helper' }, { ...position, userId: 'requester' }, { ...position, userId: 'old', stale: true }];
  render(<Harness map />);
  expect(mockMapProps.items).toEqual([{ id: 'requester', title: 'Test Person', kind: 'person', initials: 'TP', coordinate: mockLocations[1] }]);
});

test('the helper respects sound-free status controls', () => {
  mockSoundFree = true;
  const view = render(<Harness />);
  expect(view.queryByRole('button', { name: 'Read status aloud' })).toBeNull();
});
