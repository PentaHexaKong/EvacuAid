import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Alert, Platform, ScrollView, StyleSheet, View, findNodeHandle } from 'react-native';
import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';
import * as Speech from 'expo-speech';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import IconX from '@tabler/icons-react-native/IconX';
import { ActionButton, AppText, Enter, StepList, Tap } from '@/components/ui';
import { LevelChip } from '@/components/content';
import { SpeakButton } from '@/components/speak-button';
import { GUIDANCE, Headline } from '@/screens/overview';
import { levelLabels, mapAlert } from '@/features/alerts/alerts';
import { applyResponse, findAlert, useAlerts } from '@/features/alerts/use-alerts';
import { respondToAlert, type AlertItem } from '@/features/alerts/api';
import { markAlertPresented } from '@/features/alerts/alert-gate';
import { emergencyActions, type EmergencyAction } from '@/features/alerts/emergency-actions';
import { emergencyCommand } from '@/features/voice/emergency-command';
import { useAccess } from '@/features/access/use-access';
import { useProfile } from '@/features/profile/context';
import { useGuestSession } from '@/features/profile/session';
import { usePrimaryBuddy } from '@/features/buddy-pilot/use-primary-buddy';
import { useIncomingContacts } from '@/features/buddy-pilot/use-incoming-contacts';
import { incomingNamesSummary } from '@/features/buddy-pilot/incoming-contacts';
import { useBuddySpeech } from '@/features/buddy-pilot/native';
import { useHaptics } from '@/features/feedback/haptics';
import { speak } from '@/features/feedback/speech';
import { useEvacuationRoute } from '@/features/navigation/use-evacuation-route';
import { formatDistance } from '@/features/navigation/distance';
import { askAlwaysAndStart } from '@/features/location/alert-area';
import type { ApiError } from '@/features/profile/api';
import { gutter, radius, sky } from '@/theme';

