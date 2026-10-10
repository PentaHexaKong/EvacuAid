import { AccessibilityInfo } from 'react-native';
import * as Speech from 'expo-speech';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { AlertsScreen, AlertScreen } from './alerts';
import { levelLabels, mapAlert } from '@/features/alerts/alerts';
import { alertItems } from '@/features/alerts/test-fixtures';
import type { TFunction } from 'i18next';
const sampleAlerts = alertItems.map(item => mapAlert(item, ((key: string) => id[key as keyof typeof id] ?? key) as TFunction));
let mockItems = alertItems;
let mockStatus = 'ready';
let mockStale = false;
let mockFocused = true;
jest.mock('@/features/alerts/use-alerts', () => ({ useAlerts: () => ({ status: mockStatus, items: mockItems, stale: mockStale, updatedAt: 0 }), findAlert: (id: string) => jest.requireActual('@/features/alerts/test-fixtures').alertItems.find((item: { id: string }) => item.id === id) }));
import id from '@/localization/id.json';

const mockRouter = { push: jest.fn(), navigate: jest.fn(), dismissTo: jest.fn() };
jest.mock('expo-router', () => ({ useIsFocused: () => mockFocused, useRouter: () => mockRouter, useLocalSearchParams: () => ({ id: 'rain' }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, params: Record<string, string | number> = {}) => { const copy = jest.requireActual('../localization/id.json'); const resolved = key === 'alertsSpokenCount' ? Number(params.count) === 1 ? 'alertsSpokenCount_one' : 'alertsSpokenCount_other' : key; return Object.entries(params).reduce((text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)), copy[resolved] ?? resolved); }, i18n: { language: 'id' } }) }));

beforeEach(() => jest.clearAllMocks());

test.each([false, true])('each alert exposes its level and opens the matching route (sheet=%s)', sheet => {
  const view = render(<AlertsScreen sheet={sheet} />);
  expect(view.getAllByRole('button')).toHaveLength(sampleAlerts.length);
  sampleAlerts.forEach(alert => {
    const label = `${id[levelLabels[alert.level]]}. ${id[alert.title as keyof typeof id]}. ${alert.area}. ${alert.issued}`;
    const row = view.getByRole('button', { name: label });
    expect(row.props.accessibilityLabel).toContain(id[levelLabels[alert.level]]);
    fireEvent.press(row);
    expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: sheet ? '/alerts/[id]' : '/alert/[id]', params: { id: alert.id } });
  });
});

let mockAccess = { listen: false, autoRead: false, voiceHome: false, soundFree: false };
jest.mock('@/features/access/use-access', () => ({ useAccess: () => mockAccess }));
jest.mock('expo-speech', () => ({ stop: jest.fn(() => Promise.resolve()), speak: jest.fn() }));
beforeEach(() => { mockItems = alertItems; mockStatus = 'ready'; mockStale = false; mockFocused = true; mockStartListening.mockClear(); mockCancelListening.mockClear(); mockAccess = { listen: false, autoRead: false, voiceHome: false, soundFree: false }; jest.clearAllMocks(); jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false); });

test.each([false, true])('detail offers Listen only with the capability (%s)', listen => {
  mockAccess = { listen, autoRead: false, voiceHome: false, soundFree: false };
  const view = render(<AlertScreen />);
  expect(Boolean(view.queryByRole('button', { name: 'Dengarkan' }))).toBe(listen);
  expect(Speech.speak).not.toHaveBeenCalled();
});

test('detail auto reads the title and numbered first step on open', async () => {
  mockAccess = { listen: true, autoRead: true, voiceHome: false, soundFree: false };
  const view = render(<AlertScreen />);
  await waitFor(() => expect(Speech.speak).toHaveBeenCalledTimes(1));
  const text = jest.mocked(Speech.speak).mock.calls[0][0];
  expect(text).toContain(id[sampleAlerts[0].title as keyof typeof id]);
  expect(text).toContain(`1. ${id[sampleAlerts[0].steps[0] as keyof typeof id]}`);
  expect(view.getByRole('button', { name: 'Berhenti' })).toBeTruthy();
});


const mockAlertHaptic = jest.fn();
jest.mock('@/features/feedback/haptics', () => ({ useHaptics: () => ({ alert: mockAlertHaptic }) }));
test('detail fires its alert pattern once on mount across rerenders', () => {
  const view = render(<AlertScreen />);
  view.rerender(<AlertScreen />);
  expect(mockAlertHaptic).toHaveBeenCalledTimes(1);
  expect(mockAlertHaptic).toHaveBeenCalledWith(sampleAlerts[0].level);
});


let mockShelters: { name: string; distanceM: number }[] | null = null;
jest.mock('@/features/navigation/use-evacuation-route', () => ({ useEvacuationRoute: () => ({ shelters: mockShelters }) }));
beforeEach(() => { mockShelters = null; });

