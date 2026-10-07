import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import * as Speech from 'expo-speech';
import { speak, stopSpeaking, useReadAloud } from './speech';

let mockLanguage = 'en';
jest.mock('expo-speech', () => ({ stop: jest.fn(() => Promise.resolve()), speak: jest.fn() }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: mockLanguage } }) }));

beforeEach(() => {
  jest.restoreAllMocks(); jest.clearAllMocks(); mockLanguage = 'en';
  jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
});

test('screen readers announce without app speech', async () => {
  jest.mocked(AccessibilityInfo.isScreenReaderEnabled).mockResolvedValue(true);
  await speak('Warning', 'id');
  expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith('Warning');
  expect(Speech.speak).not.toHaveBeenCalled();
  expect(Speech.stop).not.toHaveBeenCalled();
  const view = renderHook(() => useReadAloud('Details', { auto: true }));
  await waitFor(() => expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith('Details'));
  expect(view.result.current.speaking).toBe(false);
  expect(Speech.speak).not.toHaveBeenCalled();
});

test.each([['id', 'id-ID'], ['en', 'en-US'], ['fr', 'en-US']])('speech stops first and uses %s language', async (language, expected) => {
  await speak('Warning', language);
  expect(Speech.stop).toHaveBeenCalledTimes(1);
  expect(Speech.speak).toHaveBeenCalledWith('Warning', { language: expected });
  expect(jest.mocked(Speech.stop).mock.invocationCallOrder[0]).toBeLessThan(jest.mocked(Speech.speak).mock.invocationCallOrder[0]);
});

test('auto reads once across re-renders and stops on unmount', async () => {
  mockLanguage = 'id';
  const view = renderHook(({ text }: { text: string }) => useReadAloud(text, { auto: true }), { initialProps: { text: 'Warning' } });
  await waitFor(() => expect(view.result.current.speaking).toBe(true));
  view.rerender({ text: ['Warn', 'ing'].join('') });
  view.rerender({ text: 'Updated warning' });
  expect(Speech.speak).toHaveBeenCalledTimes(1);
  expect(Speech.speak).toHaveBeenCalledWith('Warning', expect.objectContaining({ language: 'id-ID' }));
  jest.mocked(Speech.stop).mockClear();
  view.unmount();
  expect(Speech.stop).toHaveBeenCalledTimes(1);
});

test('toggle starts and stops', async () => {
  const view = renderHook(() => useReadAloud('Warning', { auto: false }));
  expect(Speech.speak).not.toHaveBeenCalled();
  act(() => view.result.current.toggle());
  await waitFor(() => expect(view.result.current.speaking).toBe(true));
  act(() => view.result.current.toggle());
  expect(view.result.current.speaking).toBe(false);
  expect(Speech.stop).toHaveBeenCalledTimes(2);
});

test.each(['onDone', 'onStopped', 'onError'] as const)('%s returns the hook to idle', async callback => {
  const view = renderHook(() => useReadAloud('Warning', { auto: true }));
  await waitFor(() => expect(view.result.current.speaking).toBe(true));
  const options = jest.mocked(Speech.speak).mock.calls[0][1]!;
  act(() => { if (callback === 'onError') options.onError?.(new Error('speech')); else options[callback]?.(); });
  expect(view.result.current.speaking).toBe(false);
});

test('unmount cancels a pending read and stop swallows rejections', async () => {
  let resolve: (enabled: boolean) => void = () => {};
  jest.mocked(AccessibilityInfo.isScreenReaderEnabled).mockReturnValue(new Promise<boolean>(done => { resolve = done; }));
  const view = renderHook(() => useReadAloud('Warning', { auto: true }));
  view.unmount();
  await act(async () => resolve(false));
  expect(Speech.speak).not.toHaveBeenCalled();
  jest.mocked(Speech.stop).mockRejectedValueOnce(new Error('stop'));
  stopSpeaking();
  await act(async () => {});
});
