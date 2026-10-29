import { useArmed } from '@/components/use-armed';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Alert, Platform, StyleSheet, View, findNodeHandle } from 'react-native';
import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';
import * as Speech from 'expo-speech';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import IconWalk from '@tabler/icons-react-native/IconWalk';
import IconMicrophone from '@tabler/icons-react-native/IconMicrophone';
import IconUsers from '@tabler/icons-react-native/IconUsers';
import IconCircleCheck from '@tabler/icons-react-native/IconCircleCheck';
import IconRoute from '@tabler/icons-react-native/IconRoute';
import IconLifebuoy from '@tabler/icons-react-native/IconLifebuoy';
import IconWheelchair from '@tabler/icons-react-native/IconWheelchair';
import IconAccessible from '@tabler/icons-react-native/IconAccessible';
import IconDeviceMobileVibration from '@tabler/icons-react-native/IconDeviceMobileVibration';
import { ActionButton, AppText } from '@/components/ui';
import { EmergencyLayout, type LayoutAction } from '@/screens/emergency-layout';
import { GUIDANCE } from '@/screens/overview';
import { levelLabels, mapAlert } from '@/features/alerts/alerts';
import { applyResponse, findAlert, useAlerts } from '@/features/alerts/use-alerts';
import { respondToAlert, type AlertItem } from '@/features/alerts/api';
import { markAlertPresented } from '@/features/alerts/alert-gate';
import { emergencyActions, type EmergencyAction } from '@/features/alerts/emergency-actions';
import { emergencyCommand } from '@/features/voice/emergency-command';
import { useAccess } from '@/features/access/use-access';
import { useProfile } from '@/features/profile/context';
import { useGuestSession } from '@/features/profile/session';
import { usePrimaryBuddy } from '@/features/buddy/use-primary-buddy';
import { useIncomingContacts } from '@/features/buddy/use-incoming-contacts';
import { incomingNamesSummary } from '@/features/buddy/incoming-contacts';
import { useBuddySpeech } from '@/features/buddy/native';
import { useHaptics } from '@/features/feedback/haptics';
import { askAlwaysAndStart } from '@/features/location/alert-area';
import { useEvacuationRoute } from '@/features/navigation/use-evacuation-route';
import { formatDistance } from '@/features/navigation/distance';
import type { ApiError } from '@/features/profile/api';
import { colors, gutter, sky } from '@/theme';

