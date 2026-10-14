import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import IconX from '@tabler/icons-react-native/IconX';
import { ActionButton, AppText, Enter, Tap } from '@/components/ui';
import { useArmed } from '@/components/use-armed';
import { useGuestSession } from '@/features/profile/session';
import { useBuddy } from '@/features/buddy/use-buddy';
import { useBuddyActions } from '@/features/buddy/use-buddy-actions';
import { relationLabel } from '@/features/buddy/copy';
import { PersonAvatar, StatusChip } from '@/features/buddy/ui/parts';
import { useHaptics } from '@/features/feedback/haptics';
import { radius, sky } from '@/theme';

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

export function HelpRequestScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token, user } = useGuestSession();
  const state = useBuddy(token, user?.id);
  const a = useBuddyActions({ token: token ?? '', userId: user?.id ?? '', state, manageBackground: false });
  const router = useRouter();
  const { t } = useTranslation();
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
  return <LinearGradient colors={palette.stops as [string, string, ...string[]]} style={styles.fill}>
    <ScrollView accessibilityViewIsModal contentContainerStyle={[styles.content, { paddingTop: insets.top, paddingBottom: insets.bottom + 12 }]}>
      {state.loading ? <ActivityIndicator accessibilityLabel={a.c('checking')} /> : attempt ? <>
        <View style={styles.top}><StatusChip dot tone={friend ? 'critical' : 'caution'} label={a.c(friend ? 'needsHelpChip' : 'nearbyEmergency')} /><Tap accessibilityLabel={t('helpRequestLater')} onPress={back} style={styles.close}><IconX size={24} color={palette.ink} /></Tap></View>
        <Enter index={0} style={styles.center}><PersonAvatar name={name} size={88} /></Enter>
        <Enter index={1}><AppText variant="title" accessibilityRole="header" style={[styles.text, { color: palette.ink }]}>{t(friend ? 'helpRequestTitle' : 'helpRequestTitleNearby', { name })}</AppText></Enter>
        <Enter index={2}><AppText style={[styles.text, { color: palette.ink, opacity: 0.85 }]}>{detail}</AppText></Enter>
        {!!session?.message && <Enter index={3} style={styles.quote}><AppText style={{ color: palette.ink }}>“{session.message}”</AppText></Enter>}
        <Enter index={4} style={{ gap: 12 }}>
          <AppText accessibilityRole="timer" accessibilityLiveRegion="none" accessibilityLabel={t('helpRequestCountdown', { time: clock(Math.ceil(seconds / 15) * 15) })} style={[styles.text, { color: palette.ink, fontVariant: ['tabular-nums'] }]}>{t('helpRequestCountdown', { time: clock(seconds) })}</AppText>
          <View style={styles.track}><View style={[StyleSheet.absoluteFill, { backgroundColor: palette.ink, opacity: 0.15 }]} /><View style={{ height: 4, width: `${fill}%`, backgroundColor: palette.ink }} /></View>
        </Enter>
        <View style={styles.fill} />
        {(a.issue || refused) && <AppText accessibilityRole="alert" style={[styles.text, { color: palette.ink }]}>{a.issue ?? t('helpRequestRefused')}</AppText>}
        <View style={{ gap: 12 }}>
          <View style={{ gap: 6 }}><ActionButton variant="gradient" label={t('helpRequestAccept', { name })} loading={state.busy} onPress={() => { haptics.tap(); void accept(); }} /><AppText variant="small" style={[styles.text, { color: palette.ink }]}>{t('helpRequestConsent', { name })}</AppText></View>
          <ActionButton variant="secondary" label={t('helpRequestDecline')} loading={state.busy} onPress={() => { if (!armed) return; haptics.tap(); if (friend) a.confirm(a.c('declineTitle', { name }), () => { void decline(); }, a.c('declineBody', { name })); else void decline(); }} />
        </View>
      </> : !session && state.error ? <>
        <View style={styles.fill} />
        <AppText accessibilityRole="alert" style={[styles.text, { color: palette.ink }]}>{a.issue ?? t('helpRequestRefused')}</AppText>
        <View style={styles.fill} />
        <ActionButton variant="gradient" label={t('tryAgain')} onPress={() => { void refresh(id); }} />
        <ActionButton variant="secondary" label={t('helpRequestClose')} onPress={back} />
      </> : <>
        <View style={styles.fill} />
        <AppText variant="title" accessibilityRole="header" style={[styles.text, { color: palette.ink }]}>{t('helpRequestEnded')}</AppText>
        <AppText style={[styles.text, { color: palette.ink }]}>{t(session && friend ? 'helpRequestEndedBody' : 'helpRequestEndedBodyNearby', { name })}</AppText>
        <View style={styles.fill} />
        <ActionButton variant="secondary" label={t('helpRequestClose')} onPress={back} />
      </>}
    </ScrollView>
  </LinearGradient>;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: 24, gap: 20 },
  top: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  close: { width: 44, height: 44 },
  center: { alignItems: 'center' },
  text: { textAlign: 'center' },
  quote: { backgroundColor: 'rgba(255,255,255,0.55)', borderRadius: radius.md, borderCurve: 'continuous', padding: 16 },
  track: { height: 4, width: '100%', borderRadius: radius.pill, overflow: 'hidden' },
});