test.each([false, true])('voice Home alert route opens guidance for the alert (sheet=%s)', async sheet => {
  mockAccess = { listen: true, autoRead: false, voiceHome: true, soundFree: false };
  mockShelters = [{ name: 'Aula Kelurahan', distanceM: 250 }];
  const view = render(<AlertScreen sheet={sheet} />);
  fireEvent.press(view.getByRole('button', { name: id.findRouteToShelter }));
  expect(sheet ? mockRouter.dismissTo : mockRouter.navigate).toHaveBeenCalledWith({ pathname: '/evacuate', params: { alertId: 'rain' } });
  expect(Speech.speak).not.toHaveBeenCalled();
});

test('voice Home alert route opens guidance before shelters load', async () => {
  mockAccess = { listen: true, autoRead: false, voiceHome: true, soundFree: false };
  const view = render(<AlertScreen />);
  fireEvent.press(view.getByRole('button', { name: id.findRouteToShelter }));
  expect(Speech.speak).not.toHaveBeenCalled();
  expect(mockRouter.navigate).toHaveBeenCalledWith({ pathname: '/evacuate', params: { alertId: 'rain' } });
  expect(mockRouter.dismissTo).not.toHaveBeenCalled();
});

test.each([false, true])('voice Home alert route stays silent without listening (sheet=%s)', sheet => {
  mockAccess = { listen: false, autoRead: false, voiceHome: true, soundFree: false };
  const view = render(<AlertScreen sheet={sheet} />);
  fireEvent.press(view.getByRole('button', { name: id.findRouteToShelter }));
  expect(Speech.speak).not.toHaveBeenCalled();
  expect(sheet ? mockRouter.dismissTo : mockRouter.navigate).toHaveBeenCalledWith({ pathname: '/evacuate', params: { alertId: 'rain' } });
});

test.each([false, true])('sighted alert route keeps Discover navigation (sheet=%s)', sheet => {
  const view = render(<AlertScreen sheet={sheet} />);
  fireEvent.press(view.getByRole('button', { name: id.findRouteToShelter }));
  expect(sheet ? mockRouter.dismissTo : mockRouter.navigate).toHaveBeenCalledWith({ pathname: '/discover', params: { route: expect.any(String) } });
  expect(Speech.speak).not.toHaveBeenCalled();
});

const mockStartListening = jest.fn().mockResolvedValue(undefined);
const mockCancelListening = jest.fn();
let mockCommand: (text: string) => void;
jest.mock('@/features/buddy-pilot/native', () => ({ useBuddySpeech: ({ onCommand }: { onCommand: (text: string) => void }) => {
  mockCommand = onCommand;
  return { listening: false, startListening: mockStartListening, stopListening: jest.fn(), cancelListening: mockCancelListening };
} }));

async function finishSpeech() {
  await act(async () => { jest.mocked(Speech.speak).mock.calls.at(-1)?.[1]?.onDone?.(); });
}

test('voice warnings read once on focus, ask after narration and navigate on yes', async () => {
  mockAccess = { listen: true, autoRead: false, voiceHome: true, soundFree: false };
  const view = render(<AlertsScreen />);
  await waitFor(() => expect(Speech.speak).toHaveBeenCalledTimes(1));
  expect(jest.mocked(Speech.speak).mock.calls[0][0]).toContain('Example area');
  expect(mockStartListening).not.toHaveBeenCalled();
  view.rerender(<AlertsScreen />);
  expect(Speech.speak).toHaveBeenCalledTimes(1);
  await finishSpeech();
  await waitFor(() => expect(Speech.speak).toHaveBeenLastCalledWith(id.alertsSpokenEvacuateAsk, expect.any(Object)));
  await finishSpeech();
  expect(mockStartListening).toHaveBeenCalledTimes(1);
  act(() => mockCommand('iya'));
  expect(mockRouter.navigate).toHaveBeenCalledWith({ pathname: '/evacuate', params: { alertId: 'rain' } });
  mockFocused = false;
  view.rerender(<AlertsScreen />);
  expect(mockCancelListening).toHaveBeenCalled();
  mockFocused = true;
  view.rerender(<AlertsScreen />);
  await waitFor(() => expect(Speech.speak).toHaveBeenCalledTimes(3));
  mockItems = [alertItems[1]];
  view.rerender(<AlertsScreen />);
  await waitFor(() => expect(Speech.speak).toHaveBeenCalledTimes(4));
});

test.each(['waspada', 'SAFE'])('voice warnings do not ask to evacuate for %s', async reason => {
  mockAccess = { listen: true, autoRead: false, voiceHome: true, soundFree: false };
  mockItems = reason === 'SAFE' ? [{ ...alertItems[0], myResponse: 'SAFE' }] : [alertItems[1]];
  render(<AlertsScreen />);
  await waitFor(() => expect(Speech.speak).toHaveBeenCalledTimes(1));
  await finishSpeech();
  expect(Speech.speak).toHaveBeenCalledTimes(1);
  expect(mockStartListening).not.toHaveBeenCalled();
});

