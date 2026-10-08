import { renderHook, waitFor } from '@testing-library/react-native';
import { Alert, Linking } from 'react-native';
import { buddyRequest } from './api';
import { useBuddyNative } from './native';
import { useBuddyActions } from './use-buddy-actions';

const enableLocation = jest.fn().mockResolvedValue(undefined);
jest.mock('./api', () => ({ ...jest.requireActual('./api'), buddyRequest: jest.fn() }));
let mockParams: { help?: string } = {};
jest.mock('expo-router', () => ({ useLocalSearchParams: () => mockParams }));
jest.mock('@/features/profile/context', () => ({ useProfile: () => ({ accessibility: [] }) }));
jest.mock('@/features/preferences/context', () => ({ usePreferences: () => ({ preferences: { voiceEnabled: false } }) }));
jest.mock('./copy', () => ({ readableIssue: jest.requireActual('./copy').readableIssue, useBuddyCopy: () => ({ c: (key: string) => key, status: (key: string) => key, language: 'en', support: jest.fn(), event: jest.fn() }) }));
jest.mock('./native', () => ({ useBuddyNative: jest.fn(), useBuddySpeech: () => ({ speak: jest.fn(), error: null }) }));
jest.mocked(useBuddyNative).mockImplementation(() => ({ error: null, tracking: false, location: null, obtainLocation: jest.fn(), enableLocation, stopLocation: jest.fn(), enableNotifications: jest.fn() }));

const session = (status: string) => ({ id: 'session', status, requesterUserId: 'requester', attempts: [] });
const state = (status: string) => ({ session: session(status), error: null, locations: [], contacts: [], availability: null, refresh: jest.fn(), run: jest.fn(), dismissSession: jest.fn() }) as never;

const approach = { routeStatus: 'READY', leg: 'TO_REQUESTER', destination: null, route: { geometry: { type: 'LineString', coordinates: [[106.81, -6.21], [106.8, -6.2]] }, distanceM: 1000, durationSec: 600, profile: 'WALKING', maneuvers: [] }, evaluation: null, selectionReasonCodes: [] };
const routeCalls = () => jest.mocked(buddyRequest).mock.calls.filter(([, path]) => path === '/requests/session/route');

beforeEach(() => { mockParams = {}; enableLocation.mockClear(); jest.mocked(buddyRequest).mockReset().mockResolvedValue(approach); });

test('requester starts sharing once the session is accepted, and only once', async () => {
  const { rerender } = renderHook(({ status }: { status: string }) => useBuddyActions({ token: 'token', userId: 'requester', state: state(status) }), { initialProps: { status: 'WAITING' } });
  expect(enableLocation).not.toHaveBeenCalled();
  rerender({ status: 'ACCEPTED' });
  await waitFor(() => expect(enableLocation).toHaveBeenCalledTimes(1));
  rerender({ status: 'EN_ROUTE' });
  expect(enableLocation).toHaveBeenCalledTimes(1);
});

test('helper is not auto-shared on acceptance', async () => {
  renderHook(() => useBuddyActions({ token: 'token', userId: 'helper', state: state('ACCEPTED') }));
  await new Promise(resolve => setImmediate(resolve));
  expect(enableLocation).not.toHaveBeenCalled();
});

test('requester sees the helper approach route while the helper is on the way', async () => {
  const { result, rerender } = renderHook(({ status }: { status: string }) => useBuddyActions({ token: 'token', userId: 'requester', state: state(status) }), { initialProps: { status: 'EN_ROUTE' } });
  await waitFor(() => expect(result.current.helperRoute?.route?.distanceM).toBe(1000));
  expect(routeCalls()[0]?.[3]).toEqual(expect.objectContaining({ leg: 'TO_REQUESTER' }));
  rerender({ status: 'ARRIVED' });
  expect(result.current.helperRoute).toBeNull();
});

test('helper does not poll the approach route', async () => {
  renderHook(() => useBuddyActions({ token: 'token', userId: 'helper', state: state('EN_ROUTE') }));
  await new Promise(resolve => setImmediate(resolve));
  expect(routeCalls()).toHaveLength(0);
});

test('asking for help from Home with no Buddy explains and offers 112 once, and never dials by itself', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  const idle = { session: null, loading: false, error: null, locations: [], contacts: [], availability: null, refresh: jest.fn(), run: jest.fn(), dismissSession: jest.fn() } as never;
  mockParams = { help: '1' };
  const view = renderHook(() => useBuddyActions({ token: 'token', userId: 'me', state: idle }));
  await waitFor(() => expect(alert).toHaveBeenCalledTimes(1));
  const [title, body, buttons] = alert.mock.calls[0];
  expect([title, body]).toEqual(['emptyTitle', 'noBuddyHelp']);
  expect(buttons!.map(button => button.text)).toEqual(['cancel', 'call112']);
  expect(open).not.toHaveBeenCalled();
  buttons![1].onPress!();
  expect(open).toHaveBeenCalledWith('tel:112');
  view.rerender({});
  expect(alert).toHaveBeenCalledTimes(1);
  mockParams = { help: '2' };
  view.rerender({});
  await waitFor(() => expect(alert).toHaveBeenCalledTimes(2));
  alert.mockRestore(); open.mockRestore();
});


test('Home help waits through loading and errors, then asks the loaded primary Buddy once', () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const idle = { session: null, locations: [], availability: null, refresh: jest.fn(), run: jest.fn(), dismissSession: jest.fn() };
  mockParams = { help: 'retry' };
  try {
    const view = renderHook(({ loading, error }: { loading: boolean; error: string | null }) => useBuddyActions({ token: 'token', userId: 'me', state: { ...idle, loading, error, contacts: !loading && !error ? [{ level: 'PRIMARY', buddyUserId: 'buddy' }] : [] } as never }), { initialProps: { loading: true, error: null } });
    expect(alert).not.toHaveBeenCalled();
    view.rerender({ loading: false, error: 'Connection unavailable' });
    expect(alert).not.toHaveBeenCalled();
    view.rerender({ loading: false, error: null });
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert).toHaveBeenCalledWith('send', 'consent', expect.any(Array));
    expect(idle.run).not.toHaveBeenCalled();
    view.rerender({ loading: false, error: null });
    expect(alert).toHaveBeenCalledTimes(1);
  } finally { alert.mockRestore(); }
});
