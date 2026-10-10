import { useCallback, useEffect, useRef } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';
import { useIsFocused } from 'expo-router';
import * as Speech from 'expo-speech';
import type { useBuddySpeech } from '@/features/buddy/native';

export function useVoicePrompt(voice: ReturnType<typeof useBuddySpeech>, enabled: boolean, language: string) {
  const focused = useIsFocused();
  const active = useRef(false);
  const generation = useRef(0);
  const narration = useRef(false);
  const announcement = useRef<ReturnType<typeof AccessibilityInfo.addEventListener> | null>(null);
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  const cancel = useCallback(() => {
    generation.current += 1;
    announcement.current?.remove();
    announcement.current = null;
    voiceRef.current.cancelListening();
    if (narration.current) { narration.current = false; void Speech.stop().catch(() => {}); }
  }, []);
  useEffect(() => {
    active.current = enabled && focused;
    if (!active.current) return;
    return () => { active.current = false; cancel(); };
  }, [enabled, focused, cancel]);
  const say = useCallback(async (text: string, after?: () => void) => {
    if (!active.current) return;
    cancel();
    const run = generation.current;
    narration.current = true;
    const done = () => {
      if (!active.current || generation.current !== run || !narration.current) return;
      announcement.current?.remove();
      announcement.current = null;
      narration.current = false;
      after?.();
    };
    try {
      const screenReader = await AccessibilityInfo.isScreenReaderEnabled();
      if (!active.current || generation.current !== run) return;
      if (screenReader && Platform.OS === 'ios') {
        announcement.current = AccessibilityInfo.addEventListener('announcementFinished', event => {
          if (event.announcement !== text || generation.current !== run) return;
          if (event.success) done();
          else { announcement.current?.remove(); announcement.current = null; narration.current = false; }
        });
        AccessibilityInfo.announceForAccessibility(text);
      } else {
        await Speech.stop();
        if (!active.current || generation.current !== run) return;
        const stopped = () => { if (generation.current === run) narration.current = false; };
        Speech.speak(text, { language: language.startsWith('id') ? 'id-ID' : 'en-US', onDone: done, onStopped: stopped, onError: stopped });
      }
    } catch { if (generation.current === run) narration.current = false; }
  }, [cancel, language]);
  const listen = useCallback(async () => {
    if (!active.current) return;
    const run = generation.current;
    await voiceRef.current.startListening();
    if (!active.current || generation.current !== run) voiceRef.current.cancelListening();
  }, []);
  return { say, listen, cancel, focused };
}
