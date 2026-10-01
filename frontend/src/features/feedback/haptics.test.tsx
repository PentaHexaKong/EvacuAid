import { renderHook } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import { useHaptics } from './haptics';

let mockVibration = true;
jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn(() => Promise.resolve()), notificationAsync: jest.fn(() => Promise.resolve()), NotificationFeedbackType: { Success: 'success', Warning: 'warning' } }));
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
