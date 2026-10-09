import { AccessibilityInfo } from 'react-native';
import * as Speech from 'expo-speech';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { AlertsScreen, AlertScreen } from './alerts';
import { levelLabels, mapAlert } from '@/features/alerts/alerts';
import { alertItems } from '@/features/alerts/test-fixtures';
import type { TFunction } from 'i18next';
const sampleAlerts = alertItems.map(item => mapAlert(item, ((key: string) => id[key as keyof typeof id] ?? key) as TFunction));
jest.mock('@/features/alerts/use-alerts', () => ({ useAlerts: () => ({ status: 'ready', items: jest.requireActual('@/features/alerts/test-fixtures').alertItems, stale: false }), findAlert: (id: string) => jest.requireActual('@/features/alerts/test-fixtures').alertItems.find((item: { id: string }) => item.id === id) }));
import id from '@/localization/id.json';

const mockRouter = { push: jest.fn(), navigate: jest.fn(), dismissTo: jest.fn() };
jest.mock('expo-router', () => ({ useIsFocused: () => true, useRouter: () => mockRouter, useLocalSearchParams: () => ({ id: 'rain' }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => jest.requireActual('../localization/id.json')[key] ?? key, i18n: { language: 'id' } }) }));

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

let mockAccess = { listen: false, autoRead: false, voiceHome: false };
jest.mock('@/features/access/use-access', () => ({ useAccess: () => mockAccess }));
jest.mock('expo-speech', () => ({ stop: jest.fn(() => Promise.resolve()), speak: jest.fn() }));
beforeEach(() => { mockAccess = { listen: false, autoRead: false, voiceHome: false }; jest.clearAllMocks(); jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false); });

test.each([false, true])('detail offers Listen only with the capability (%s)', listen => {
  mockAccess = { listen, autoRead: false, voiceHome: false };
  const view = render(<AlertScreen />);
  expect(Boolean(view.queryByRole('button', { name: 'Dengarkan' }))).toBe(listen);
  expect(Speech.speak).not.toHaveBeenCalled();
});

test('detail auto reads the title and numbered first step on open', async () => {
  mockAccess = { listen: true, autoRead: true, voiceHome: false };
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
  mockAccess = { listen: true, autoRead: false, voiceHome: true };
  mockShelters = [{ name: 'Aula Kelurahan', distanceM: 250 }];
  const view = render(<AlertScreen sheet={sheet} />);
  fireEvent.press(view.getByRole('button', { name: id.findRouteToShelter }));
  expect(sheet ? mockRouter.dismissTo : mockRouter.navigate).toHaveBeenCalledWith({ pathname: '/evacuate', params: { alertId: 'rain' } });
  expect(Speech.speak).not.toHaveBeenCalled();
});

test('voice Home alert route opens guidance before shelters load', async () => {
  mockAccess = { listen: true, autoRead: false, voiceHome: true };
  const view = render(<AlertScreen />);
  fireEvent.press(view.getByRole('button', { name: id.findRouteToShelter }));
  expect(Speech.speak).not.toHaveBeenCalled();
  expect(mockRouter.navigate).toHaveBeenCalledWith({ pathname: '/evacuate', params: { alertId: 'rain' } });
  expect(mockRouter.dismissTo).not.toHaveBeenCalled();
});

test.each([false, true])('voice Home alert route stays silent without listening (sheet=%s)', sheet => {
  mockAccess = { listen: false, autoRead: false, voiceHome: true };
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
