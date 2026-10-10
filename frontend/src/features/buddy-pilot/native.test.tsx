import { act, renderHook } from '@testing-library/react-native';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { apiRequest } from '../profile/api';
import * as Speech from 'expo-speech';
import { useBuddyNative, useInboxNotifications, useBuddySpeech } from './native';

jest.mock('expo-constants', () => ({ __esModule: true, default: {} }));
jest.mock('expo-location', () => ({ requestForegroundPermissionsAsync: jest.fn(), requestBackgroundPermissionsAsync: jest.fn().mockResolvedValue({ granted: false }), watchPositionAsync: jest.fn().mockResolvedValue({ remove: jest.fn() }), getCurrentPositionAsync: jest.fn(), hasStartedLocationUpdatesAsync: jest.fn().mockResolvedValue(false), stopLocationUpdatesAsync: jest.fn(), Accuracy: { High: 4 } }));
jest.mock('expo-notifications', () => ({ setNotificationHandler: jest.fn(), getPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }), scheduleNotificationAsync: jest.fn().mockResolvedValue('id'), getLastNotificationResponseAsync: jest.fn().mockResolvedValue(null), addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })), addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })) }));
jest.mock('expo-secure-store', () => ({ deleteItemAsync: jest.fn().mockResolvedValue(undefined), setItemAsync: jest.fn().mockResolvedValue(undefined), getItemAsync: jest.fn().mockResolvedValue(null) }));
jest.mock('expo-task-manager', () => ({ isTaskDefined: jest.fn(() => false), defineTask: jest.fn() }));
jest.mock('expo-speech', () => ({ stop: jest.fn(), speak: jest.fn() }));
jest.mock('expo-speech-recognition', () => ({ ExpoSpeechRecognitionModule: {}, useSpeechRecognitionEvent: jest.fn() }));
jest.mock('../profile/api', () => ({ apiRequest: jest.fn().mockResolvedValue(undefined) }));

test('never obtains or uploads coordinates before an accepted session', async () => {
  const { result } = renderHook(() => useBuddyNative({ active: false, sessionId: 'request', token: 'token', onRefresh: jest.fn() }));
  await expect(result.current.enableLocation()).rejects.toThrow('Accept a Buddy session');
  expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  expect(apiRequest).not.toHaveBeenCalled();
});

test('explicit stop revokes the server participant location', async () => {
  const { result } = renderHook(() => useBuddyNative({ active: true, sessionId: 'request', token: 'token', onRefresh: jest.fn() }));
  await act(async () => { await result.current.stopLocation(); });
  expect(apiRequest).toHaveBeenCalledWith('/v1/buddy-pilot/requests/request/location', 'token', expect.objectContaining({ method: 'DELETE' }));
});

test('unresolved session hydration preserves background consent', async () => {
  jest.mocked(SecureStore.deleteItemAsync).mockClear();
  renderHook(() => useBuddyNative({ active: undefined, sessionId: null, token: null, onRefresh: jest.fn() }));
  await act(async () => {});
  expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
});

test('stopping while permission is pending prevents a later upload', async () => {
  jest.mocked(apiRequest).mockClear();
  let grant!: (value: Awaited<ReturnType<typeof Location.requestForegroundPermissionsAsync>>) => void;
  jest.mocked(Location.requestForegroundPermissionsAsync).mockImplementationOnce(() => new Promise(resolve => { grant = resolve; }) as ReturnType<typeof Location.requestForegroundPermissionsAsync>);
  jest.mocked(Location.getCurrentPositionAsync).mockResolvedValueOnce({ coords: { latitude: 1, longitude: 2, accuracy: 5 }, timestamp: Date.now() } as Location.LocationObject);
  const { result } = renderHook(() => useBuddyNative({ active: true, sessionId: 'request', token: 'token', onRefresh: jest.fn() }));
  let pending!: Promise<void>;
  await act(async () => {
    pending = result.current.enableLocation();
    await result.current.stopLocation();
    grant({ granted: true } as Awaited<ReturnType<typeof Location.requestForegroundPermissionsAsync>>);
    await expect(pending).rejects.toThrow('stopped');
  });
  expect(jest.mocked(apiRequest).mock.calls.filter(([, , init]) => init?.method === 'PUT')).toHaveLength(0);
});


