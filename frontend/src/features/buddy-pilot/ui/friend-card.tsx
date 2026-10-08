import { useContext, type ReactNode } from 'react';
import { View } from 'react-native';
import Animated, { FadeOut, LinearTransition, withTiming } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { ActionButton, AppText } from '@/components/ui';
import { colors, SystemReduceMotionContext } from '@/theme';
import { duration, ease, spring } from '@/theme/motion';
import { relativeTime } from '@/features/hazards/time';
import { relationLabel } from '../copy';
import type { BuddyActions } from '../use-buddy-actions';
import { buddyStyles, Card, PersonAvatar, StatusChip } from './parts';

const offerEnter = () => {
  'worklet';
  return { initialValues: { opacity: 0, transform: [{ translateY: 8 }] }, animations: { opacity: withTiming(1, { duration: duration.enter, easing: ease.out }), transform: [{ translateY: withTiming(0, { duration: duration.enter, easing: ease.out }) }] } };
};

export function FriendMotion({ children }: { children: ReactNode }) {
  const reduceMotion = useContext(SystemReduceMotionContext);
  return <Animated.View entering={reduceMotion ? undefined : offerEnter} exiting={reduceMotion ? undefined : FadeOut.duration(duration.exit)} layout={reduceMotion ? undefined : LinearTransition.springify().duration(spring.ui.duration).dampingRatio(spring.ui.dampingRatio)}>{children}</Animated.View>;
}

export function FriendCard({ a }: { a: BuddyActions }) {
  const { session, attempt, state, c, support, confirm, transition } = a;
  const { t } = useTranslation();
  if (!session || !attempt) return null;
  const contact = state.incomingContacts.find(item => item.userId === session.requesterUserId);
  const name = session.requesterName ?? c('name');
  const needs = session.nearby || session.supportNeeds.length ? session.supportNeeds : contact?.needs ?? [];
  const detail = [...needs.map(support), session.nearby ? '' : relationLabel(contact?.relation, c)].filter(Boolean).join(' · ');
  const time = relativeTime(session.createdAt ?? new Date().toISOString());
  return <FriendMotion><Card tint={session.nearby ? 'caution' : 'critical'}>
    <View style={[buddyStyles.row, { justifyContent: 'space-between', flexWrap: 'wrap' }]}>
      <StatusChip dot tone={session.nearby ? 'caution' : 'critical'} label={session.nearby ? c('nearbyEmergency') : c('needsHelpChip')} />
      {session.nearby ? <StatusChip tone="info" label={c('foundViaGps')} /> : <AppText variant="small" style={{ color: colors.muted }}>{t(time.key, { count: time.count })}</AppText>}
    </View>
    <View style={buddyStyles.row}>
      <PersonAvatar name={name} size={48} />
      <View style={[buddyStyles.grow, { gap: 4 }]}><AppText variant="section">{name}</AppText>{!!detail && <AppText style={{ color: colors.muted }}>{detail}</AppText>}</View>
    </View>
    {(session.message || session.nearby) && <View style={buddyStyles.quote}><AppText selectable>{session.message ? `“${session.message}”` : c('gpsSystemLine', { name })}</AppText></View>}
    <View style={buddyStyles.actions}>
      <View style={buddyStyles.grow}><ActionButton variant="secondary" label={session.nearby ? c('skip') : c('declineShort')} loading={state.busy} onPress={() => {
        const decline = () => { void transition('decline', { attemptId: attempt.id }); };
        if (session.nearby) decline(); else confirm(c('declineTitle', { name }), decline, c('declineBody', { name }));
      }} /></View>
      <View style={buddyStyles.grow}><ActionButton label={session.nearby ? c('helpThisPerson') : c('acceptHelp')} loading={state.busy} onPress={() => confirm(c('acceptTitle', { name }), () => { void transition('accept', { attemptId: attempt.id, sharingConsent: true }); }, c('acceptBody', { name }))} /></View>
    </View>
  </Card></FriendMotion>;
}
