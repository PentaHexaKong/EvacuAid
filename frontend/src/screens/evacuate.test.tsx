import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert, AppState, Linking } from 'react-native';
import { respondToAlert } from '@/features/alerts/api';
import { applyResponse } from '@/features/alerts/use-alerts';
import { useEvacuationGuidance } from '@/features/navigation/use-evacuation-guidance';
import { speak } from '@/features/feedback/speech';
import { EvacuateScreen } from './evacuate';

const mockRouter = { canGoBack: jest.fn(), back: jest.fn(), replace: jest.fn() };
const mockFind = jest.fn();
let mockParams: { shelterId?: string; alertId?: string };
let mockPhase = 'ready';
let mockFocused = true;
let mockSoundFree = false;
let mockArrived = false;
const mockResponse = { destination: { shelterId: 'hall', name: 'Town Hall', entranceNote: 'East entrance' }, route: { distanceM: 900 } };
jest.mock('expo-router', () => ({ useIsFocused: () => mockFocused, useRouter: () => mockRouter, useLocalSearchParams: () => mockParams }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 20, bottom: 34 }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, values?: Record<string, string>) => {
  let text = jest.requireActual('../localization/en.json')[key] ?? key;
  for (const [name, value] of Object.entries(values ?? {})) text = text.replace(`{{${name}}}`, String(value));
  return text;
}, i18n: { language: 'en' } }) }));
jest.mock('@/features/navigation/use-evacuation-route', () => ({ useEvacuationRoute: () => ({ phase: mockPhase, route: { response: mockResponse }, findRoute: mockFind }) }));
jest.mock('@/features/navigation/use-evacuation-guidance', () => ({ useEvacuationGuidance: jest.fn(() => ({ instruction: 'Turn left', upcoming: 'Continue straight', remainingM: 800, minutes: 9, nextManeuverM: 40, caption: 'Use the east entrance', arrived: mockArrived })) }));
jest.mock('@/features/profile/session', () => ({ useGuestSession: () => ({ token: 'guest' }) }));
jest.mock('@/features/access/use-access', () => ({ useAccess: () => ({ listen: true, soundFree: mockSoundFree }) }));
jest.mock('@/features/alerts/api', () => ({ respondToAlert: jest.fn().mockResolvedValue({ myResponse: 'SAFE' }) }));
let mockActive: string[] = [];
jest.mock('@/features/alerts/use-alerts', () => ({ applyResponse: jest.fn(), activeAlertIds: () => mockActive }));
jest.mock('@/features/feedback/speech', () => ({ speak: jest.fn().mockResolvedValue(undefined) }));

beforeEach(() => { jest.clearAllMocks(); mockParams = { shelterId: 'hall' }; mockPhase = 'ready'; mockFocused = true; mockSoundFree = false; mockArrived = false; mockRouter.canGoBack.mockReturnValue(true); jest.spyOn(Alert, 'alert').mockImplementation(() => {}); });

test('READY shows destination, instruction, remaining distance, entrance and caption, and speaks once', () => {
  const view = render(<EvacuateScreen />);
  expect(mockFind).toHaveBeenCalledWith('hall');
  expect(view.getByText('To Town Hall')).toBeTruthy();
  expect(view.getByRole('header', { name: 'Turn left' })).toBeTruthy();
  expect(view.getByText('800 m · about 9 min')).toBeTruthy();
  expect(view.getByText('Then')).toBeTruthy();
  expect(view.getByText('Continue straight · 40 m')).toBeTruthy();
  expect(view.getByText('Entrance')).toBeTruthy();
  expect(view.getByText('East entrance')).toBeTruthy();
  expect(view.getByText('Use the east entrance')).toHaveProp('accessibilityLiveRegion', 'polite');
  expect(speak).toHaveBeenCalledWith('Guidance to Town Hall, 900 m.', 'en');
  view.rerender(<EvacuateScreen />);
  expect(speak).toHaveBeenCalledTimes(1);
  mockArrived = true;
  view.rerender(<EvacuateScreen />);
  expect(view.getByRole('header', { name: "You've arrived." })).toBeTruthy();
});

test.each([undefined, 'rain'])('arrival posts SAFE when an alert is given and leaves Home (%s)', async alertId => {
  mockParams.alertId = alertId;
  const view = render(<EvacuateScreen />);
  fireEvent.press(view.getByRole('button', { name: "I've arrived, I'm safe" }));
  await waitFor(() => expect(mockRouter.back).toHaveBeenCalledTimes(1));
  expect(mockRouter.replace).not.toHaveBeenCalled();
  if (alertId) {
    expect(respondToAlert).toHaveBeenCalledWith('guest', 'rain', 'SAFE');
    expect(applyResponse).toHaveBeenCalledWith('rain', 'SAFE');
  } else { expect(respondToAlert).not.toHaveBeenCalled(); expect(applyResponse).not.toHaveBeenCalled(); }
});

test.each(['denied', 'unavailable', 'error', 'routing', 'locating'])('handles %s and keeps help available', phase => {
  mockPhase = phase;
  const view = render(<EvacuateScreen />);
  expect(view.getByRole('header', { name: phase === 'denied' ? 'Guidance needs your location.' : ['unavailable', 'error'].includes(phase) ? 'No safe walking route was found.' : 'Getting your route…' })).toBeTruthy();
  expect(view.queryByText("I've arrived, I'm safe")).toBeNull();
  if (phase === 'denied') {
    jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    fireEvent.press(view.getByRole('button', { name: 'Open Settings' }));
    expect(Linking.openSettings).toHaveBeenCalled();
  } else if (['unavailable', 'error'].includes(phase)) {
    mockFind.mockClear();
    fireEvent.press(view.getByRole('button', { name: 'Try again' }));
    expect(mockFind).toHaveBeenCalledWith('hall');
  }
  fireEvent.press(view.getByRole('button', { name: 'Request help' }));
  expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/buddy', params: { help: expect.any(String) } });
});