test('explicit grant sends the current server revocation version', async () => {
  jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValueOnce({ granted: true } as Awaited<ReturnType<typeof Location.requestForegroundPermissionsAsync>>);
  jest.mocked(Location.getCurrentPositionAsync).mockResolvedValueOnce({ coords: { latitude: 1, longitude: 2, accuracy: 5 }, timestamp: Date.now() } as Location.LocationObject);
  jest.mocked(apiRequest).mockImplementation(async (_path, _token, init) => init?.method === 'GET' ? { sharingVersion: 7 } : undefined);
  const { result } = renderHook(() => useBuddyNative({ active: true, sessionId: 'request', token: 'token', onRefresh: jest.fn() }));
  await act(async () => { await result.current.enableLocation(); });
  const grant = jest.mocked(apiRequest).mock.calls.find(([, , init]) => init?.method === 'PUT');
  expect(JSON.parse(grant?.[2]?.body as string)).toEqual(expect.objectContaining({ sharingConsent: true, sharingVersion: 7 }));
});

test('a stationary sharer keeps uploading fresh positions', async () => {
  jest.useFakeTimers();
  jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue({ granted: true } as Awaited<ReturnType<typeof Location.requestForegroundPermissionsAsync>>);
  jest.mocked(Location.getCurrentPositionAsync).mockImplementation(async () => ({ coords: { latitude: 1, longitude: 2, accuracy: 5 }, timestamp: Date.now() }) as Location.LocationObject);
  jest.mocked(apiRequest).mockImplementation(async (_path, _token, init) => init?.method === 'GET' ? { sharingVersion: 1 } : undefined);
  const { result } = renderHook(() => useBuddyNative({ active: true, sessionId: 'request', token: 'token', onRefresh: jest.fn() }));
  await act(async () => { await result.current.enableLocation(); });
  const puts = () => jest.mocked(apiRequest).mock.calls.filter(([, , init]) => init?.method === 'PUT').length;
  const before = puts();
  await act(async () => { await jest.advanceTimersByTimeAsync(10000); });
  expect(puts()).toBe(before + 1);
  jest.useRealTimers();
});


function speechHarness(onCommand = jest.fn()) {
  const { useSpeechRecognitionEvent, ExpoSpeechRecognitionModule } = jest.requireMock('expo-speech-recognition') as { useSpeechRecognitionEvent: jest.Mock; ExpoSpeechRecognitionModule: Record<string, jest.Mock> };
  ExpoSpeechRecognitionModule.abort = jest.fn();
  ExpoSpeechRecognitionModule.start = jest.fn();
  ExpoSpeechRecognitionModule.requestPermissionsAsync = jest.fn().mockResolvedValue({ granted: true });
  const { renderHook } = jest.requireActual('@testing-library/react-native');
  const { useBuddySpeech } = jest.requireActual('./native');
  const handlers: Record<string, (event: unknown) => void> = {};
  useSpeechRecognitionEvent.mockImplementation((name: string, handler: (event: unknown) => void) => { handlers[name] = handler; });
  return { handlers, ...renderHook(() => useBuddySpeech({ language: 'id', onCommand })) };
}

test('an intentional speech abort is not reported, other recognition errors are localized', async () => {
  const { act } = jest.requireActual('@testing-library/react-native');
  const { handlers, result } = speechHarness();
  await act(async () => result.current.startListening());
  act(() => handlers.error({ error: 'aborted', message: 'Speech recognition aborted.' }));
  expect(result.current.error).toBeNull();
  await act(async () => result.current.startListening());
  act(() => handlers.error({ error: 'network', message: 'Network error' }));
  expect(result.current.error).toBe('Pengenalan suara berhenti. Kontrol sentuh tetap tersedia.');
});

