import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { useTranslation } from 'react-i18next';
import * as Speech from 'expo-speech';
import { useIsFocused } from 'expo-router';

export async function speak(text: string, language: string): Promise<void> {
  if (await AccessibilityInfo.isScreenReaderEnabled()) AccessibilityInfo.announceForAccessibility(text);
  else { await Speech.stop(); Speech.speak(text, { language: language === 'id' ? 'id-ID' : 'en-US' }); }
}

export function stopSpeaking(): void {
  void Speech.stop().catch(() => {});
}

export function useReadAloud(text: string, options: { auto: boolean }): { speaking: boolean; toggle: () => void } {
  const { i18n } = useTranslation();
  const focused = useIsFocused();
  const [speaking, setSpeaking] = useState(false);
  const active = useRef(false);
  const generation = useRef(0);
  const autoRead = useRef(false);
  const toggle = useCallback(() => {
    const run = ++generation.current;
    if (active.current) { active.current = false; setSpeaking(false); stopSpeaking(); return; }
    active.current = true;
    const finish = () => { if (generation.current === run) { active.current = false; setSpeaking(false); } };
    void (async () => {
      const screenReader = await AccessibilityInfo.isScreenReaderEnabled();
      if (generation.current !== run) return;
      if (screenReader) { AccessibilityInfo.announceForAccessibility(text); finish(); return; }
      await Speech.stop();
      if (generation.current !== run) return;
      setSpeaking(true);
      Speech.speak(text, { language: i18n.language === 'id' ? 'id-ID' : 'en-US', onDone: finish, onStopped: finish, onError: finish });
    })().catch(finish);
  }, [text, i18n.language]);
  useEffect(() => {
    if (focused && options.auto && !autoRead.current) { autoRead.current = true; toggle(); }
  }, [focused, options.auto, toggle]);
  useEffect(() => {
    if (!focused) { generation.current += 1; active.current = false; setSpeaking(false); stopSpeaking(); }
  }, [focused]);
  useEffect(() => () => { generation.current += 1; active.current = false; stopSpeaking(); }, []);
  return { speaking, toggle };
}
