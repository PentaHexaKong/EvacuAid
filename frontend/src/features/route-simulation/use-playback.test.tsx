import { type ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { SystemReduceMotionContext } from '@/theme';
import { usePlayback } from './use-playback';

let mockFocused = true;
jest.mock('expo-router', () => ({ useFocusEffect: (effect: () => (() => void)) => {
  const { useEffect } = jest.requireActual('react');
  const focused = mockFocused;
  useEffect(() => focused ? effect() : undefined, [effect, focused]);
} }));

beforeEach(() => { jest.useFakeTimers(); mockFocused = true; Object.defineProperty(AppState, 'currentState', { value: 'active', writable: true }); });
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

function wrapper({ children }: { children: ReactNode }) { return <SystemReduceMotionContext.Provider value={false}>{children}</SystemReduceMotionContext.Provider>; }

test('starts paused, takes 30 active seconds, pause preserves distance, reset clears progress', () => {
  const { result, unmount } = renderHook(() => usePlayback(true), { wrapper });
  act(() => jest.advanceTimersByTime(5000));
  expect(result.current.progress).toBe(0);
  act(() => result.current.play());
  act(() => jest.advanceTimersByTime(10000));
  act(() => result.current.pause());
  expect(result.current.progress).toBeCloseTo(1 / 3);
  act(() => jest.advanceTimersByTime(9000));
  expect(result.current.progress).toBeCloseTo(1 / 3);
  act(() => result.current.play());
  act(() => jest.advanceTimersByTime(20000));
  expect(result.current.progress).toBe(1);
  expect(result.current.playing).toBe(false);
  act(() => result.current.reset());
  expect(result.current.progress).toBe(0);
  expect(result.current.playing).toBe(false);
  unmount();
  expect(jest.getTimerCount()).toBe(0);
});

test('background, blur, and unmount pause and clear timers; returning never autoplays', () => {
  let change: (state: AppStateStatus) => void = () => {};
  const remove = jest.fn();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_, listener) => { change = listener; return { remove }; });
  const view = renderHook(() => usePlayback(true), { wrapper });
  act(() => view.result.current.play());
  act(() => jest.advanceTimersByTime(3000));
  act(() => { AppState.currentState = 'background'; change('background'); });
  expect(view.result.current.playing).toBe(false);
  expect(jest.getTimerCount()).toBe(0);
  act(() => { AppState.currentState = 'active'; change('active'); });
  expect(view.result.current.playing).toBe(false);
  act(() => view.result.current.play());
  mockFocused = false;
  view.rerender({});
  expect(view.result.current.playing).toBe(false);
  expect(jest.getTimerCount()).toBe(0);
  mockFocused = true;
  view.rerender({});
  expect(view.result.current.playing).toBe(false);
  act(() => view.result.current.play());
  view.unmount();
  expect(remove).toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});

test('reduced motion updates once per second; unreachable routes cannot start', () => {
  const view = renderHook(({ enabled }: { enabled: boolean }) => usePlayback(enabled), { initialProps: { enabled: false } });
  act(() => view.result.current.play());
  expect(view.result.current.playing).toBe(false);
  view.rerender({ enabled: true });
  act(() => view.result.current.play());
  act(() => jest.advanceTimersByTime(999));
  expect(view.result.current.progress).toBe(0);
  act(() => jest.advanceTimersByTime(1));
  expect(view.result.current.progress).toBeCloseTo(1 / 30);
  view.unmount();
  expect(jest.getTimerCount()).toBe(0);
});
