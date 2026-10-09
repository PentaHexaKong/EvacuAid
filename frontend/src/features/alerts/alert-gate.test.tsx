import { render } from '@testing-library/react-native';
import { AlertGate, markAlertPresented } from './alert-gate';
import { alertItems } from './test-fixtures';
import type { AlertItem } from './api';

let mockItems: AlertItem[] = [];
let mockPathname = '/';
const mockPush = jest.fn();
jest.mock('./use-alerts', () => ({ useAlerts: () => ({ items: mockItems }) }));
jest.mock('expo-router', () => ({ usePathname: () => mockPathname, useRouter: () => ({ push: mockPush }) }));
const item = (id: string, extra: Partial<AlertItem> = {}): AlertItem => ({ ...alertItems[0], id, level: 'siaga', myResponse: null, ...extra });
beforeEach(() => { mockItems = []; mockPathname = '/'; mockPush.mockClear(); });
test('opens once per alert per session across remounts', () => {
  mockItems = [item('once')];
  const view = render(<AlertGate />);
  view.rerender(<AlertGate />);
  view.unmount();
  render(<AlertGate />);
  expect(mockPush).toHaveBeenCalledTimes(1);
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/emergency/[id]', params: { id: 'once' } });
});
test.each([{ level: 'waspada' as const }, { myResponse: 'SAFE' as const }, { myResponse: 'EVACUATING' as const }, { myResponse: 'NEEDS_HELP' as const }])('skips %p', extra => {
  mockItems = [item('skip', extra)];
  render(<AlertGate />);
  expect(mockPush).not.toHaveBeenCalled();
});
test('waits until an emergency is no longer on top', () => {
  mockItems = [item('waiting')];
  mockPathname = '/emergency/current';
  const view = render(<AlertGate />);
  expect(mockPush).not.toHaveBeenCalled();
  mockPathname = '/';
  view.rerender(<AlertGate />);
  expect(mockPush).toHaveBeenCalledTimes(1);
});
test('selects newest at the highest severity using compareAlerts', () => {
  mockItems = [item('old', { level: 'awas', issuedAt: '2026-10-01T00:00:00Z' }), item('new', { level: 'awas', issuedAt: '2026-10-02T00:00:00Z' }), item('lower', { issuedAt: '2026-10-03T00:00:00Z' })];
  render(<AlertGate />);
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/emergency/[id]', params: { id: 'new' } });
});
test('notification presentation suppresses the gate', () => {
  mockItems = [item('push')];
  markAlertPresented('push');
  render(<AlertGate />);
  expect(mockPush).not.toHaveBeenCalled();
});
test('an answered warning silences lower and equal ones but not a more severe one', () => {
  mockItems = [item('answered', { level: 'awas', myResponse: 'EVACUATING' }), item('lower'), item('equal', { level: 'awas' })];
  const view = render(<AlertGate />);
  expect(mockPush).not.toHaveBeenCalled();
  mockItems = [item('answered-siaga', { myResponse: 'SAFE' }), item('worse', { level: 'awas' })];
  view.rerender(<AlertGate />);
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/emergency/[id]', params: { id: 'worse' } });
});
