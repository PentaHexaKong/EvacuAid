import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo, Alert, Linking } from 'react-native';
import { buddyRequest } from './api';
import { useBuddyNative } from './native';
import { useBuddyActions } from './use-buddy-actions';

const obtainLocation = jest.fn();
const enableLocation = jest.fn().mockResolvedValue(undefined);
jest.mock('./api', () => ({ ...jest.requireActual('./api'), buddyRequest: jest.fn() }));
let mockParams: { help?: string; consented?: string } = {};
jest.mock('expo-router', () => ({ useIsFocused: () => true, useLocalSearchParams: () => mockParams }));
jest.mock('@/features/profile/context', () => ({ useProfile: () => ({ accessibility: [{ type: 'MOBILITY_LIMITATION' }] }) }));
jest.mock('@/features/preferences/context', () => ({ usePreferences: () => ({ preferences: { voiceEnabled: false } }) }));
jest.mock('./copy', () => ({ readableIssue: jest.requireActual('./copy').readableIssue, useBuddyCopy: () => ({ c: (key: string) => key, status: (key: string) => key, language: 'en', support: jest.fn(), event: jest.fn() }) }));
jest.mock('./native', () => ({ useBuddyNative: jest.fn(), useBuddySpeech: () => ({ speak: jest.fn(), error: null }) }));
jest.mocked(useBuddyNative).mockImplementation(() => ({ error: null, tracking: false, foregroundOnly: false, location: null, obtainLocation, enableLocation, stopLocation: jest.fn(), enableNotifications: jest.fn() }));

const session = (status: string) => ({ id: 'session', status, requesterUserId: 'requester', attempts: [] });
const state = (status: string) => ({ session: session(status), error: null, locations: [], contacts: [], availability: null, refresh: jest.fn(), run: jest.fn(), dismissSession: jest.fn() }) as never;

const approach = { routeStatus: 'READY', leg: 'TO_REQUESTER', destination: null, route: { geometry: { type: 'LineString', coordinates: [[106.81, -6.21], [106.8, -6.2]] }, distanceM: 1000, durationSec: 600, profile: 'WALKING', maneuvers: [] }, evaluation: null, selectionReasonCodes: [] };
const routeCalls = () => jest.mocked(buddyRequest).mock.calls.filter(([, path]) => path === '/requests/session/route');

beforeEach(() => { mockParams = {}; obtainLocation.mockReset().mockResolvedValue({ latitude: -6.2, longitude: 106.8, accuracyM: 10, observedAt: '2026-10-10T00:00:00Z' }); enableLocation.mockClear(); jest.mocked(buddyRequest).mockReset().mockResolvedValue(approach); });

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
