import { renderHook } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import { useHaptics } from './haptics';

let mockVibration = true;
jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn(() => Promise.resolve()), notificationAsync: jest.fn(() => Promise.resolve()), NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' } }));
jest.mock('@/features/preferences/context', () => ({ usePreferences: () => ({ preferences: { vibrationEnabled: mockVibration } }) }));

beforeEach(() => { jest.clearAllMocks(); mockVibration = true; });

test('haptics fire once per call with the matching feedback type', () => {
  const { result } = renderHook(() => useHaptics());
  result.current.selection();
  result.current.success();
  result.current.warning();
  expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
  expect(Haptics.notificationAsync).toHaveBeenNthCalledWith(1, 'success');
  expect(Haptics.notificationAsync).toHaveBeenNthCalledWith(2, 'warning');
});

test('turning vibration off silences every haptic', () => {
  mockVibration = false;
  const { result } = renderHook(() => useHaptics());
  result.current.selection();
  result.current.success();
  result.current.warning();
  expect(Haptics.selectionAsync).not.toHaveBeenCalled();
  expect(Haptics.notificationAsync).not.toHaveBeenCalled();
});


let mockSoundFree = false;
jest.mock('@/features/access/use-access', () => ({ useAccess: () => ({ soundFree: mockSoundFree }) }));
beforeEach(() => { mockSoundFree = false; jest.useFakeTimers(); });
afterEach(() => jest.useRealTimers());

test.each(['normal', 'waspada', 'siaga', 'awas'] as const)('alert %s plays its timed pattern and doubles with soundFree', level => {
  const count = level === 'normal' ? 0 : level === 'waspada' ? 1 : level === 'siaga' ? 2 : 3;
  const type = level === 'awas' ? 'error' : 'warning';
  for (const soundFree of [false, true]) {
    jest.clearAllMocks();
    mockSoundFree = soundFree;
    const view = renderHook(() => useHaptics());
    view.result.current.alert(level);
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(count ? 1 : 0);
    for (let index = 1; index < count; index += 1) {
      jest.advanceTimersByTime(399);
      expect(Haptics.notificationAsync).toHaveBeenCalledTimes(index);
      jest.advanceTimersByTime(1);
      expect(Haptics.notificationAsync).toHaveBeenCalledTimes(index + 1);
    }
    if (soundFree && count) {
      jest.advanceTimersByTime(799);
      expect(Haptics.notificationAsync).toHaveBeenCalledTimes(count);
      jest.advanceTimersByTime(1);
      expect(Haptics.notificationAsync).toHaveBeenCalledTimes(count + 1);
      jest.advanceTimersByTime((count - 1) * 400);
    }
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(count * (soundFree ? 2 : 1));
    if (count) expect(Haptics.notificationAsync).toHaveBeenLastCalledWith(type);
    view.unmount();
  }
});

test('disabled vibration schedules no alerts', () => {
  mockVibration = false;
  mockSoundFree = true;
  const view = renderHook(() => useHaptics());
  for (const level of ['normal', 'waspada', 'siaga', 'awas'] as const) view.result.current.alert(level);
  jest.runAllTimers();
  expect(Haptics.notificationAsync).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});

test('unmount clears pending pulses', () => {
  mockSoundFree = true;
  const view = renderHook(() => useHaptics());
  view.result.current.alert('awas');
  expect(jest.getTimerCount()).toBe(5);
  view.unmount();
  expect(jest.getTimerCount()).toBe(0);
  jest.runAllTimers();
  expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1);
});