test.each(['no', 'maybe'])('voice warnings %s keeps the user on the tab', async answer => {
  mockAccess = { listen: true, autoRead: false, voiceHome: true, soundFree: false };
  render(<AlertsScreen />);
  await waitFor(() => expect(Speech.speak).toHaveBeenCalledTimes(1));
  await finishSpeech();
  await finishSpeech();
  act(() => mockCommand(answer));
  await waitFor(() => expect(Speech.speak).toHaveBeenLastCalledWith(id.alertsSpokenStay, expect.any(Object)));
  expect(mockRouter.navigate).not.toHaveBeenCalled();
});

test.each(['no-location', 'error', 'stale'])('voice warnings read existing %s copy instead of alerts', async status => {
  mockAccess = { listen: true, autoRead: false, voiceHome: true, soundFree: false };
  mockStatus = status === 'stale' ? 'ready' : status;
  mockStale = status === 'stale';
  render(<AlertsScreen />);
  await waitFor(() => expect(Speech.speak).toHaveBeenCalledTimes(1));
  expect(jest.mocked(Speech.speak).mock.calls[0][0]).toContain(status === 'error' ? id.alertUnavailable : status === 'no-location' ? id.alertNoLocationBody : id.alertStale.split('{{')[0]);
  await finishSpeech();
  expect(mockStartListening).not.toHaveBeenCalled();
});

test.each(['sighted', 'sheet', 'soundFree', 'disabled'])('warnings stay silent for %s', async reason => {
  mockAccess = { listen: reason !== 'disabled', autoRead: false, voiceHome: reason !== 'sighted', soundFree: reason === 'soundFree' };
  const view = render(<AlertsScreen sheet={reason === 'sheet'} />);
  await act(async () => {});
  expect(Speech.speak).not.toHaveBeenCalled();
  expect(view.queryByRole('button', { name: id.voiceBuddyMic })).toBeNull();
});

test('voice warnings mic starts recognition and the secondary control reads again', async () => {
  mockAccess = { listen: true, autoRead: false, voiceHome: true, soundFree: false };
  const view = render(<AlertsScreen />);
  await waitFor(() => expect(Speech.speak).toHaveBeenCalledTimes(1));
  fireEvent.press(view.getByRole('button', { name: id.voiceBuddyMic }));
  await waitFor(() => expect(mockStartListening).toHaveBeenCalledTimes(1));
  fireEvent.press(view.getByRole('button', { name: id.alertsReadAgain }));
  await waitFor(() => expect(Speech.speak).toHaveBeenCalledTimes(2));
});


test.each(['siaga', 'awas'] as const)('a same-id escalation to %s is read once and asks about evacuation', async level => {
  mockAccess = { listen: true, autoRead: false, voiceHome: true, soundFree: false };
  mockItems = [{ ...alertItems[1], level: 'waspada' }];
  const view = render(<AlertsScreen />);
  await waitFor(() => expect(Speech.speak).toHaveBeenCalledTimes(1));
  await finishSpeech();
  expect(mockStartListening).not.toHaveBeenCalled();
  mockItems = mockItems.map(item => ({ ...item, level }));
  view.rerender(<AlertsScreen />);
  await waitFor(() => expect(Speech.speak).toHaveBeenCalledTimes(2));
  expect(jest.mocked(Speech.speak).mock.calls.at(-1)?.[0]).toContain(id[levelLabels[level]]);
  await finishSpeech();
  await waitFor(() => expect(Speech.speak).toHaveBeenLastCalledWith(id.alertsSpokenEvacuateAsk, expect.any(Object)));
  await finishSpeech();
  expect(mockStartListening).toHaveBeenCalledTimes(1);
  mockItems = mockItems.map(item => ({ ...item }));
  view.rerender(<AlertsScreen />);
  await act(async () => {});
  expect(Speech.speak).toHaveBeenCalledTimes(3);
  act(() => mockCommand('yes'));
  expect(mockRouter.navigate).toHaveBeenCalledWith({ pathname: '/evacuate', params: { alertId: alertItems[1].id } });
});

test.each(['area', 'validUntil', 'myResponse'] as const)('changed warning %s is announced once', async field => {
  mockAccess = { listen: true, autoRead: false, voiceHome: true, soundFree: false };
  mockItems = [{ ...alertItems[0], myResponse: 'SAFE' }];
  const view = render(<AlertsScreen />);
  await waitFor(() => expect(Speech.speak).toHaveBeenCalledTimes(1));
  await finishSpeech();
  const changes = { area: 'Another area', validUntil: '2026-10-10T12:00:00Z', myResponse: 'NEED_HELP' };
  mockItems = mockItems.map(item => ({ ...item, [field]: changes[field] }));
  view.rerender(<AlertsScreen />);
  await waitFor(() => expect(Speech.speak).toHaveBeenCalledTimes(2));
  mockItems = mockItems.map(item => ({ ...item }));
  view.rerender(<AlertsScreen />);
  await act(async () => {});
  expect(Speech.speak).toHaveBeenCalledTimes(2);
});
