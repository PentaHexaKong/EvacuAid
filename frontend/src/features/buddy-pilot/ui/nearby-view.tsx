import { StyleSheet, Switch, View } from 'react-native';
import { ActionButton, AppText, Field } from '@/components/ui';
import { colors, corner, radius } from '@/theme';
import radarArt from '../../../../assets/brand/buddy/radar.png';
import type { BuddyActions } from '../use-buddy-actions';
import { buddyStyles, Card, EmptyCard } from './parts';
import { IncomingRequestCard } from './incoming-request-card';

const SWITCH_CENTER = { alignSelf: 'center' } as const;

export function NearbyView({ a, onSimulate }: { a: BuddyActions; onSimulate?: () => void }) {
  const { state, c, native, catchNative, enrollment, setEnrollment, attempt, session } = a;
  const offer = attempt && session?.nearby;
  return <View style={{ gap: 16 }}>
    <Card>
      <View style={buddyStyles.row}>
        <AppText variant="section" style={buddyStyles.grow}>{c('available')}</AppText>
        <Switch style={SWITCH_CENTER} accessibilityLabel={c('available')} value={state.availability?.optedIn ?? false} disabled={state.busy} trackColor={{ true: colors.primary }} onValueChange={optedIn => catchNative(async () => { const position = optedIn ? await native.obtainLocation() : {}; await state.run('/availability', { optedIn, ...position }, 'PUT'); })} />
      </View>
      <AppText variant="small" style={{ color: colors.muted }}>{c('availabilityExplanation')}</AppText>
      {state.availability?.enrolled
        ? <AppText variant="small" style={{ color: colors.primary, fontWeight: '600' }}>{c('enrolled')}</AppText>
        : <View style={{ gap: 10 }}>
          <View style={styles.divider} />
          <View style={{ gap: 6 }}>
            <Field accessibilityLabel={c('pilotCode')} placeholder={c('pilotCode')} value={enrollment} onChangeText={setEnrollment} secureTextEntry />
            <AppText variant="small" style={{ color: colors.muted }}>{c('enrollmentInfo')}</AppText>
          </View>
          <ActionButton compact variant="secondary" label={c('enroll')} disabled={!enrollment.trim()} loading={state.busy} onPress={() => { void state.run('/enrollment', { code: enrollment }).then(result => { if (result) setEnrollment(''); }); }} />
        </View>}
    </Card>

    {offer ? <IncomingRequestCard a={a} /> : <EmptyCard title={c('noNearbyTitle')} body={state.availability?.optedIn ? c('noNearbyBody') : c('noNearbyOffBody', { label: c('available') })} art={radarArt} />}

    {onSimulate && <View style={styles.prototype}>
      <AppText variant="eyebrow" style={{ color: colors.muted }}>{c('prototype')}</AppText>
      <AppText variant="small" style={{ color: colors.muted }}>{c('simulateBody')}</AppText>
      <ActionButton compact variant="secondary" label={c('simulate')} loading={state.busy} onPress={onSimulate} />
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  divider: { height: StyleSheet.hairlineWidth, marginBottom: 4, backgroundColor: colors.borderStrong },
  prototype: { gap: 8, padding: 16, ...corner(radius.lg), borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.borderStrong },
});