test.each([true, false])('stop asks before leaving and handles navigation history (%s)', canGoBack => {
  mockRouter.canGoBack.mockReturnValue(canGoBack);
  const view = render(<EvacuateScreen />);
  fireEvent.press(view.getByRole('button', { name: 'Stop guidance' }));
  expect(mockRouter.back).not.toHaveBeenCalled();
  expect(mockRouter.replace).not.toHaveBeenCalled();
  expect(Alert.alert).toHaveBeenCalledWith('Stop guidance?', 'You can start again from Home.', expect.any(Array));
  const buttons = jest.mocked(Alert.alert).mock.calls[0][2]!;
  expect(buttons[0].text).toBe('Keep going');
  act(() => buttons[1].onPress?.());
  if (canGoBack) expect(mockRouter.back).toHaveBeenCalled(); else expect(mockRouter.replace).toHaveBeenCalledWith('/');
});

test('sound-free suppresses the spoken start', () => {
  mockSoundFree = true;
  render(<EvacuateScreen />);
  expect(speak).not.toHaveBeenCalled();
});

test('a failed SAFE response keeps guidance open for retry', async () => {
  mockParams.alertId = 'rain';
  jest.mocked(respondToAlert).mockRejectedValueOnce(new Error('offline'));
  const view = render(<EvacuateScreen />);
  fireEvent.press(view.getByRole('button', { name: "I've arrived, I'm safe" }));
  await waitFor(() => expect(view.getByRole('alert')).toBeTruthy());
  expect(mockRouter.back).not.toHaveBeenCalled();
  expect(applyResponse).not.toHaveBeenCalled();
});

test('arrival also closes other warnings the person was acting on', async () => {
  mockParams.alertId = 'rain';
  mockActive = ['rain', 'flood'];
  try {
    const view = render(<EvacuateScreen />);
    fireEvent.press(view.getByRole('button', { name: "I've arrived, I'm safe" }));
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalledTimes(1));
    expect(jest.mocked(respondToAlert).mock.calls.map(call => call[1])).toEqual(['rain', 'flood']);
  } finally { mockActive = []; }
});

test('a failed reroute keeps guiding on the last good route', () => {
  const view = render(<EvacuateScreen />);
  expect(view.getByRole('header', { name: 'Turn left' })).toBeTruthy();
  mockPhase = 'unavailable';
  view.rerender(<EvacuateScreen />);
  expect(view.getByRole('header', { name: 'Turn left' })).toBeTruthy();
  expect(view.queryByText('No safe walking route was found.')).toBeNull();
  expect(view.getByRole('alert')).toHaveTextContent("Couldn't update your route. These directions may be out of date.");
  fireEvent.press(view.getByRole('button', { name: 'Try again' }));
  expect(mockFind).toHaveBeenLastCalledWith('hall');
  expect(view.getByRole('button', { name: "I've arrived, I'm safe" })).toBeTruthy();
  mockPhase = 'denied';
  view.rerender(<EvacuateScreen />);
  expect(view.getByRole('header', { name: 'Guidance needs your location.' })).toBeTruthy();
});


test('automatic reroutes pass the current fix and guidance follows screen focus', () => {
  const view = render(<EvacuateScreen />);
  const fix = { latitude: 0, longitude: 0.001, accuracyM: 5, observedAt: new Date().toISOString() };
  act(() => jest.mocked(useEvacuationGuidance).mock.calls.at(-1)![1](fix));
  expect(mockFind).toHaveBeenLastCalledWith('hall', fix);
  mockFocused = false;
  view.rerender(<EvacuateScreen />);
  expect(useEvacuationGuidance).toHaveBeenLastCalledWith(mockResponse, expect.any(Function), false);
  mockFocused = true;
  view.rerender(<EvacuateScreen />);
  expect(useEvacuationGuidance).toHaveBeenLastCalledWith(mockResponse, expect.any(Function), true);
  mockPhase = 'denied';
  view.rerender(<EvacuateScreen />);
  expect(useEvacuationGuidance).toHaveBeenLastCalledWith(mockResponse, expect.any(Function), false);
});

test('denied permission retries on foreground and from Try again, with listener cleanup', () => {
  let change!: (state: import('react-native').AppStateStatus) => void;
  const remove = jest.fn();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => { change = callback; return { remove }; });
  mockPhase = 'denied';
  const view = render(<EvacuateScreen />);
  mockFind.mockClear();
  act(() => change('background'));
  expect(mockFind).not.toHaveBeenCalled();
  act(() => change('active'));
  expect(mockFind).toHaveBeenCalledWith('hall');
  mockFind.mockClear();
  fireEvent.press(view.getByRole('button', { name: 'Try again' }));
  expect(mockFind).toHaveBeenCalledWith('hall');
  mockPhase = 'ready';
  view.rerender(<EvacuateScreen />);
  expect(remove).toHaveBeenCalledTimes(1);
  expect(view.queryByRole('button', { name: 'Try again' })).toBeNull();
  view.unmount();
  jest.mocked(AppState.addEventListener).mockRestore();
});
