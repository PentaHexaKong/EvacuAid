import NetInfo from '@react-native-community/netinfo';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo, Alert, AppState, Linking } from 'react-native';
import { buddyRequest } from './api';
import { useBuddyNative } from './native';
import { useBuddyActions } from './use-buddy-actions';

let mockFocused = true;
const mockNetworkListeners: ((network: { isConnected: boolean; isInternetReachable: boolean }) => void)[] = [];
const obtainLocation = jest.fn();
const enableLocation = jest.fn().mockResolvedValue(undefined);
jest.mock('./use-beacons', () => ({ useBeacons: () => ({ status: 'unavailable', advertising: false, people: [], offline: false }) }));
jest.mock('@react-native-community/netinfo', () => ({ __esModule: true, default: { fetch: jest.fn().mockResolvedValue({ isConnected: true, isInternetReachable: true }), addEventListener: jest.fn(listener => { mockNetworkListeners.push(listener); return () => {}; }) } }));
jest.mock('./api', () => ({ ...jest.requireActual('./api'), buddyRequest: jest.fn() }));
let mockParams: { help?: string; consented?: string } = {};
jest.mock('expo-router', () => ({ useIsFocused: () => mockFocused, useLocalSearchParams: () => mockParams }));
jest.mock('@/features/profile/context', () => ({ useProfile: () => ({ accessibility: [{ type: 'MOBILITY_LIMITATION' }] }) }));
jest.mock('@/features/preferences/context', () => ({ usePreferences: () => ({ preferences: { voiceEnabled: false } }) }));
jest.mock('./copy', () => ({ readableIssue: jest.requireActual('./copy').readableIssue, useBuddyCopy: () => ({ c: (key: string) => key, status: (key: string) => key, language: 'en', support: jest.fn(), event: jest.fn() }) }));
jest.mock('./native', () => ({ useBuddyNative: jest.fn(), useBuddySpeech: () => ({ speak: jest.fn(), error: null }) }));
jest.mocked(useBuddyNative).mockImplementation(() => ({ error: null, tracking: false, foregroundOnly: false, location: null, obtainLocation, enableLocation, stopLocation: jest.fn(), enableNotifications: jest.fn() }));

const session = (status: string) => ({ id: 'session', status, requesterUserId: 'requester', attempts: [] });
const state = (status: string) => ({ session: session(status), error: null, locations: [], contacts: [], availability: null, refresh: jest.fn(), run: jest.fn(), dismissSession: jest.fn() }) as never;

const approach = { routeStatus: 'READY', leg: 'TO_REQUESTER', destination: null, route: { geometry: { type: 'LineString', coordinates: [[106.81, -6.21], [106.8, -6.2]] }, distanceM: 1000, durationSec: 600, profile: 'WALKING', maneuvers: [] }, evaluation: null, selectionReasonCodes: [] };
const routeCalls = () => jest.mocked(buddyRequest).mock.calls.filter(([, path]) => path === '/requests/session/route');

