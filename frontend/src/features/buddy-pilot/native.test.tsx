import { act, renderHook } from '@testing-library/react-native';
import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
import { apiRequest } from '../profile/api';
import { useBuddyNative } from './native';

jest.mock('expo-constants', () => ({ __esModule: true, default: {} }));
jest.mock('expo-location', () => ({ requestForegroundPermissionsAsync: jest.fn(), requestBackgroundPermissionsAsync: jest.fn().mockResolvedValue({ granted: false }), watchPositionAsync: jest.fn().mockResolvedValue({ remove: jest.fn() }), getCurrentPositionAsync: jest.fn(), hasStartedLocationUpdatesAsync: jest.fn().mockResolvedValue(false), stopLocationUpdatesAsync: jest.fn(), Accuracy: { High: 4 } }));
jest.mock('expo-notifications', () => ({ getLastNotificationResponseAsync: jest.fn().mockResolvedValue(null), addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })), addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })) }));
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


test('an intentional speech abort is not reported, other recognition errors are localized', () => {
  const { useSpeechRecognitionEvent, ExpoSpeechRecognitionModule } = jest.requireMock('expo-speech-recognition') as { useSpeechRecognitionEvent: jest.Mock; ExpoSpeechRecognitionModule: Record<string, jest.Mock> };
  ExpoSpeechRecognitionModule.abort = jest.fn();
  const { renderHook, act } = jest.requireActual('@testing-library/react-native');
  const { useBuddySpeech } = jest.requireActual('./native');
  const handlers: Record<string, (event: unknown) => void> = {};
  useSpeechRecognitionEvent.mockImplementation((name: string, handler: (event: unknown) => void) => { handlers[name] = handler; });
  const { result } = renderHook(() => useBuddySpeech({ language: 'id', onCommand: jest.fn() }));
  act(() => handlers.error({ error: 'aborted', message: 'Speech recognition aborted.' }));
  expect(result.current.error).toBeNull();
  act(() => handlers.error({ error: 'network', message: 'Network error' }));
  expect(result.current.error).toBe('Pengenalan suara berhenti. Kontrol sentuh tetap tersedia.');
});
