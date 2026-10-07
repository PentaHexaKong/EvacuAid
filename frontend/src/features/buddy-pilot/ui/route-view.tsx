import { useAccess } from '@/features/access/use-access';
import { useEffect, useRef, useState } from 'react';
import { Linking, Platform, Pressable, View } from 'react-native';
import IconInfoCircle from '@tabler/icons-react-native/IconInfoCircle';
import { ActionButton, AppText } from '@/components/ui';
import { colors } from '@/theme';
import type { BuddyRoute, Position } from '../api';
import { useBuddyCopy } from '../copy';
import { distanceM, routeProgress } from '../navigation';
import { buddyStyles, Card, StatusChip } from './parts';

// Navigation logic is the pilot's NavigationPanel, unchanged; only the presentation is new.
export function RouteView({ route, position, target, onInstruction, speak, reroute, voiceEnabled }: { route: BuddyRoute; position: Position | null; target: Position | null; onInstruction: (instruction: string) => void; speak: (text: string) => Promise<void>; reroute: () => void; voiceEnabled: boolean }) {
  const { c } = useBuddyCopy();
  const { soundFree } = useAccess();
  const [progress, setProgress] = useState<ReturnType<typeof routeProgress>>(null);
  const [steps, setSteps] = useState(false);
  const offRoute = useRef({ count: 0, lastFix: '', lastReroute: 0 });
  const spoken = useRef('');
  const previous = useRef<{ route: BuddyRoute; segment: number }>({ route, segment: 0 });
  useEffect(() => {
    const update = () => {
      const next = position && route.route && (route.leg !== 'TO_REQUESTER' || target) ? routeProgress(position, route.route.geometry.coordinates, route.route.maneuvers, Date.now(), previous.current.route === route ? previous.current.segment : 0) : null;
      if (next) previous.current = { route, segment: next.segmentIndex };
      setProgress(next);
    };
    const initial = setTimeout(update, 0);
    const timer = setInterval(update, 5000);
    return () => { clearTimeout(initial); clearInterval(timer); };
  }, [route, position, target]);
  const maneuver = progress ? route.route?.maneuvers[progress.maneuverIndex] : null;
  useEffect(() => {
    if (!progress) { offRoute.current.count = 0; onInstruction(c('stale')); return; }
    onInstruction(maneuver?.instruction ?? c('stale'));
    if (route.leg === 'TO_REQUESTER' && target && route.destination && Date.now() - Date.parse(target.observedAt) <= 30000 && target.accuracyM <= 30 && distanceM(target, route.destination) > 30 && Date.now() - offRoute.current.lastReroute >= 15000) { offRoute.current.lastReroute = Date.now(); offRoute.current.count = 0; reroute(); return; }
    if (!position || offRoute.current.lastFix === position.observedAt) return;
    offRoute.current.lastFix = position.observedAt;
    offRoute.current.count = progress.offRouteM > 30 ? offRoute.current.count + 1 : 0;
    if (offRoute.current.count >= 3 && Date.now() - offRoute.current.lastReroute >= 15000) { offRoute.current.count = 0; offRoute.current.lastReroute = Date.now(); reroute(); }
    if (maneuver && progress.offRouteM <= 30 && spoken.current !== `${maneuver.beginShapeIndex}:${maneuver.instruction}`) { spoken.current = `${maneuver.beginShapeIndex}:${maneuver.instruction}`; if (voiceEnabled) void speak(maneuver.instruction); }
  }, [route, progress, position, target, maneuver, onInstruction, c, reroute, speak, voiceEnabled]);

  const remainingM = progress ? Math.round(progress.remainingM) : route.route?.distanceM ?? 0;
  const minutes = progress && route.route ? Math.max(1, Math.ceil((route.route.durationSec * progress.remainingM / Math.max(1, route.route.distanceM)) / 60)) : Math.max(1, Math.ceil((route.route?.durationSec ?? 0) / 60));
  const accessible = route.evaluation?.accessibilityStatus === 'COMPATIBLE';
  const destination = route.destination;
  const handoff = destination && (Platform.OS === 'ios'
    ? `http://maps.apple.com/?daddr=${destination.latitude},${destination.longitude}&dirflg=w`
    : `https://www.google.com/maps/dir/?api=1&destination=${destination.latitude},${destination.longitude}&travelmode=walking`);
  return <Card>
    <View style={[buddyStyles.row, { justifyContent: 'space-between' }]}>
      <AppText variant="eyebrow" style={{ color: colors.muted }}>{route.leg === 'TO_REQUESTER' ? c('toRequester') : c('toShelter')}</AppText>
      <StatusChip tone={accessible ? 'info' : 'neutral'} label={accessible ? c('accessible') : c('accessUnknown')} />
    </View>
    <View style={{ gap: 2 }}>
      <AppText variant="section">{destination?.name ?? c('instructions')}</AppText>
      <AppText style={{ color: colors.muted, fontVariant: ['tabular-nums'] }}>{remainingM} m · {c('eta')}: {minutes} {c('minutes')}</AppText>
    </View>
    {progress
      ? <AppText variant="statement" accessibilityLiveRegion="polite">{maneuver?.instruction ?? c('instructions')}</AppText>
      : <AppText accessibilityRole="alert" style={{ color: colors.caution }}>{c('stale')}</AppText>}
    {progress?.nearDestination && <AppText style={{ color: colors.primary }}>{c('nearDestination')}</AppText>}
    <View style={buddyStyles.actions}>
      {!soundFree && <View style={buddyStyles.grow}><ActionButton compact variant="secondary" label={c('repeat')} onPress={() => { void speak(maneuver?.instruction ?? c('stale')); }} /></View>}
      <View style={buddyStyles.grow}><ActionButton compact variant="secondary" label={c('reroute')} onPress={reroute} /></View>
    </View>
    {handoff && <ActionButton variant="gradient" label={c('openMaps')} onPress={() => { void Linking.openURL(handoff); }} />}
    <View style={[buddyStyles.row, { alignItems: 'flex-start', gap: 8 }]}>
      <IconInfoCircle size={18} color={colors.muted} />
      <AppText variant="small" style={[buddyStyles.grow, { color: colors.muted }]}>{c('routeUnknown')}</AppText>
    </View>
    {!!route.route?.maneuvers.length && <Pressable accessibilityRole="button" accessibilityState={{ expanded: steps }} onPress={() => setSteps(open => !open)} style={{ minHeight: 44, justifyContent: 'center' }}>
      <AppText variant="button" style={{ color: colors.primary }}>{steps ? c('hideSteps') : c('showSteps')}</AppText>
    </Pressable>}
    {steps && route.route?.maneuvers.map((item, index) => <AppText key={`${index}:${item.beginShapeIndex}`} style={{ fontVariant: ['tabular-nums'] }}>{index + 1}. {item.instruction}</AppText>)}
  </Card>;
}