beforeEach(() => { Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' }); mockFocused = true; mockNetworkListeners.length = 0; jest.mocked(NetInfo.fetch).mockResolvedValue({ isConnected: true, isInternetReachable: true } as never); mockParams = {}; obtainLocation.mockReset().mockResolvedValue({ latitude: -6.2, longitude: 106.8, accuracyM: 10, observedAt: '2026-10-10T00:00:00Z' }); enableLocation.mockClear(); jest.mocked(buddyRequest).mockReset().mockResolvedValue(approach); });

test('requester starts sharing once the session is accepted, and only once', async () => {
  const { rerender } = renderHook(({ status }: { status: string }) => useBuddyActions({ token: 'token', userId: 'requester', state: state(status) }), { initialProps: { status: 'WAITING' } });
  expect(enableLocation).not.toHaveBeenCalled();
  rerender({ status: 'ACCEPTED' });
  await waitFor(() => expect(enableLocation).toHaveBeenCalledTimes(1));
  rerender({ status: 'EN_ROUTE' });
  expect(enableLocation).toHaveBeenCalledTimes(1);
});

test('helper is not auto-shared on acceptance, but reads its own position once for the map', async () => {
  const { rerender } = renderHook(({ status }: { status: string }) => useBuddyActions({ token: 'token', userId: 'helper', state: state(status) }), { initialProps: { status: 'ACCEPTED' } });
  await waitFor(() => expect(obtainLocation).toHaveBeenCalledTimes(1));
  rerender({ status: 'EN_ROUTE' });
  await new Promise(resolve => setImmediate(resolve));
  expect(obtainLocation).toHaveBeenCalledTimes(1);
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
    expect(alert).toHaveBeenCalledWith('askBuddyTitle', 'acceptBody', expect.any(Array));
    expect(idle.run).not.toHaveBeenCalled();
    view.rerender({ loading: false, error: null });
    expect(alert).toHaveBeenCalledTimes(1);
  } finally { alert.mockRestore(); }
});

test.each(['COMPLETED', 'INTERRUPTED', 'UNANSWERED'])('Home help dismisses a %s session before asking once', status => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const idle = { loading: false, error: null, locations: [], contacts: [{ level: 'PRIMARY', buddyUserId: 'buddy' }], availability: null, refresh: jest.fn(), run: jest.fn(), dismissSession: jest.fn() };
  mockParams = { help: 'next' };
  try {
    const view = renderHook(({ selected }: { selected: ReturnType<typeof session> | null }) => useBuddyActions({ token: 'token', userId: 'me', state: { ...idle, session: selected } as never }), { initialProps: { selected: session(status) } });
    expect(idle.dismissSession).toHaveBeenCalledTimes(1);
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert).toHaveBeenCalledWith('askBuddyTitle', 'acceptBody', expect.any(Array));
    expect(idle.dismissSession.mock.invocationCallOrder[0]).toBeLessThan(alert.mock.invocationCallOrder[0]);
    expect(idle.run).not.toHaveBeenCalled();
    view.rerender({ selected: null });
    expect(idle.dismissSession).toHaveBeenCalledTimes(1);
    expect(alert).toHaveBeenCalledTimes(1);
  } finally { alert.mockRestore(); }
});

test.each(['WAITING', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'EVACUATING', 'COMPLETION_PENDING'])('Home help waits for a non-terminal %s session', status => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const idle = { loading: false, error: null, locations: [], contacts: [{ level: 'PRIMARY', buddyUserId: 'buddy' }], availability: null, refresh: jest.fn(), run: jest.fn(), dismissSession: jest.fn() };
  mockParams = { help: 'pending' };
  try {
    const view = renderHook(({ selected }: { selected: ReturnType<typeof session> | null }) => useBuddyActions({ token: 'token', userId: 'me', state: { ...idle, session: selected } as never }), { initialProps: { selected: session(status) } });
    expect(idle.dismissSession).not.toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalled();
    view.rerender({ selected: null });
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert).toHaveBeenCalledWith('askBuddyTitle', 'acceptBody', expect.any(Array));
  } finally { alert.mockRestore(); }
});


test.each([true, false])('consented emergency help sends directly with a Buddy (%s)', async hasBuddy => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const idle = { session: null, loading: false, error: null, locations: [], contacts: hasBuddy ? [{ level: 'SECONDARY', buddyUserId: 'other' }, { level: 'PRIMARY', buddyUserId: 'buddy' }] : [], availability: null, refresh: jest.fn(), run: jest.fn().mockResolvedValue(session('WAITING')), dismissSession: jest.fn() };
  mockParams = { help: 'emergency', consented: '1' };
  try {
    const view = renderHook(() => useBuddyActions({ token: 'token', userId: 'me', state: idle as never }));
    await waitFor(() => expect(idle.refresh).toHaveBeenCalledWith('session'));
    expect(idle.run).toHaveBeenCalledWith('/requests', expect.objectContaining({ helperUserId: hasBuddy ? 'buddy' : null, supportNeeds: ['MOBILITY_LIMITATION'], sharingConsent: true, idempotencyKey: expect.any(String) }));
    if (!hasBuddy) expect(idle.run).toHaveBeenCalledWith('/requests/session/nearby', expect.objectContaining({ accuracyM: 10 }));
    expect(alert).not.toHaveBeenCalled();
    view.rerender({});
    expect(idle.run).toHaveBeenCalledTimes(hasBuddy ? 1 : 2);
  } finally { alert.mockRestore(); }
});

test('consented emergency help offers 112 when location cannot be obtained', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  obtainLocation.mockRejectedValue(new Error('Location denied'));
  const idle = { session: null, loading: false, error: null, locations: [], contacts: [], availability: null, refresh: jest.fn(), run: jest.fn(), dismissSession: jest.fn() };
  mockParams = { help: 'emergency', consented: '1' };
  try {
    const view = renderHook(() => useBuddyActions({ token: 'token', userId: 'me', state: idle as never }));
    await waitFor(() => expect(view.result.current.issue).toBe('Location denied'));
    expect(alert).toHaveBeenCalledWith('locationMissing', 'Location denied', expect.any(Array));
    expect(alert.mock.calls[0][2]!.map(button => button.text)).toEqual(['cancel', 'call112']);
    expect(open).not.toHaveBeenCalled();
    expect(idle.run).not.toHaveBeenCalled();
    alert.mock.calls[0][2]![1].onPress!();
    expect(open).toHaveBeenCalledWith('tel:112');
  } finally { alert.mockRestore(); open.mockRestore(); }
});

