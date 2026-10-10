import { StyleSheet, Switch, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ActionButton, AppText } from '@/components/ui';
import { colors, corner, radius } from '@/theme';
import radarArt from '../../../../assets/brand/buddy/radar.png';
import type { BuddyActions } from '../use-buddy-actions';
import { buddyStyles, EmptyCard } from './parts';
import { FriendCard } from './friend-card';

const SWITCH_CENTER = { alignSelf: 'center' } as const;

export function NearbyView({ a, onSimulate }: { a: BuddyActions; onSimulate?: () => void }) {
  const { state, c, native, catchNative, attempt, session } = a;
  const router = useRouter();
  const offer = attempt && session?.nearby;
  if (!state.availability?.enrolled && !offer) return <View style={{ gap: 16 }}>
    <EmptyCard title={c('notBuddyTitle')} body={c('notBuddyBody')} art={radarArt}>
      <ActionButton variant="secondary" label={c('addBuddy')} onPress={() => router.push('/buddy-add')} />
    </EmptyCard>
    {onSimulate && <Prototype c={c} busy={state.busy} onSimulate={onSimulate} />}
  </View>;
  return <View style={{ gap: 16 }}>
    <View style={styles.availability}>
      <View style={buddyStyles.row}>
        <AppText variant="section" style={buddyStyles.grow}>{c('available')}</AppText>
        <Switch style={SWITCH_CENTER} accessibilityLabel={c('available')} value={state.availability?.optedIn ?? false} disabled={state.busy} trackColor={{ true: colors.primary }} onValueChange={optedIn => catchNative(async () => { const position = optedIn ? await native.obtainLocation() : {}; await state.run('/availability', { optedIn, ...position }, 'PUT'); })} />
      </View>
      <AppText variant="small" style={{ color: colors.muted }}>{c('availabilityExplanation')}</AppText>
    </View>

    {offer ? <FriendCard a={a} /> : <EmptyCard title={c('noNearbyTitle')} body={state.availability?.optedIn ? c('noNearbyBody') : c('noNearbyOffBody', { label: c('available') })} art={radarArt} />}

    {onSimulate && <Prototype c={c} busy={state.busy} onSimulate={onSimulate} />}
  </View>;
}

function Prototype({ c, busy, onSimulate }: { c: BuddyActions['c']; busy: boolean; onSimulate: () => void }) {
  return <View style={styles.prototype}>
    <AppText variant="eyebrow" style={{ color: colors.muted }}>{c('prototype')}</AppText>
    <AppText variant="small" style={{ color: colors.muted }}>{c('simulateBody')}</AppText>
    <ActionButton compact variant="secondary" label={c('simulate')} loading={busy} onPress={onSimulate} />
  </View>;
}

const styles = StyleSheet.create({
  availability: { gap: 14, paddingVertical: 12 },
  prototype: { gap: 8, padding: 16, ...corner(radius.lg), borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.borderStrong },
});
