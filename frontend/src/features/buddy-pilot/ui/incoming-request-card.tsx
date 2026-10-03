import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ActionButton, AppText, CheckOption } from '@/components/ui';
import { colors } from '@/theme';
import { relativeTime } from '@/features/hazards/time';
import type { BuddyActions } from '../use-buddy-actions';
import { buddyStyles, Card, PersonAvatar, StatusChip } from './parts';

// The helper's offer: same consent gate and transitions as before, laid out like the mockup's request card.
export function IncomingRequestCard({ a }: { a: BuddyActions }) {
  const { session, attempt, state, c, support, consent, setConsent, transition } = a;
  const { t } = useTranslation();
  if (!session || !attempt) return null;
  const time = relativeTime(session.createdAt ?? new Date().toISOString());
  return <Card tint="caution">
    <View style={[buddyStyles.row, { justifyContent: 'space-between' }]}>
      <StatusChip dot tone={session.nearby ? 'caution' : 'critical'} label={session.nearby ? c('nearbyEmergency') : c('needsHelpChip')} />
      <AppText variant="small" style={{ color: colors.muted }}>{session.nearby ? c('foundViaGps') : t(time.key, { count: time.count })}</AppText>
    </View>
    <View style={buddyStyles.row}>
      <PersonAvatar name={session.requesterName} size={44} />
      <View style={[buddyStyles.grow, { gap: 6 }]}>
        <AppText variant="section">{session.requesterName ?? c('name')}</AppText>
        {session.supportNeeds.length > 0 && <View style={[buddyStyles.row, { gap: 6, flexWrap: 'wrap' }]}>{session.supportNeeds.map(need => <StatusChip key={need} label={support(need)} />)}</View>}
      </View>
    </View>
    {!!session.message && <View style={buddyStyles.quote}><AppText selectable>“{session.message}”</AppText></View>}
    <CheckOption label={c('consent')} checked={consent} onToggle={setConsent} />
    <View style={buddyStyles.actions}>
      <View style={buddyStyles.grow}><ActionButton compact variant="secondary" label={session.nearby ? c('skip') : c('decline')} loading={state.busy} onPress={() => { void transition('decline', { attemptId: attempt.id }); }} /></View>
      <View style={buddyStyles.grow}><ActionButton compact label={session.nearby ? c('helpThisPerson') : c('accept')} disabled={!consent} loading={state.busy} onPress={() => { void transition('accept', { attemptId: attempt.id, sharingConsent: true }); }} /></View>
    </View>
  </Card>;
}