test('speech started by another screen is ignored, so Home and Buddy never both act on one sentence', async () => {
  const { act } = jest.requireActual('@testing-library/react-native');
  const onCommand = jest.fn();
  const { handlers, result } = speechHarness(onCommand);
  act(() => { handlers.start({}); handlers.result({ isFinal: true, results: [{ transcript: 'tolong' }] }); });
  expect(result.current.listening).toBe(false);
  expect(onCommand).not.toHaveBeenCalled();
  await act(async () => result.current.startListening());
  act(() => { handlers.start({}); handlers.result({ isFinal: true, results: [{ transcript: 'tolong' }] }); });
  expect(onCommand).toHaveBeenCalledWith('tolong');
});

test('inbox notifications fire once per new incoming item and never for history', async () => {
  const schedule = Notifications.scheduleNotificationAsync as jest.Mock;
  schedule.mockClear();
  const old = { id: 'old', kind: 'OFFER', read: false, requestId: 'r0' };
  const { rerender } = renderHook(({ inbox }: { inbox: typeof old[] }) => useInboxNotifications(inbox, kind => `title:${kind}`), { initialProps: { inbox: [old] } });
  await act(async () => {});
  expect(schedule).not.toHaveBeenCalled();
  const offer = { id: 'new', kind: 'OFFER', read: false, requestId: 'r1' };
  const message = { id: 'msg', kind: 'MESSAGE', read: false, requestId: 'r1' };
  rerender({ inbox: [offer, message, old] });
  await act(async () => {});
  rerender({ inbox: [offer, message, old] });
  await act(async () => {});
  expect(schedule).toHaveBeenCalledTimes(1);
  expect(schedule).toHaveBeenCalledWith({ content: { title: 'title:OFFER', body: 'EvacuAid Buddy', data: { requestId: 'r1' } }, trigger: null });
});


test('cancelling speech aborts only recognition owned by this hook and ignores late results', async () => {
  const onCommand = jest.fn();
  const { handlers, result } = speechHarness(onCommand);
  const { ExpoSpeechRecognitionModule } = jest.requireMock('expo-speech-recognition');
  act(() => result.current.cancelListening());
  expect(ExpoSpeechRecognitionModule.abort).not.toHaveBeenCalled();
  await act(async () => result.current.startListening());
  act(() => handlers.start({}));
  expect(result.current.listening).toBe(true);
  act(() => result.current.cancelListening());
  expect(ExpoSpeechRecognitionModule.abort).toHaveBeenCalledTimes(1);
  expect(result.current.listening).toBe(false);
  act(() => {
    handlers.result({ isFinal: true, results: [{ transcript: 'tolong' }] });
    handlers.error({ error: 'aborted' });
    handlers.end({});
    result.current.cancelListening();
  });
  expect(onCommand).not.toHaveBeenCalled();
  expect(result.current.error).toBeNull();
  expect(ExpoSpeechRecognitionModule.abort).toHaveBeenCalledTimes(1);
});


test('both Buddy stop paths leave the alert area task and credentials alone', async () => {
  jest.mocked(SecureStore.deleteItemAsync).mockClear();
  jest.mocked(Location.stopLocationUpdatesAsync).mockClear();
  jest.mocked(Location.hasStartedLocationUpdatesAsync).mockResolvedValueOnce(true).mockResolvedValueOnce(true);
  const { result, rerender } = renderHook(({ active }: { active: boolean }) => useBuddyNative({ active, sessionId: 'request', token: 'token', onRefresh: jest.fn() }), { initialProps: { active: true } });
  await act(async () => result.current.stopLocation());
  rerender({ active: false });
  await act(async () => {});
  expect(jest.mocked(Location.stopLocationUpdatesAsync).mock.calls).toEqual([['evacuaid.buddy-location.v1'], ['evacuaid.buddy-location.v1']]);
  expect(jest.mocked(SecureStore.deleteItemAsync).mock.calls).toEqual([['evacuaid.buddy-location-session.v1'], ['evacuaid.buddy-location-session.v1']]);
});


test.each([true, false])('speech cleanup can leave the emergency shelter announcement running (%s)', stopSpeechOnUnmount => {
  jest.mocked(Speech.stop).mockClear();
  const view = renderHook(() => useBuddySpeech({ language: 'en', onCommand: jest.fn(), stopSpeechOnUnmount }));
  view.unmount();
  expect(Speech.stop).toHaveBeenCalledTimes(stopSpeechOnUnmount ? 1 : 0);
});