const alerted = new Set<string>();
let askingAlways = false;
export function EmergencyScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const alerts = useAlerts();
  const item = findAlert(id);
  const { t, i18n } = useTranslation();
  const alert = item ? mapAlert(item, t) : undefined;
  const router = useRouter();
  const focused = useIsFocused();
  const access = useAccess();
  const { accessibility } = useProfile();
  const { token, user } = useGuestSession();
  const hasNeeds = accessibility.length > 0;
  const buddyName = usePrimaryBuddy(token, hasNeeds);
  const incoming = useIncomingContacts(token, !hasNeeds);
  const actions = emergencyActions({ hasNeeds, voiceHome: access.voiceHome, buddyName, relyingCount: incoming.length });
  const { shelters } = useEvacuationRoute();
  const haptics = useHaptics();
  const insets = useSafeAreaInsets();
  const { stops, ink } = sky[alert?.level ?? 'normal'];
  const [checked, setChecked] = useState<string | null>(null);
  const opened = useRef<string | null>(null);
  const active = useRef(false);
  const narration = useRef(false);
  const speechRun = useRef(0);
  const retriedVoice = useRef(false);
  const headline = useRef<View>(null);
  const focusedHeadline = useRef<string | null>(null);
  const announcement = useRef<ReturnType<typeof AccessibilityInfo.addEventListener> | null>(null);
  const voiceRef = useRef<ReturnType<typeof useBuddySpeech> | null>(null);
  const cancelVoice = () => {
    speechRun.current += 1;
    announcement.current?.remove();
    announcement.current = null;
    voiceRef.current?.cancelListening();
    if (narration.current) { narration.current = false; void Speech.stop().catch(() => {}); }
  };
  const startListening = async () => {
    if (!active.current) return;
    await voiceRef.current?.startListening();
    if (!active.current) voiceRef.current?.cancelListening();
  };
  const say = async (text: string, listenAfter: boolean) => {
    const run = ++speechRun.current;
    narration.current = true;
    const done = () => {
      announcement.current?.remove();
      announcement.current = null;
      if (run !== speechRun.current || !active.current) return;
      narration.current = false;
      if (listenAfter) void startListening();
    };
    try {
      const screenReader = await AccessibilityInfo.isScreenReaderEnabled();
      if (run !== speechRun.current || !active.current) return;
      if (screenReader && Platform.OS === 'ios') {
        announcement.current = AccessibilityInfo.addEventListener('announcementFinished', event => { if (event.announcement === text) done(); });
        AccessibilityInfo.announceForAccessibility(text);
      } else {
        await Speech.stop();
        if (run !== speechRun.current || !active.current) return;
        Speech.speak(text, { language: i18n.language === 'id' ? 'id-ID' : 'en-US', onDone: done, onError: () => { narration.current = false; } });
      }
    } catch { narration.current = false; }
  };
  const always = async () => {
    if (!token || !user || askingAlways) return;
    askingAlways = true;
    try {
      if (await AsyncStorage.getItem('evacuaid.always-asked.v1')) return;
      if ((await Location.getBackgroundPermissionsAsync()).granted) return;
      await AsyncStorage.setItem('evacuaid.always-asked.v1', 'true');
      Alert.alert(t('emergencyAlwaysTitle'), t('emergencyAlwaysBody'), [{ text: t('reachNotNow'), style: 'cancel' }, { text: t('emergencyAlwaysAllow'), onPress: () => { void askAlwaysAndStart(token, user.id).catch(() => {}); } }]);
    } catch {} finally { askingAlways = false; }
  };
  const post = async (response: NonNullable<AlertItem['myResponse']>) => {
    if (!token) return;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try { const result = await respondToAlert(token, id, response); applyResponse(id, result.myResponse); return; }
      catch (cause) {
        if ((cause as ApiError).status === 404) { await alerts.reload(); return; }
      }
    }
  };
  const dismiss = () => { if (router.canGoBack()) router.back(); else router.replace('/'); };
  const close = () => { markAlertPresented(id); active.current = false; cancelVoice(); dismiss(); };
  const run = (action: EmergencyAction['id']) => {
    if (!active.current || !alert) return;
    haptics.tap();
    markAlertPresented(id);
    active.current = false;
    cancelVoice();
    if (action !== 'checkPeople') void post(action === 'safe' ? 'SAFE' : action === 'evacuate' ? 'EVACUATING' : 'NEEDS_HELP');
    if (action === 'buddy' || action === 'needHelp') router.replace({ pathname: '/buddy', params: { help: String(Date.now()) } });
    else if (action === 'checkPeople') router.replace('/buddy');
    else if (action === 'evacuate' && !access.voiceHome) router.replace({ pathname: '/discover', params: { route: String(Date.now()) } });
    else {
      if (action === 'evacuate' && access.listen && !access.soundFree) {
        const shelter = shelters?.[0];
        void speak(shelter ? `${t('homeNearest')}: ${shelter.name}, ${formatDistance(shelter.distanceM, i18n.language)}` : t('homeNearestDetail'), i18n.language).catch(() => {});
      }
      dismiss();
      if (action === 'safe') void always();
    }
  };
  const voice = useBuddySpeech({ stopSpeechOnUnmount: false, language: i18n.language === 'id' ? 'id' : 'en', onCommand: transcript => {
    if (!active.current || !access.voiceHome || !access.listen || access.soundFree) return;
    const command = emergencyCommand(transcript);
    if (command) run(command === 'help' ? hasNeeds ? 'buddy' : 'needHelp' : command);
    else {
      voiceRef.current?.cancelListening();
      const retry = !retriedVoice.current;
      retriedVoice.current = true;
      void say(t('emergencyVoiceUnknown'), retry);
    }
  } });
  voiceRef.current = voice;
  const toggle = () => {
    if (!active.current || !access.listen || access.soundFree) return;
    haptics.tap();
    if (voice.listening) voice.stopListening();
    else { cancelVoice(); void startListening(); }
  };
  useEffect(() => {
    let mounted = true;
    if (!findAlert(id)) void alerts.reload().then(() => { if (mounted) setChecked(id); });
    return () => { mounted = false; };
  }, [id, item?.id, alerts.reload]);
  useEffect(() => {
    active.current = focused;
    if (!focused) cancelVoice();
    return () => { active.current = false; cancelVoice(); };
  }, [focused]);
  useEffect(() => {
    if (!focused || !alert || opened.current === id) return;
    opened.current = id;
    retriedVoice.current = false;
    markAlertPresented(id);
    if (!alerted.has(id)) { alerted.add(id); haptics.alert(alert.level); }
    if (!access.soundFree && access.listen && (access.voiceHome || access.autoRead)) void say([t(levelLabels[alert.level]), t(alert.title), alert.area, t(GUIDANCE[alert.level]), ...(access.voiceHome ? [t('emergencyVoicePrompt')] : [])].join('. '), access.voiceHome);
  }, [focused, id, alert, access.soundFree, access.listen, access.voiceHome, access.autoRead]);
  const labels = { buddy: buddyName ? t('emergencyAskBuddy', { name: buddyName }) : t('emergencyFindHelper'), evacuate: t('emergencyEvacuate'), safe: t('emergencySafe'), checkPeople: t('emergencyCheckPeople', { names: incomingNamesSummary(incoming) }), needHelp: t('emergencyNeedHelp') };
  return <View accessibilityViewIsModal onMagicTap={access.voiceHome && access.listen && !access.soundFree ? toggle : undefined} style={styles.root}>
    <LinearGradient pointerEvents="none" colors={[stops[0], stops[0], stops[1], stops[2], stops[2]]} locations={[0, 0.62, 0.78, 0.92, 1]} style={StyleSheet.absoluteFill} />
    <ScrollView contentInsetAdjustmentBehavior="never" contentContainerStyle={[styles.scroll, { paddingTop: insets.top, paddingBottom: insets.bottom + 12 }]}>
      {alert ? <>
        <View style={styles.top}><LevelChip level={alert.level} /><Tap accessibilityLabel={t('emergencyClose')} onPress={close} style={styles.close}><IconX size={24} color={ink} /></Tap></View>
        <View style={styles.content}>
          <Enter index={0}><View ref={headline} accessible accessibilityRole="header" accessibilityLabel={t('homeHeadlineNoWindow', { level: t(levelLabels[alert.level]), hazard: t(alert.title).charAt(0).toLocaleLowerCase() + t(alert.title).slice(1) })} onLayout={() => { if (focusedHeadline.current === id) return; const node = findNodeHandle(headline.current); if (node) { focusedHeadline.current = id; AccessibilityInfo.setAccessibilityFocus(node); } }}><Headline template={t('homeHeadlineNoWindow')} parts={{ level: t(levelLabels[alert.level]), hazard: t(alert.title).charAt(0).toLocaleLowerCase() + t(alert.title).slice(1) }} ink={ink} /></View></Enter>
          <Enter index={1}><AppText variant="button" style={{ color: ink }}>{[alert.area, alert.window].filter(Boolean).join(' · ')}</AppText></Enter>
          <Enter index={2}><AppText style={{ color: ink }}>{t(GUIDANCE[alert.level])}</AppText></Enter>
          <Enter index={3}><View style={styles.steps}><StepList steps={alert.steps.map(step => t(step))} /></View></Enter>
        </View>
        <View style={styles.spacer} />
        <Enter index={4} style={styles.actions}>
          {access.voiceHome && access.listen && !access.soundFree && <SpeakButton listening={voice.listening} label={t(voice.listening ? 'voiceListening' : 'voiceSpeak')} detail={t('emergencyVoicePrompt')} hint={t('emergencyVoicePrompt')} onPress={toggle} />}
          {actions.map(action => action.variant === 'link' ? <Tap key={action.id} onPress={() => run(action.id)} style={{ minHeight: 44 }}><AppText variant="button" style={{ color: ink }}>{labels[action.id]}</AppText></Tap> : <ActionButton key={action.id} variant={action.variant} label={labels[action.id]} detail={action.id === 'buddy' ? buddyName ? t('emergencyShareCaption', { name: buddyName }) : t('emergencyShareCaptionNearby') : undefined} onPress={() => run(action.id)} />)}
        </Enter>
      </> : <View style={[styles.content, { flex: 1, justifyContent: 'center' }]}><AppText accessibilityRole="header" style={{ color: ink }}>{t(checked === id ? 'emergencyEnded' : 'loading')}</AppText><ActionButton variant="secondary" label={t('emergencyClose')} onPress={close} /></View>}
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flexGrow: 1 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 44, paddingHorizontal: gutter },
  close: { width: 44, height: 44 },
  content: { paddingHorizontal: gutter, gap: 16, maxWidth: 680, width: '100%', alignSelf: 'center' },
  steps: { backgroundColor: 'rgba(255,255,255,0.55)', borderRadius: radius.md, borderCurve: 'continuous', padding: 16 },
  spacer: { flex: 1, minHeight: 16 },
  actions: { gap: 12, paddingHorizontal: gutter, paddingTop: gutter, maxWidth: 680, width: '100%', alignSelf: 'center' },
});
