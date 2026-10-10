import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import * as Speech from 'expo-speech';
import { useVoicePrompt } from './use-voice-prompt';

let mockFocused = true;
jest.mock('expo-router', () => ({ useIsFocused: () => mockFocused }));
jest.mock('expo-speech', () => ({ stop: jest.fn(() => Promise.resolve()), speak: jest.fn() }));
const startListening = jest.fn().mockResolvedValue(undefined);
const cancelListening = jest.fn();
const voice = { startListening, cancelListening } as never;

beforeEach(() => { jest.clearAllMocks(); mockFocused = true; jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false); });

test('leaving during a prompt stops narration and ignores its late completion', async () => {
  const { result, rerender } = renderHook(() => useVoicePrompt(voice, true, 'en'));
  await act(async () => result.current.say('Confirm?', () => { void result.current.listen(); }));
  await waitFor(() => expect(Speech.speak).toHaveBeenCalledTimes(1));
  const done = jest.mocked(Speech.speak).mock.calls[0][1]?.onDone;
  jest.mocked(Speech.stop).mockClear();
  mockFocused = false;
  rerender({});
  expect(Speech.stop).toHaveBeenCalled();
  await act(async () => done?.());
  expect(startListening).not.toHaveBeenCalled();
});

test('VoiceOver completion opens the mic only after the matching announcement', async () => {
  jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(true);
  const remove = jest.fn();
  let finished: (event: { announcement: string; success: boolean }) => void = () => {};
  const listener = jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation((_, callback) => { finished = callback as typeof finished; return { remove } as never; });
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
  const { result } = renderHook(() => useVoicePrompt(voice, true, 'en'));
  await act(async () => result.current.say('Confirm?', () => { void result.current.listen(); }));
  expect(announce).toHaveBeenCalledWith('Confirm?');
  expect(startListening).not.toHaveBeenCalled();
  await act(async () => finished({ announcement: 'Other screen', success: true }));
  expect(startListening).not.toHaveBeenCalled();
  await act(async () => finished({ announcement: 'Confirm?', success: true }));
  expect(startListening).toHaveBeenCalledTimes(1);
  expect(remove).toHaveBeenCalled();
  listener.mockRestore(); announce.mockRestore();
});

test('disabled speech does not narrate or stop another screen on unmount', async () => {
  const { result, unmount } = renderHook(() => useVoicePrompt(voice, false, 'id'));
  await act(async () => { await result.current.say('Confirm?'); await result.current.listen(); });
  unmount();
  expect(Speech.speak).not.toHaveBeenCalled();
  expect(Speech.stop).not.toHaveBeenCalled();
  expect(startListening).not.toHaveBeenCalled();
  expect(cancelListening).not.toHaveBeenCalled();
});