test('requester automatically searches nearby once per fallback session across refreshes and in-flight rerenders', async () => {
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
  let finish!: (value: ReturnType<typeof session>) => void;
  const idle = { loading: false, error: null, locations: [], contacts: [], availability: null, refresh: jest.fn(), run: jest.fn().mockImplementation(() => new Promise(resolve => { finish = resolve; })), dismissSession: jest.fn() };
  try {
    const view = renderHook(({ id }: { id: string }) => useBuddyActions({ token: 'token', userId: 'requester', state: { ...idle, session: { ...session('FALLBACK_REQUIRED'), id } } as never }), { initialProps: { id: 'session' } });
    await waitFor(() => expect(idle.run).toHaveBeenCalledTimes(1));
    expect(idle.run).toHaveBeenCalledWith('/requests/session/nearby', expect.objectContaining({ accuracyM: 10 }));
    expect(announce).toHaveBeenCalledWith('fallbackSearchingNoName');
    expect(view.result.current.sessionStatus).toBe('fallbackSearchingNoName');
    view.rerender({ id: 'session' });
    expect(idle.run).toHaveBeenCalledTimes(1);
    await act(async () => finish(session('WAITING')));
    view.rerender({ id: 'session' });
    expect(idle.run).toHaveBeenCalledTimes(1);
    view.rerender({ id: 'next' });
    await waitFor(() => expect(idle.run).toHaveBeenCalledTimes(2));
  } finally { announce.mockRestore(); }
});

test.each([['UNANSWERED', 'requester'], ['FALLBACK_REQUIRED', 'helper']])('%s does not automatically search for %s', async (status, userId) => {
  const selected = { ...session(status), helperName: 'Sari' };
  const idle = { loading: false, error: null, locations: [], contacts: [], availability: null, refresh: jest.fn(), run: jest.fn(), dismissSession: jest.fn(), session: selected };
  renderHook(() => useBuddyActions({ token: 'token', userId, state: idle as never }));
  await act(async () => {});
  expect(idle.run).not.toHaveBeenCalled();
});


test('fallback status names the Buddy from the offer when no assigned helper name is available', async () => {
  const idle = { loading: false, error: null, locations: [], contacts: [{ buddyUserId: 'buddy', name: 'Sari' }], availability: null, refresh: jest.fn(), run: jest.fn().mockResolvedValue(null), dismissSession: jest.fn(), session: { ...session('FALLBACK_REQUIRED'), attempts: [{ helperUserId: 'buddy' }] } };
  const view = renderHook(() => useBuddyActions({ token: 'token', userId: 'requester', state: idle as never }));
  await waitFor(() => expect(idle.run).toHaveBeenCalledTimes(1));
  expect(view.result.current.sessionStatus).toBe('fallbackSearching');
  expect(view.result.current.statusText).toContain('fallbackSearching');
});

test('offline nearby SOS broadcasts locally and sends only after reconnect', async () => {
  jest.mocked(NetInfo.fetch).mockResolvedValue({ isConnected: false, isInternetReachable: false } as never);
  const idle = { session: null, loading: false, error: null, locations: [], contacts: [], availability: null, refresh: jest.fn(), run: jest.fn().mockResolvedValue(session('WAITING')), dismissSession: jest.fn() };
  const view = renderHook(() => useBuddyActions({ token: 'token', userId: 'requester', state: idle as never }));
  await act(async () => { expect(await view.result.current.startNearby(true)).toBe(true); });
  expect(view.result.current.localSos).toBe(true); expect(idle.run).not.toHaveBeenCalled(); expect(obtainLocation).not.toHaveBeenCalled();
  jest.mocked(NetInfo.fetch).mockResolvedValue({ isConnected: true, isInternetReachable: true } as never);
  await act(async () => { mockNetworkListeners.forEach(listener => listener({ isConnected: true, isInternetReachable: true })); });
  await waitFor(() => expect(view.result.current.localSos).toBe(false));
  expect(idle.run).toHaveBeenCalledTimes(2); expect(idle.refresh).toHaveBeenCalledWith('session');
});

