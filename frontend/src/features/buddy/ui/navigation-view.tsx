import { useContext, useEffect, useState, type ComponentType } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, { withTiming } from 'react-native-reanimated';
import IconArrowBackUp from '@tabler/icons-react-native/IconArrowBackUp';
import IconArrowBearLeft from '@tabler/icons-react-native/IconArrowBearLeft';
import IconArrowBearRight from '@tabler/icons-react-native/IconArrowBearRight';
import IconArrowSharpTurnLeft from '@tabler/icons-react-native/IconArrowSharpTurnLeft';
import IconArrowSharpTurnRight from '@tabler/icons-react-native/IconArrowSharpTurnRight';
import IconArrowUp from '@tabler/icons-react-native/IconArrowUp';
import IconCornerUpLeft from '@tabler/icons-react-native/IconCornerUpLeft';
import IconCornerUpRight from '@tabler/icons-react-native/IconCornerUpRight';
import IconCurrentLocation from '@tabler/icons-react-native/IconCurrentLocation';
import IconMapPinCheck from '@tabler/icons-react-native/IconMapPinCheck';
import IconRotateClockwise from '@tabler/icons-react-native/IconRotateClockwise';
import IconStairs from '@tabler/icons-react-native/IconStairs';
import { ActionButton, AppText } from '@/components/ui';
import { colors, corner, radius, SystemReduceMotionContext } from '@/theme';
import { duration, ease } from '@/theme/motion';
import { useBuddyCopy } from '../copy';
import { formatDistance, instructionText, turnOf, turnPhrase, type Turn } from '../navigation';
import type { RouteGuidance } from '../use-route-guidance';

const ICONS: Record<Turn, ComponentType<{ size?: number; color?: string; strokeWidth?: number }>> = {
  start: IconArrowUp, straight: IconArrowUp, 'slight-right': IconArrowBearRight, right: IconCornerUpRight, 'sharp-right': IconArrowSharpTurnRight, uturn: IconArrowBackUp,
  'sharp-left': IconArrowSharpTurnLeft, left: IconCornerUpLeft, 'slight-left': IconArrowBearLeft, roundabout: IconRotateClockwise, stairs: IconStairs, arrive: IconMapPinCheck,
};
// A turn two blocks away does not need metre precision, and a number that changes every few seconds is hard to read while walking.
const glance = (meters: number) => meters >= 100 ? Math.round(meters / 10) * 10 : Math.max(5, Math.round(meters / 5) * 5);
const QUIET = `${colors.surface}B8`;

export function TurnIcon({ turn, size = 40, color = colors.surface }: { turn: Turn; size?: number; color?: string }) {
  const Icon = ICONS[turn];
  return <Icon size={size} color={color} strokeWidth={2.25} />;
}

const turnEnter = () => {
  'worklet';
  const timing = { duration: duration.state, easing: ease.out };
  return { initialValues: { opacity: 0, transform: [{ translateY: 8 }] }, animations: { opacity: withTiming(1, timing), transform: [{ translateY: withTiming(0, timing) }] } };
};