// The setup names for each support need, so the warning can say whose profile shaped it.
const NEED_NAMES: Record<string, string> = { VISUAL_IMPAIRMENT: 'needVisual', HEARING_IMPAIRMENT: 'needHearing', MOBILITY_LIMITATION: 'needMobility', ELDERLY: 'needElderly' };
const alerted = new Set<string>();
// Warning steps reworded for people who move with a wheelchair, walker or cane, and for people who cannot hear sirens or announcements.
const MOBILITY_STEPS = new Set(['alertStepWaspada1_mobility', 'alertStepSiaga1_mobility', 'alertStepSiaga2_mobility', 'alertStepAwas1_mobility', 'alertStepAwas3_mobility']);
const HEARING_STEPS = new Set(['alertStepAwas3_hearing']);
// Joins spoken parts into sentences without doubling the full stop some of them already end with.
const sentences = (parts: (string | null | undefined)[]) => parts.filter(Boolean).map(part => part!.trim().replace(/[.。]+$/, '')).join('. ') + '.';
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
  const haptics = useHaptics();
  // The gathering point the warning sends people to; a closed one is never offered.
  const shelter = useEvacuationRoute().shelters?.find(item => item.status !== 'CLOSED');
  const distance = shelter ? formatDistance(shelter.distanceM, i18n.language) : '';
  const insets = useSafeAreaInsets();
  const { stops, ink } = sky[alert?.level ?? 'normal'];
  const [checked, setChecked] = useState<string | null>(null);
  // The reload never throws; a failed one leaves the feed stale or in error, which is not proof the warning ended.
  const unconfirmed = alerts.stale || alerts.status === 'error';
  const opened = useRef<string | null>(null);
  const active = useRef(false);
  const narration = useRef(false);
  const [reading, setReading] = useState(false);
  const narrate = (on: boolean) => { narration.current = on; setReading(on); };
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
    if (narration.current) { narrate(false); void Speech.stop().catch(() => {}); }
  };
  const startListening = async () => {
    if (!active.current) return;
    await voiceRef.current?.startListening();
    if (!active.current) voiceRef.current?.cancelListening();
  };
  const say = async (text: string, listenAfter: boolean) => {
    const run = ++speechRun.current;
    narrate(true);
    const done = () => {
      announcement.current?.remove();
      announcement.current = null;
      if (run !== speechRun.current || !active.current) return;
      narrate(false);
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
        Speech.speak(text, { language: i18n.language === 'id' ? 'id-ID' : 'en-US', onDone: done, onError: () => { narrate(false); } });
      }
    } catch { narrate(false); }
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
    // Counted as answered at once: the screen changes before the server replies, and the gate must not offer a lesser warning in between.
    applyResponse(id, response);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try { const result = await respondToAlert(token, id, response); applyResponse(id, result.myResponse); return; }
      catch (cause) {
        if ((cause as ApiError).status === 404) { await alerts.reload(); return; }
      }
    }
  };
  const dismiss = () => { if (router.canGoBack()) router.back(); else router.replace('/'); };
  const close = () => { markAlertPresented(id); active.current = false; cancelVoice(); dismiss(); };
  const armed = useArmed();
  const run = (action: EmergencyAction['id'], spoken = false) => {
    // Touch is held back for a moment after the pop-up appears; a spoken answer is deliberate and is not.
    if (!active.current || !alert || (!armed && !spoken)) return;
    haptics.tap();
    markAlertPresented(id);
    active.current = false;
    cancelVoice();
    if (action !== 'checkPeople') void post(action === 'safe' ? 'SAFE' : action === 'evacuate' ? 'EVACUATING' : 'NEEDS_HELP');
    // Only the primary button shows the location-sharing line, so only it carries consent; the plain link still confirms on the Buddy page.
    if (action === 'buddy' || action === 'needHelp') router.replace({ pathname: '/buddy', params: { help: String(Date.now()), ...(action === 'buddy' ? { consented: '1' } : {}) } });
    else if (action === 'checkPeople') router.replace('/buddy');
    else if (action === 'evacuate' && !access.voiceHome) router.replace({ pathname: '/discover', params: { route: String(Date.now()), alertId: id } });
    else if (action === 'evacuate') router.replace({ pathname: '/evacuate', params: { alertId: id } });
    else {
      dismiss();
      if (action === 'safe') void always();
    }
  };
  // Level, hazard, area, what to do, where to go, then how to answer: the same order the blind-mode screen is drawn in.
  // Says what each word does and where "go" leads; a blind user cannot look up which word runs which button.
  const prompt = () => t('emergencyVoicePrompt', { place: shelter?.name ?? t('emergencyVoicePlace') });
  const summary = () => alert ? sentences([t(levelLabels[alert.level]), t(alert.title), alert.area, t(GUIDANCE[alert.level]),
    ...(access.voiceHome && shelter ? [t('emergencyNearestSpoken', { name: shelter.name, distance })] : []),
    ...(access.voiceHome ? [prompt()] : [])]) : '';
  const voice = useBuddySpeech({ stopSpeechOnUnmount: false, language: i18n.language === 'id' ? 'id' : 'en', onCommand: transcript => {
    if (!active.current || !access.voiceHome || !access.listen || access.soundFree) return;
    const command = emergencyCommand(transcript);
    if (command) run(command === 'help' ? hasNeeds ? 'buddy' : 'needHelp' : command, true);
    else {
      voiceRef.current?.cancelListening();
      const retry = !retriedVoice.current;
      retriedVoice.current = true;
      void say(`${t('emergencyVoiceUnknown')} ${prompt()}`, retry);
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
    if (!access.soundFree && access.listen && (access.voiceHome || access.autoRead)) void say(summary(), access.voiceHome);
  }, [focused, id, alert, access.soundFree, access.listen, access.voiceHome, access.autoRead]);
  const labels = { buddy: buddyName ? t('emergencyAskBuddy', { name: buddyName }) : t('emergencyFindHelper'), evacuate: t('emergencyEvacuate'), safe: t('emergencySafe'), checkPeople: t('emergencyCheckPeople', { names: incomingNamesSummary(incoming) }), needHelp: t('emergencyNeedHelp') };
  const headlineParts = alert ? { level: t(levelLabels[alert.level]), hazard: t(alert.title).charAt(0).toLocaleLowerCase() + t(alert.title).slice(1) } : null;
  const focusHeadline = () => { if (focusedHeadline.current === id) return; const node = findNodeHandle(headline.current); if (node) { focusedHeadline.current = id; AccessibilityInfo.setAccessibilityFocus(node); } };
  const speaks = access.listen && !access.soundFree;
  if (alert && headlineParts) {
    const icon = (Icon: typeof IconWalk, filled: boolean) => <Icon size={26} strokeWidth={2.25} color={filled ? colors.surface : ink} />;
    // Where "go" leads, said the way each person travels: spoken guidance, a step-free route, or the map.
    const evacuate = access.voiceHome
      ? { label: shelter ? t('emergencyGuideTo', { name: shelter.name }) : t('emergencyGuideNearest'), detail: shelter ? t('emergencyGuideDetail', { distance }) : t('emergencyGuideDetailPlain'), Icon: IconWalk }
      : access.stepFree
        ? { label: shelter?.wheelchairAccessible ? t('emergencyStepFreeTo', { name: shelter.name }) : t('emergencyStepFreeNearest'), detail: shelter ? t('emergencyStepFreeDetail', { distance }) : t('emergencyStepFreeDetailPlain'), Icon: IconWheelchair }
        : { label: shelter ? t('emergencyGoTo', { name: shelter.name }) : t('emergencyEvacuate'), detail: shelter ? t('emergencyGoDetail', { distance }) : undefined, Icon: IconRoute };
    const rows: LayoutAction[] = actions.flatMap(action => {
      const filled = action.variant === 'gradient';
      const item: LayoutAction = action.id === 'evacuate'
          ? { key: action.id, label: evacuate.label, detail: evacuate.detail, icon: icon(evacuate.Icon, filled), filled, onPress: () => run(action.id) }
          : { key: action.id, label: labels[action.id], detail: action.id === 'buddy' ? buddyName ? t('emergencyShareCaption', { name: buddyName }) : t('emergencyShareCaptionNearby') : undefined, icon: icon(action.id === 'safe' ? IconCircleCheck : action.id === 'needHelp' ? IconLifebuoy : IconUsers, filled), filled, onPress: () => run(action.id) };
      // Speaking is the second way to answer, right under the one next step.
      return action.id === 'evacuate' && access.voiceHome && speaks
        ? [item, { key: 'speak', label: t(voice.listening ? 'voiceListening' : 'voiceSpeak'), detail: t('emergencyVoiceKeys'), hint: prompt(), icon: icon(IconMicrophone, voice.listening), filled: voice.listening, busy: voice.listening, onPress: toggle }]
        : [item];
    });
    const step = (key: string) => t(access.stepFree && MOBILITY_STEPS.has(`${key}_mobility`) ? `${key}_mobility` : access.soundFree && HEARING_STEPS.has(`${key}_hearing`) ? `${key}_hearing` : key);
    const profile = accessibility.map(need => NEED_NAMES[need.type]).filter(Boolean).map(key => t(key)).join(', ') || t('needStandard');
    // Haptics fire for any profile with vibration on; a deaf user is told so, because it is their cue instead of sound.
    const notes = [{ key: 'profile', icon: <IconAccessible size={20} strokeWidth={2} color={ink} />, text: t('emergencyProfile', { profile }) },
      ...(access.soundFree && haptics.vibrates ? [{ key: 'vibration', icon: <IconDeviceMobileVibration size={20} strokeWidth={2} color={ink} />, text: t('emergencyVibrates') }] : [])];
    return <View accessibilityViewIsModal onMagicTap={access.voiceHome && speaks ? toggle : undefined} style={styles.root}>
      <EmergencyLayout stops={stops} ink={ink} large={access.voiceHome} headline={t(alert.level === 'awas' ? 'homeHeadlineDanger' : 'homeHeadlineNoWindow', headlineParts)}
        headlineRef={headline} onHeadlineLayout={focusHeadline} guidance={t(GUIDANCE[alert.level])} meta={[alert.area, alert.window].filter(Boolean).join(' · ')} notes={notes}
        steps={access.voiceHome ? undefined : alert.steps.map(step)} actions={rows} insets={insets}
        readAgain={access.voiceHome && speaks ? { label: t(reading ? 'emergencyReadingAloud' : 'emergencyReadAgain'), hint: t('emergencyReadAgainHint'), onPress: () => { if (!active.current) return; haptics.tap(); cancelVoice(); void say(summary(), true); } } : undefined}
        close={{ label: t('emergencyClose'), onPress: close }} />
    </View>;
  }
  return <View accessibilityViewIsModal style={styles.root}>
    <LinearGradient pointerEvents="none" colors={[stops[0], stops[0], stops[1], stops[2], stops[2]]} locations={[0, 0.62, 0.78, 0.92, 1]} style={StyleSheet.absoluteFill} />
    <View style={[styles.content, { flex: 1, justifyContent: 'center', paddingTop: insets.top, paddingBottom: insets.bottom + 12 }]}>
      <AppText accessibilityRole="header" style={{ color: ink }}>{t(checked !== id ? 'loading' : unconfirmed ? 'alertUnavailable' : 'emergencyEnded')}</AppText>
      {checked === id && unconfirmed && <ActionButton label={t('retry')} onPress={() => { setChecked(null); void alerts.reload().then(() => setChecked(id)); }} />}
      <ActionButton variant="secondary" label={t('emergencyClose')} onPress={close} />
    </View>
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: gutter, gap: 16, maxWidth: 680, width: '100%', alignSelf: 'center' },
});