test.each(['cancel', 'navigate', 'accepted'])('offline SOS cannot reconnect after %s', async reason => {
  jest.mocked(NetInfo.fetch).mockResolvedValue({ isConnected: false, isInternetReachable: false } as never);
  const idle = { loading: false, error: null, locations: [], contacts: [], availability: null, refresh: jest.fn(), run: jest.fn(), dismissSession: jest.fn() };
  const view = renderHook(({ selected }: { selected: ReturnType<typeof session> | null }) => useBuddyActions({ token: 'token', userId: 'requester', state: { ...idle, session: selected } as never }), { initialProps: { selected: null as ReturnType<typeof session> | null } });
  await act(async () => { await view.result.current.startNearby(true); }); expect(view.result.current.localSos).toBe(true);
  if (reason === 'cancel') act(() => view.result.current.cancelNearby());
  if (reason === 'navigate') { mockFocused = false; view.rerender({ selected: null }); }
  if (reason === 'accepted') view.rerender({ selected: session('ACCEPTED') });
  jest.mocked(NetInfo.fetch).mockResolvedValue({ isConnected: true, isInternetReachable: true } as never);
  await act(async () => { mockNetworkListeners.forEach(listener => listener({ isConnected: true, isInternetReachable: true })); });
  expect(idle.run).not.toHaveBeenCalled(); expect(view.result.current.localSos).toBe(false);
});

test('cancelling during reconnect creation closes the late request and prevents nearby search', async () => {
  jest.mocked(NetInfo.fetch).mockResolvedValue({ isConnected: false, isInternetReachable: false } as never);
  let finish!: (value: ReturnType<typeof session>) => void;
  const idle = { session: null, loading: false, error: null, locations: [], contacts: [], availability: null, refresh: jest.fn(), run: jest.fn(() => new Promise(resolve => { finish = resolve; })), dismissSession: jest.fn() };
  const view = renderHook(() => useBuddyActions({ token: 'token', userId: 'requester', state: idle as never }));
  await act(async () => { await view.result.current.startNearby(true); });
  jest.mocked(NetInfo.fetch).mockResolvedValue({ isConnected: true, isInternetReachable: true } as never);
  await act(async () => { mockNetworkListeners.forEach(listener => listener({ isConnected: true, isInternetReachable: true })); });
  await waitFor(() => expect(idle.run).toHaveBeenCalledTimes(1));
  act(() => view.result.current.cancelNearby()); await act(async () => { finish(session('WAITING')); });
  expect(buddyRequest).toHaveBeenCalledWith('token', '/requests/session/interrupt', 'POST', {}); expect(idle.run).toHaveBeenCalledTimes(1);
});

test('failed nearby transition keeps the created request for retry without duplicating it', async () => {
  jest.mocked(NetInfo.fetch).mockResolvedValue({ isConnected: false, isInternetReachable: false } as never);
  const idle = { session: null, loading: false, error: null, locations: [], contacts: [], availability: null, refresh: jest.fn(), run: jest.fn().mockResolvedValueOnce(session('WAITING')).mockResolvedValueOnce(undefined).mockResolvedValueOnce(session('WAITING')), dismissSession: jest.fn() };
  const view = renderHook(() => useBuddyActions({ token: 'token', userId: 'requester', state: idle as never }));
  await act(async () => { await view.result.current.startNearby(true); });
  jest.mocked(NetInfo.fetch).mockResolvedValue({ isConnected: true, isInternetReachable: true } as never);
  await act(async () => { mockNetworkListeners.forEach(listener => listener({ isConnected: true, isInternetReachable: true })); });
  await waitFor(() => expect(idle.run).toHaveBeenCalledTimes(2)); expect(view.result.current.localSos).toBe(true);
  await act(async () => { await view.result.current.startNearby(true); });
  expect(idle.run.mock.calls.map(call => call[0])).toEqual(['/requests', '/requests/session/nearby', '/requests/session/nearby']); expect(view.result.current.localSos).toBe(false);
});

test('opening a Bluetooth requester resolves an offer without accepting it', async () => {
  const idle = { session: null, loading: false, error: null, locations: [], contacts: [], availability: { optedIn: true }, refresh: jest.fn(), run: jest.fn(), dismissSession: jest.fn() };
  jest.mocked(buddyRequest).mockResolvedValue([{ id: 'detected-request' }]);
  const view = renderHook(() => useBuddyActions({ token: 'token', userId: 'helper', state: idle as never }));
  await act(async () => { expect(await view.result.current.openBeaconRequest(123)).toBe('detected-request'); });
  expect(buddyRequest).toHaveBeenCalledWith('token', '/nearby/beacons', 'POST', { beaconIds: [123] });
  expect(idle.run).not.toHaveBeenCalled();
});

