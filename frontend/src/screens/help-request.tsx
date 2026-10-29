import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import IconUsers from '@tabler/icons-react-native/IconUsers';
import { AppText, Enter } from '@/components/ui';
import { CloseButton } from '@/components/native-controls';
import { useArmed } from '@/components/use-armed';
import { useAccess } from '@/features/access/use-access';
import { useGuestSession } from '@/features/profile/session';
import { useBuddy } from '@/features/buddy/use-buddy';
import { useBuddyActions } from '@/features/buddy/use-buddy-actions';
import { buddyRequest } from '@/features/buddy/api';
import { relationLabel } from '@/features/buddy/copy';
import { useHaptics } from '@/features/feedback/haptics';
import { formatDistance } from '@/features/navigation/distance';
import { ActionRow, largeType, regularType } from '@/screens/emergency-layout';
import { colors, gutter, radius, sky } from '@/theme';

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

export function HelpRequestScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token, user } = useGuestSession();
  const state = useBuddy(token, user?.id);
  const a = useBuddyActions({ token: token ?? '', userId: user?.id ?? '', state, manageBackground: false });
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const haptics = useHaptics();
  const [now, setNow] = useState(Date.now);
  const refresh = state.refresh;
  useEffect(() => { if (id) void refresh(id); }, [id, refresh]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const session = a.session?.id === id ? a.session : null;
  const attempt = session?.status === 'WAITING' && a.attempt && Date.parse(a.attempt.expiresAt) > now ? a.attempt : null;
  const friend = !session?.nearby;
  const name = session?.requesterName ?? a.c('name');
  const alerted = useRef(new Set<string>());
  const window = useRef<{ id: string; start: number } | null>(null);
  useEffect(() => {
    if (!attempt) return;
    if (window.current?.id !== attempt.id) window.current = { id: attempt.id, start: Date.now() };
    if (alerted.current.has(attempt.id)) return;
    alerted.current.add(attempt.id);
    haptics.alert(friend ? 'awas' : 'siaga');
  }, [attempt, friend, haptics]);
  const expires = attempt ? Date.parse(attempt.expiresAt) : now;
  const seconds = Math.max(0, Math.ceil((expires - now) / 1000));
  const total = Math.max(1, expires - (window.current?.id === attempt?.id ? window.current?.start ?? now : now));
  const fill = Math.min(100, Math.max(0, (expires - now) / total * 100));
  const palette = sky[attempt ? friend ? 'awas' : 'siaga' : 'normal'];
  const contact = state.incomingContacts.find(item => item.userId === session?.requesterUserId);
  const detail = [...(session?.supportNeeds ?? []).map(a.support), friend ? relationLabel(contact?.relation, a.c) : a.c(attempt?.source === 'BLE' ? 'bluetoothSystemLine' : 'gpsSystemLine', { name })].filter(Boolean).join(' · ');
  // The shared error is cleared by the next background refresh, so a refused answer is kept here until the next try.
  const [refused, setRefused] = useState(false);
  const armed = useArmed();
  const accept = async () => { if (!attempt || !armed) return; setRefused(false); if (await a.transition('accept', { attemptId: attempt.id, sharingConsent: true })) router.replace({ pathname: '/buddy', params: { requestId: id } }); else setRefused(true); };
  const decline = async () => { if (!attempt || !armed) return; setRefused(false); if (await a.transition('decline', { attemptId: attempt.id })) router.back(); else setRefused(true); };
  const back = () => { haptics.tap(); router.back(); };
  const access = useAccess();
  const type = access.voiceHome ? largeType : regularType;
  const { stops, ink } = palette;
  // Before answering, the helper gets a rounded distance from their own position; the requester's position stays on the server.
  const [distance, setDistance] = useState<{ attemptId: string; meters: number } | null>(null);
  const attemptId = attempt?.id;
  useEffect(() => {
    if (!attemptId || !token || !id) return;
    let cancelled = false;
    void (async () => {
      if (!(await Location.getForegroundPermissionsAsync()).granted) return;
      const here = await Location.getLastKnownPositionAsync({ maxAge: 120000 }) ?? await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { approxDistanceM } = await buddyRequest<{ approxDistanceM: number | null }>(token, `/requests/${id}/distance`, 'POST', { latitude: here.coords.latitude, longitude: here.coords.longitude });
      if (!cancelled && approxDistanceM != null) setDistance({ attemptId, meters: approxDistanceM });
    })().catch(() => {});
    return () => { cancelled = true; };
  }, [attemptId, token, id]);
  const [pending, setPending] = useState<'accept' | 'decline' | null>(null);
  const busy = (kind: 'accept' | 'decline') => state.busy && pending === kind;
  const title = t(friend ? 'helpRequestTitle' : 'helpRequestTitleNearby', { name });
  const away = distance && distance.attemptId === attempt?.id ? t('helpRequestDistance', { distance: formatDistance(distance.meters, i18n.language) }) : null;
  const gradient = [stops[0], stops[0], stops[1], stops[2], stops[2]] as [string, string, ...string[]];
  // Same language as a warning: the level sky, ink type at 4.5:1 or more, one filled next step and one outlined fallback.
  return <View style={styles.fill}>
    <LinearGradient pointerEvents="none" colors={gradient} locations={[0, 0.62, 0.78, 0.92, 1]} style={StyleSheet.absoluteFill} />
    <ScrollView accessibilityViewIsModal contentInsetAdjustmentBehavior="never" contentContainerStyle={[styles.content, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16 }]}>
      {state.loading ? <ActivityIndicator color={ink} accessibilityLabel={a.c('checking')} /> : attempt ? <>
        <View style={styles.top}>
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.initial}><AppText style={[styles.initialText, { color: ink }]}>{name.trim().charAt(0).toLocaleUpperCase()}</AppText></View>
          <CloseButton label={t('helpRequestLater')} color={ink} onPress={back} />
        </View>
        <Enter index={0} style={styles.message}>
          <AppText accessibilityRole="header" style={[type.headline, { color: ink }]}>{title}</AppText>
          {!!away && <AppText style={[type.guidance, { color: ink }]}>{away}</AppText>}
          {!!detail && <AppText style={[type.meta, { color: ink }]}>{detail}</AppText>}
        </Enter>
        {!!session?.message && <Enter index={1} style={styles.quote}><AppText style={{ color: ink }}>“{session.message}”</AppText></Enter>}
        <Enter index={2} style={styles.countdown}>
          <AppText accessibilityRole="timer" accessibilityLiveRegion="none" accessibilityLabel={t('helpRequestCountdown', { time: clock(Math.ceil(seconds / 15) * 15) })} style={[type.label, { color: ink, fontVariant: ['tabular-nums'] }]}>{t('helpRequestCountdown', { time: clock(seconds) })}</AppText>
          <View style={styles.track}><View style={[StyleSheet.absoluteFill, { backgroundColor: ink, opacity: 0.2 }]} /><View style={[styles.bar, { width: `${fill}%`, backgroundColor: ink }]} /></View>
        </Enter>
        <View style={styles.fill} />
        {(a.issue || refused) && <AppText accessibilityRole="alert" style={[type.meta, { color: ink }]}>{a.issue ?? t('helpRequestRefused')}</AppText>}
        <View style={styles.actions}>
          <ActionRow filled ink={ink} type={type} icon={<IconUsers size={26} strokeWidth={2.25} color={colors.surface} />} label={t('helpRequestAccept', { name })} detail={t('helpRequestConsent', { name })} busy={busy('accept')}
            onPress={() => { haptics.tap(); setPending('accept'); void accept(); }} />
          <ActionRow ink={ink} type={type} label={t('helpRequestDecline')} busy={busy('decline')}
            onPress={() => { if (!armed) return; haptics.tap(); setPending('decline'); if (friend) a.confirm(a.c('declineTitle', { name }), () => { void decline(); }, a.c('declineBody', { name })); else void decline(); }} />
        </View>
      </> : !session && state.error ? <>
        <View style={styles.fill} />
        <AppText accessibilityRole="alert" style={[type.guidance, { color: ink }]}>{a.issue ?? t('helpRequestRefused')}</AppText>
        <View style={styles.fill} />
        <View style={styles.actions}>
          <ActionRow filled ink={ink} type={type} label={t('tryAgain')} onPress={() => { void refresh(id); }} />
          <ActionRow ink={ink} type={type} label={t('helpRequestClose')} onPress={back} />
        </View>
      </> : <>
        <View style={styles.fill} />
        <View style={styles.message}>
          <AppText accessibilityRole="header" style={[type.headline, { color: ink }]}>{t('helpRequestEnded')}</AppText>
          <AppText style={[type.guidance, { color: ink }]}>{t(session && friend ? 'helpRequestEndedBody' : 'helpRequestEndedBodyNearby', { name })}</AppText>
        </View>
        <View style={styles.fill} />
        <ActionRow ink={ink} type={type} label={t('helpRequestClose')} onPress={back} />
      </>}
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: gutter, gap: 28, maxWidth: 680, width: '100%', alignSelf: 'center' },
  top: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  initial: { width: 56, height: 56, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.5)', alignItems: 'center', justifyContent: 'center' },
  initialText: { fontSize: 24, lineHeight: 30, fontWeight: '600' },
  message: { gap: 12 },
  quote: { backgroundColor: 'rgba(255,255,255,0.55)', borderRadius: radius.md, borderCurve: 'continuous', padding: 16 },
  countdown: { gap: 10 },
  track: { height: 6, width: '100%', borderRadius: radius.pill, overflow: 'hidden' },
  bar: { height: 6, borderRadius: radius.pill },
  actions: { gap: 12 },
});