// The next thing to do, readable at arm's length outdoors. The frame stays put; only the turn inside it changes.
export function ManeuverBanner({ guidance, busy, name, top, onLayout }: { guidance: RouteGuidance; busy: boolean; name: string | null; top: number; onLayout?: (event: LayoutChangeEvent) => void }) {
  const { c, language } = useBuddyCopy();
  const reduceMotion = useContext(SystemReduceMotionContext);
  const lang = language.startsWith('id') ? 'id' : 'en';
  const { progress, next, after } = guidance;
  const waiting = !progress ? c('findingLocation') : busy ? c('rerouting') : null;
  const near = progress?.nearDestination ? name ? c('nearPerson', { name }) : c('nearShelter') : null;
  const turn = next ? turnOf(next.type) : 'arrive';
  const distance = formatDistance(glance(next ? guidance.nextManeuverM : guidance.remainingM), lang);
  const phrase = !next || turn === 'arrive' ? c('destinationAhead') : turn ? turnPhrase(turn, lang) : instructionText(next, lang);
  const street = turn && next?.streetNames?.[0];
  const then = next && after && next.distanceM <= 80 ? turnOf(after.type) : null;
  return <View onLayout={onLayout} style={[styles.banner, { top }]} accessible accessibilityRole="summary" accessibilityLabel={waiting ?? near ?? [distance, phrase, street].filter(Boolean).join(', ')}>
    {waiting ? <View style={styles.row}><ActivityIndicator color={colors.surface} /><AppText variant="section" style={styles.onInk}>{waiting}</AppText></View>
      : near ? <View style={styles.row}><TurnIcon turn="arrive" /><AppText variant="section" style={[styles.onInk, styles.grow]}>{near}</AppText></View>
      : <Animated.View key={`${next?.beginShapeIndex ?? 'end'}:${turn}`} entering={reduceMotion ? undefined : turnEnter} style={styles.row}>
        <TurnIcon turn={turn ?? 'straight'} />
        <View style={styles.grow}>
          <AppText variant="figure" style={styles.onInk}>{distance}</AppText>
          <AppText variant="section" numberOfLines={2} style={styles.onInk}>{phrase}</AppText>
          {!!street && <AppText numberOfLines={1} style={{ color: QUIET }}>{street}</AppText>}
        </View>
      </Animated.View>}
    {!waiting && !near && then && <View style={styles.then}>
      <AppText variant="small" style={{ color: QUIET }}>{c('thenTurn')}</AppText>
      <TurnIcon turn={then} size={18} />
      <AppText variant="small" style={styles.onInk}>{turnPhrase(then, lang).toLocaleLowerCase()}</AppText>
    </View>}
  </View>;
}

// Time left first, because that is what a walker checks; distance and arrival time sit beside it.
export function TripBar({ guidance, onOverview }: { guidance: RouteGuidance; onOverview: () => void }) {
  const { c, language } = useBuddyCopy();
  const lang = language.startsWith('id') ? 'id' : 'en';
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer); }, []);
  const arrival = new Date(now + guidance.minutes * 60000).toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' });
  return <View style={styles.trip}>
    <View style={styles.grow} accessible accessibilityLabel={`${guidance.minutes} ${c('minutes')}, ${formatDistance(guidance.remainingM, lang)}, ${c('arriveAt', { time: arrival })}`}>
      <View style={styles.time}><AppText variant="figure">{guidance.minutes}</AppText><AppText variant="section">{c('minShort')}</AppText></View>
      <AppText style={{ color: colors.muted, fontVariant: ['tabular-nums'] }}>{formatDistance(guidance.remainingM, lang)} · {c('arriveAt', { time: arrival })}</AppText>
    </View>
    <ActionButton compact variant="secondary" label={c('overview')} onPress={onOverview} />
  </View>;
}

export function RecenterPill({ bottom, onPress }: { bottom: number; onPress: () => void }) {
  const { c } = useBuddyCopy();
  return <Pressable accessibilityRole="button" accessibilityLabel={c('recenter')} onPress={onPress} style={[styles.recenter, { bottom }]}>
    <IconCurrentLocation size={18} color={colors.primary} /><AppText variant="button" style={{ color: colors.primary }}>{c('recenter')}</AppText>
  </Pressable>;
}

const styles = StyleSheet.create({
  banner: { position: 'absolute', left: 10, right: 10, gap: 12, paddingVertical: 16, paddingHorizontal: 18, ...corner(radius.lg), backgroundColor: colors.ink, boxShadow: `0 6px 8px ${colors.ink}33` },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16, minHeight: 56 },
  grow: { flex: 1 },
  onInk: { color: colors.surface },
  then: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: `${colors.surface}33` },
  trip: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  time: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  recenter: { position: 'absolute', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 18, borderRadius: radius.pill, backgroundColor: colors.surface, boxShadow: `0 2px 8px ${colors.ink}29` },
});
