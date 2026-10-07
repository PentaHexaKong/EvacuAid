import { AccessibilityInfo } from 'react-native';
import * as Speech from 'expo-speech';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { AlertsScreen, AlertScreen } from './alerts';
import { levelLabels, sampleAlerts } from '@/features/content/samples';
import id from '@/localization/id.json';

const mockRouter = { push: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, useLocalSearchParams: () => ({ id: 'rain' }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => jest.requireActual('../localization/id.json')[key] ?? key, i18n: { language: 'id' } }) }));

beforeEach(() => jest.clearAllMocks());

test.each([false, true])('each alert exposes its level and opens the matching route (sheet=%s)', sheet => {
  const view = render(<AlertsScreen sheet={sheet} />);
  expect(view.getAllByRole('button')).toHaveLength(sampleAlerts.length);
  sampleAlerts.forEach(alert => {
    const label = `${id[levelLabels[alert.level]]}. ${id[alert.title]}. ${id[alert.area]}. ${alert.issued}`;
    const row = view.getByRole('button', { name: label });
    expect(row.props.accessibilityLabel).toContain(id[levelLabels[alert.level]]);
    fireEvent.press(row);
    expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: sheet ? '/alerts/[id]' : '/alert/[id]', params: { id: alert.id } });
  });
});

let mockAccess = { listen: false, autoRead: false };
jest.mock('@/features/access/use-access', () => ({ useAccess: () => mockAccess }));
jest.mock('expo-speech', () => ({ stop: jest.fn(() => Promise.resolve()), speak: jest.fn() }));
beforeEach(() => { mockAccess = { listen: false, autoRead: false }; jest.clearAllMocks(); jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false); });

test.each([false, true])('detail offers Listen only with the capability (%s)', listen => {
  mockAccess = { listen, autoRead: false };
  const view = render(<AlertScreen />);
  expect(Boolean(view.queryByRole('button', { name: 'Dengarkan' }))).toBe(listen);
  expect(Speech.speak).not.toHaveBeenCalled();
});

test('detail auto reads the title and numbered first step on open', async () => {
  mockAccess = { listen: true, autoRead: true };
  const view = render(<AlertScreen />);
  await waitFor(() => expect(Speech.speak).toHaveBeenCalledTimes(1));
  const text = jest.mocked(Speech.speak).mock.calls[0][0];
  expect(text).toContain(id[sampleAlerts[0].title]);
  expect(text).toContain(`1. ${id[sampleAlerts[0].steps[0]]}`);
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