test.each(['not_available', 'offline', 'expired'])('Bluetooth requester action reports %s without accepting help', async condition => {
  const idle = { session: null, loading: false, error: null, locations: [], contacts: [], availability: { optedIn: condition !== 'not_available' }, refresh: jest.fn(), run: jest.fn(), dismissSession: jest.fn() };
  if (condition === 'offline') jest.mocked(NetInfo.fetch).mockResolvedValue({ isConnected: false, isInternetReachable: false } as never);
  jest.mocked(buddyRequest).mockResolvedValue([]);
  const view = renderHook(() => useBuddyActions({ token: 'token', userId: 'helper', state: idle as never }));
  await act(async () => { expect(await view.result.current.openBeaconRequest(123)).toBeNull(); });
  expect(view.result.current.issue).toBe(condition === 'not_available' ? 'bluetoothOptInToAct' : condition === 'offline' ? 'bluetoothConnectToAct' : 'bluetoothRequestUnavailable');
  expect(idle.run).not.toHaveBeenCalled();
  if (condition !== 'expired') expect(buddyRequest).not.toHaveBeenCalled();
});

test('requester sends to a detected helper only after confirming', async () => {
  const selected = { ...session('WAITING'), nearby: true, attempts: [{ id: 'selected-attempt', helperUserId: 'nearby-helper', status: 'PENDING', expiresAt: new Date(Date.now() + 30000).toISOString() }] };
  const idle = { session: selected, loading: false, error: null, locations: [], contacts: [], availability: null, refresh: jest.fn(), run: jest.fn().mockResolvedValue({ ...selected, selectedAttemptId: 'selected-attempt' }), dismissSession: jest.fn() };
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const view = renderHook(() => useBuddyActions({ token: 'token', userId: 'requester', state: idle as never }));
  act(() => view.result.current.askBeaconHelper(456));
  expect(idle.run).not.toHaveBeenCalled();
  await act(async () => { alert.mock.calls.at(-1)?.[2]?.[1].onPress?.(); });
  expect(idle.run).toHaveBeenCalledWith('/requests/session/nearby/helper', { beaconId: 456 });
  expect(view.result.current.requestedBeaconId).toBe(456);
  selected.attempts[0].status = 'DECLINED';
  view.rerender(undefined);
  expect(view.result.current.requestedBeaconId).toBeNull();
  alert.mockRestore();
});

test('offline requester cannot send a helper offer', async () => {
  jest.mocked(NetInfo.fetch).mockResolvedValue({ isConnected: false, isInternetReachable: false } as never);
  const idle = { session: { ...session('WAITING'), nearby: true }, loading: false, error: null, locations: [], contacts: [], availability: null, refresh: jest.fn(), run: jest.fn(), dismissSession: jest.fn() };
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const view = renderHook(() => useBuddyActions({ token: 'token', userId: 'requester', state: idle as never }));
  act(() => view.result.current.askBeaconHelper(456));
  await act(async () => { alert.mock.calls.at(-1)?.[2]?.[1].onPress?.(); });
  expect(idle.run).not.toHaveBeenCalled();
  expect(view.result.current.issue).toBe('bluetoothConnectToAct');
  alert.mockRestore();
});

test('repeated requester-card taps resolve one offer', async () => {
  let finish!: (offers: { id: string }[]) => void;
  jest.mocked(buddyRequest).mockImplementation((_token, path) => path === '/nearby/beacons' ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(undefined));
  const idle = { session: null, loading: false, error: null, locations: [], contacts: [], availability: { optedIn: true }, refresh: jest.fn(), run: jest.fn(), dismissSession: jest.fn() };
  const view = renderHook(() => useBuddyActions({ token: 'token', userId: 'helper', state: idle as never }));
  let first!: Promise<string | null>;
  await act(async () => { first = view.result.current.openBeaconRequest(123); expect(await view.result.current.openBeaconRequest(123)).toBeNull(); });
  expect(jest.mocked(buddyRequest).mock.calls.filter(([, path]) => path === '/nearby/beacons')).toHaveLength(1);
  await act(async () => { finish([{ id: 'detected-request' }]); expect(await first).toBe('detected-request'); });
});
