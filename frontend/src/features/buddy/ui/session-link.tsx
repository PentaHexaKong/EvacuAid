import { useContext, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import IconLink from '@tabler/icons-react-native/IconLink';
import IconMapPinCheck from '@tabler/icons-react-native/IconMapPinCheck';
import IconShieldCheck from '@tabler/icons-react-native/IconShieldCheck';
import { ActionButton, AppText } from '@/components/ui';
import { colors, corner, radius, SystemReduceMotionContext } from '@/theme';
import { duration } from '@/theme/motion';
import { terminalStatuses } from '../api';
import { devWalking, isSimulatedHelper, startDevHelper, startDevWalk, useDevWalk } from '../dev-walk';
import { formatDistance } from '../navigation';
import type { BuddyActions } from '../use-buddy-actions';
import { buddyStyles, Card, PersonAvatar, StatusChip } from './parts';

const STEPS = ['stepOnTheWay', 'stepArrived', 'stepToGathering', 'stepAtGathering'] as const;
const stepIndex = (status: string) => status === 'ARRIVED' ? 1 : status === 'EVACUATING' ? 2 : status === 'COMPLETION_PENDING' || status === 'COMPLETED' ? 3 : 0;

// Who is linked, which way the help runs, and how far the session has come: readable at a glance and as one VoiceOver line.
export function LinkStatus({ a }: { a: BuddyActions }) {
  const { c, session, requester, partner, active } = a;
  const reduceMotion = useContext(SystemReduceMotionContext);
  if (!session?.helperUserId) return null;
  const name = partner ?? c('name');
  const step = stepIndex(session.status);
  const relation = requester ? c('linkHelpingYou') : c('linkYouHelp');
  const progress = c('stepOf', { n: String(step + 1), label: c(STEPS[step]) });
  return <View accessible accessibilityLabel={`${name}. ${relation}. ${progress}`} style={{ gap: 12 }}>
    <View style={buddyStyles.row}>
      <View>
        <PersonAvatar name={name} size={44} />
        <View style={styles.badge}><IconLink size={12} color={colors.surface} strokeWidth={2.5} /></View>
      </View>
      <View style={[buddyStyles.grow, { gap: 1 }]}>
        <AppText variant="section" numberOfLines={1}>{name}</AppText>
        <AppText variant="small" numberOfLines={1} style={{ color: colors.primary, fontWeight: '600' }}>{relation}</AppText>
      </View>
      {active && <StatusChip dot tone="info" label={c('live')} />}
    </View>
    <View style={styles.track}>
      {STEPS.map((key, index) => <View key={key} style={[styles.segment, index <= step && styles.segmentDone]} />)}
    </View>
    <Animated.View key={step} entering={reduceMotion ? undefined : FadeIn.duration(duration.state)}>
      <AppText variant="small" style={{ color: colors.muted }}>{progress}</AppText>
    </Animated.View>
  </View>;
}

// Both people are at the gathering point: only the person who was helped can say they are safe.
export function ArrivalCard({ a }: { a: BuddyActions }) {
  const { c, session, requester, partner, state, confirm, transition } = a;
  if (session?.status !== 'COMPLETION_PENDING') return null;
  const name = (partner ?? c('name')).split(' ')[0];
  return <Card tint="info">
    <View style={buddyStyles.row}>
      <View style={styles.mark}><IconMapPinCheck size={22} color={colors.primary} /></View>
      <AppText variant="section" accessibilityRole="header" style={buddyStyles.grow}>{c('arrivedTitle')}</AppText>
    </View>
    {requester
      ? <>
        <AppText>{c('arrivedBody', { name })}</AppText>
        <ActionButton label={c('confirmSafe')} icon={<IconShieldCheck size={20} color={colors.surface} />} loading={state.busy} onPress={() => confirm(c('confirmSafe'), () => { void transition('confirm-complete'); }, c('confirmSafeBody'))} />
      </>
      : <View style={buddyStyles.row}>
        <ActivityIndicator color={colors.primary} />
        <AppText accessibilityLiveRegion="polite" style={buddyStyles.grow}>{c('waitingSafe', { name })}</AppText>
      </View>}
  </Card>;
}

export function SafeCard({ a }: { a: BuddyActions }) {
  const { c, session, requester, partner } = a;
  if (session?.status !== 'COMPLETED') return null;
  const name = (partner ?? c('name')).split(' ')[0];
  return <View accessible style={{ gap: 12 }}>
    <View style={[styles.mark, styles.markLarge]}><IconShieldCheck size={30} color={colors.primary} /></View>
    <AppText variant="title" accessibilityRole="header">{requester ? c('safeTitleSelf') : c('safeTitleOther', { name })}</AppText>
    <AppText style={{ color: colors.muted }}>{c('safeBody')}</AppText>
  </View>;
}

// Development builds only: walks a demo to a safe house about 300 m away, so the session can end without anyone walking.
// With a simulated Buddy (HelperPrototype) it also walks the Buddy over first, then walks on by itself once the requester confirms meeting.
export function SessionPrototype({ a, token }: { a: BuddyActions; token: string }) {
  const { c, session, requester, partner, active, state, language, setLocalError, native } = a;
  const walk = useDevWalk(session?.id);
  const sessionId = session?.id;
  const autoWalk = __DEV__ && requester && isSimulatedHelper(sessionId) && session?.status === 'ARRIVED' && session.meetingConfirmed;
  useEffect(() => {
    if (!autoWalk || !sessionId || devWalking()) return;
    startDevWalk(token, sessionId, () => { void state.refresh(sessionId); }, native.location).catch((cause: unknown) => setLocalError(cause instanceof Error ? cause.message : c('simulateWalk')));
  }, [autoWalk, sessionId, token, state, native.location, setLocalError, c]);
  if (!__DEV__ || !active || !session?.helperUserId) return null;
  const pending = session.status === 'COMPLETION_PENDING';
  // The requester confirms meeting and safety on their own screen; only the helper needs a stand-in for the other phone.
  if (requester && (pending || (session.status === 'ARRIVED' && !session.meetingConfirmed))) return null;
  const name = (partner ?? c('name')).split(' ')[0];
  const walking = Boolean(walk && walk.progress < 1);
  const lang = language.startsWith('id') ? 'id' : 'en';
  const progress = walk && { name, done: formatDistance(walk.progress * walk.distanceM, lang), total: formatDistance(walk.distanceM, lang) };
  return <View style={styles.prototype}>
    <AppText variant="eyebrow" style={{ color: colors.muted }}>{c('prototype')}</AppText>
    {walking && progress
      ? <AppText variant="small" accessibilityLiveRegion="polite" style={{ color: colors.ink, fontVariant: ['tabular-nums'] }}>{c(walk?.leg === 'APPROACH' ? 'walkingToYou' : 'walkingTogether', progress)}</AppText>
      : <AppText variant="small" style={{ color: colors.muted }}>{pending ? c('simulateSafeBody', { name }) : c('simulateWalkBody', { name })}</AppText>}
    {pending
      ? <ActionButton compact variant="secondary" label={c('simulateSafe', { name })} loading={state.busy} onPress={() => { void state.run(`/dev/requests/${session.id}/simulate-safe`); }} />
      : !(walking && walk?.leg === 'APPROACH') && <ActionButton compact variant="secondary" label={c('simulateWalk')} loading={walking} onPress={() => { startDevWalk(token, session.id, () => { void state.refresh(session.id); }, native.location).catch((cause: unknown) => setLocalError(cause instanceof Error ? cause.message : c('simulateWalk'))); }} />}
  </View>;
}

// Development builds only, for the person who needs help: a simulated Buddy accepts and walks over, so the requester's side can be tried on one phone.
export function HelperPrototype({ a, token }: { a: BuddyActions; token: string }) {
  const { c, session, state, native, catchNative } = a;
  const [starting, setStarting] = useState(false);
  if (!__DEV__ || (session && !terminalStatuses.has(session.status))) return null;
  return <View style={styles.prototype}>
    <AppText variant="eyebrow" style={{ color: colors.muted }}>{c('prototype')}</AppText>
    <AppText variant="small" style={{ color: colors.muted }}>{c('simulateHelperBody')}</AppText>
    <ActionButton compact variant="secondary" label={c('simulateHelper')} loading={starting} onPress={() => catchNative(async () => {
      setStarting(true);
      try {
        if (session) state.dismissSession();
        const here = native.location ?? await native.obtainLocation();
        await startDevHelper(token, here, id => { setStarting(false); void state.refresh(id); });
      } finally { setStarting(false); }
    })} />
  </View>;
}

const styles = StyleSheet.create({
  badge: { position: 'absolute', right: -3, bottom: -3, width: 20, height: 20, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.primary, borderWidth: 2, borderColor: colors.canvas },
  track: { flexDirection: 'row', gap: 4 },
  segment: { flex: 1, height: 6, borderRadius: radius.pill, backgroundColor: colors.border },
  segmentDone: { backgroundColor: colors.primary },
  mark: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', ...corner(radius.sm), backgroundColor: colors.surface },
  markLarge: { width: 56, height: 56, ...corner(radius.md), backgroundColor: colors.accentSoft },
  prototype: { gap: 8, padding: 16, ...corner(radius.lg), borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.borderStrong },
});
