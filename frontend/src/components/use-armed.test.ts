import { act, renderHook } from '@testing-library/react-native';
import { useArmed } from './use-armed';

test('actions arm only after the delay', () => {
  jest.useFakeTimers();
  try {
    const { result } = renderHook(() => useArmed(600));
    expect(result.current).toBe(false);
    act(() => { jest.advanceTimersByTime(599); });
    expect(result.current).toBe(false);
    act(() => { jest.advanceTimersByTime(1); });
    expect(result.current).toBe(true);
  } finally { jest.useRealTimers(); }
});
