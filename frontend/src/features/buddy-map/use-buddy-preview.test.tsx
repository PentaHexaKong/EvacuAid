import { AppState, type AppStateStatus } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';
import { useLocationPreview } from './use-buddy-preview';
import type { LocationSnapshot } from './location-source';

jest.mock('expo-router', () => ({ useFocusEffect: (callback: () => () => void) => jest.requireActual('react').useEffect(callback, [callback]) }));

test('unsubscribes on background and screen exit, and resubscribes on foreground', () => {
  jest.useFakeTimers();
  const previousState = AppState.currentState;
  AppState.currentState = 'active';
  let onChange!: (state: AppStateStatus) => void;
  const remove = jest.fn();
  const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => { onChange = listener; return { remove }; });
  const unsubscribe = jest.fn();
  const source = { subscribe: jest.fn((listener: (value: LocationSnapshot) => void) => { listener({ participants: [], connection: 'connected' }); return unsubscribe; }) };
  const { result, unmount } = renderHook(() => useLocationPreview(source));
  expect(source.subscribe).toHaveBeenCalledTimes(1);
  act(() => onChange('background'));
  expect(unsubscribe).toHaveBeenCalledTimes(1);
  expect(result.current.snapshot).toBeNull();
  expect(jest.getTimerCount()).toBe(0);
  act(() => onChange('active'));
  expect(source.subscribe).toHaveBeenCalledTimes(2);
  expect(result.current.snapshot?.connection).toBe('connected');
  unmount();
  expect(unsubscribe).toHaveBeenCalledTimes(2);
  expect(remove).toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
  spy.mockRestore(); AppState.currentState = previousState; jest.useRealTimers();
});
