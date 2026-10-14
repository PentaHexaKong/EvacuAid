import { useContext, useState, type ReactNode } from 'react';
import { Animated as RNAnimated, Image, Linking, Pressable, StyleSheet, Switch, View } from 'react-native';
import Animated, { FadeIn, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import NetInfo from '@react-native-community/netinfo';
import IconBluetooth from '@tabler/icons-react-native/IconBluetooth';
import IconChevronDown from '@tabler/icons-react-native/IconChevronDown';
import IconHeartHandshake from '@tabler/icons-react-native/IconHeartHandshake';
import { ActionButton, AppText } from '@/components/ui';
import { Group, Row } from '@/components/grouped-list';
import { colors, corner, radius, SystemReduceMotionContext } from '@/theme';
import { duration, ease } from '@/theme/motion';
import radarArt from '../../../../assets/brand/buddy/radar.png';
import type { BuddyActions } from '../use-buddy-actions';
import { FriendCard } from './friend-card';
import { BeaconPeople, useBeaconStatus } from './beacon-panel';

// Rows with a leading tile start their separator at the text, so the tiles stand in their own column.
const TILE = 36;
const ROW_INSET = 16 + TILE + 12;

// Auto search for helpers: the two things they control or watch (availability, Bluetooth) as one grouped list, one line each.
// The privacy detail stays one tap away instead of greeting every visit as a paragraph.
export function NearbyView({ a, onSimulate }: { a: BuddyActions; onSimulate?: () => void }) {
  const { state, c, native, catchNative, attempt, session } = a;
  const offer = attempt && session?.nearby;
  const optedIn = state.availability?.optedIn ?? false;
  const bluetooth = useBeaconStatus(a);
  const toggle = (next: boolean) => catchNative(async () => {
    const network = await NetInfo.fetch();
    if (network.isConnected !== true || network.isInternetReachable === false) {
      if (next) { a.setLocalError(c('bluetoothAvailableOnline')); return; }
      await state.setOfflineAvailability(false); return;
    }
    const position = next ? await native.obtainLocation() : {};
    await state.run('/availability', { optedIn: next, ...position }, 'PUT');
  });
  return <View style={{ gap: 24 }}>
    <View style={{ gap: 10 }}>
      <Group inset={ROW_INSET}>
        <Row
          leading={<Tile active={optedIn}><IconHeartHandshake size={20} strokeWidth={1.75} color={optedIn ? colors.primary : colors.muted} /></Tile>}
          title={c('available')}
          detail={c(optedIn ? 'availableOnLine' : 'availableOffLine')}
          trailing={<Switch accessibilityLabel={c('available')} value={optedIn} disabled={state.busy} trackColor={{ true: colors.primary }} onValueChange={toggle} />}
        />
        <Row
          leading={<Tile active={bluetooth.scanning}><RNAnimated.View style={{ opacity: bluetooth.opacity }}><IconBluetooth size={20} strokeWidth={1.75} color={bluetooth.scanning ? colors.primary : colors.muted} /></RNAnimated.View></Tile>}
          title={<AppText variant="button" accessibilityLiveRegion="polite">{bluetooth.label}</AppText>}
          detail={c('bluetoothWhileOpen')}
          trailing={bluetooth.needsSettings ? <Pressable accessibilityRole="link" hitSlop={12} onPress={() => { void Linking.openSettings(); }}><AppText variant="button" style={{ color: colors.primary }}>{c('settingsShort')}</AppText></Pressable> : undefined}
        />
      </Group>
      <Disclosure label={c('howAutoSearch')}>
        <AppText variant="small" style={{ color: colors.muted }}>{c('nearbyAnyone')}</AppText>
        <AppText variant="small" style={{ color: colors.muted }}>{c('availabilityExplanation')}</AppText>
        <AppText variant="small" style={{ color: colors.muted }}>{c('bluetoothRange')}</AppText>
      </Disclosure>
    </View>

    <BeaconPeople a={a} />
    {offer ? <FriendCard a={a} /> : optedIn && <Quiet title={c('noNearbyTitle')} body={c('noNearbyShort')} />}

    {onSimulate && <Prototype c={c} busy={state.busy} onSimulate={onSimulate} />}
  </View>;
}

function Tile({ active, children }: { active: boolean; children: ReactNode }) {
  return <View style={[styles.tile, active && styles.tileActive]}>{children}</View>;
}

// Nothing nearby is the normal state, so it reads as calm and centred rather than as another card to parse.
function Quiet({ title, body }: { title: string; body: string }) {
  return <View accessible accessibilityLabel={`${title}. ${body}`} style={styles.quiet}>
    <Image source={radarArt} accessible={false} style={styles.radar} />
    <AppText variant="section" style={styles.centered}>{title}</AppText>
    <AppText variant="small" style={[styles.centered, { color: colors.muted, maxWidth: 260 }]}>{body}</AppText>
  </View>;
}

function Disclosure({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const reduceMotion = useContext(SystemReduceMotionContext);
  const chevron = useAnimatedStyle(() => ({ transform: [{ rotate: withTiming(open ? '180deg' : '0deg', { duration: reduceMotion ? 0 : duration.state, easing: ease.out }) }] }), [open, reduceMotion]);
  return <View style={{ gap: 10 }}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} hitSlop={8} onPress={() => setOpen(value => !value)} style={({ pressed }) => [styles.disclosure, pressed && { opacity: 0.55 }]}>
      <AppText variant="small" style={{ color: colors.primary, fontWeight: '600' }}>{label}</AppText>
      <Animated.View style={chevron}><IconChevronDown size={16} strokeWidth={2} color={colors.primary} /></Animated.View>
    </Pressable>
    {open && <Animated.View entering={reduceMotion ? undefined : FadeIn.duration(duration.state)} style={styles.disclosureBody}>{children}</Animated.View>}
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
  tile: { width: TILE, height: TILE, alignItems: 'center', justifyContent: 'center', ...corner(10), backgroundColor: colors.canvas },
  tileActive: { backgroundColor: colors.accentSoft },
  quiet: { alignItems: 'center', gap: 6, paddingVertical: 8 },
  radar: { width: 72, height: 72, marginBottom: 6 },
  centered: { textAlign: 'center' },
  disclosure: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 4, minHeight: 32, paddingHorizontal: 4 },
  disclosureBody: { gap: 8, paddingHorizontal: 4 },
  prototype: { gap: 8, padding: 16, ...corner(radius.lg), borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.borderStrong },
});
