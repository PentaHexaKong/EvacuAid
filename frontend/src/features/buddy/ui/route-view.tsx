import { useAccess } from '@/features/access/use-access';
import { useState } from 'react';
import { Linking, Platform, Pressable, View } from 'react-native';
import IconInfoCircle from '@tabler/icons-react-native/IconInfoCircle';
import { ActionButton, AppText } from '@/components/ui';
import { colors } from '@/theme';
import type { BuddyRoute } from '../api';
import { useBuddyCopy } from '../copy';
import { formatDistance, instructionText } from '../navigation';
import type { RouteGuidance } from '../use-route-guidance';
import { buddyStyles, Card, StatusChip } from './parts';

export function RouteView({ route, title, guidance, speak, reroute }: { route: BuddyRoute; title?: string; guidance: RouteGuidance; speak: (text: string) => Promise<void>; reroute: () => void }) {
  const { c, language } = useBuddyCopy();
  const { soundFree } = useAccess();
  const [steps, setSteps] = useState(false);
  const lang = language.startsWith('id') ? 'id' : 'en';
  const { progress, instruction, minutes } = guidance;
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
      <AppText variant="section">{title ?? destination?.name ?? c('instructions')}</AppText>
      <AppText style={{ color: colors.muted, fontVariant: ['tabular-nums'] }}>{formatDistance(guidance.remainingM, lang)} · {c('eta')}: {minutes} {c('minutes')}</AppText>
    </View>
    {progress
      ? <AppText variant="statement" accessibilityLiveRegion="polite">{instruction ?? c('instructions')}</AppText>
      : <AppText accessibilityRole="alert" style={{ color: colors.caution }}>{c('stale')}</AppText>}
    {progress?.nearDestination && <AppText style={{ color: colors.primary }}>{c('nearDestination')}</AppText>}
    <View style={buddyStyles.actions}>
      {!soundFree && <View style={buddyStyles.grow}><ActionButton compact variant="secondary" label={c('repeat')} onPress={() => { void speak(instruction ?? c('stale')); }} /></View>}
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
    {steps && route.route?.maneuvers.map((item, index) => <AppText key={`${index}:${item.beginShapeIndex}`} style={{ fontVariant: ['tabular-nums'] }}>{index + 1}. {instructionText(item, lang)}</AppText>)}
  </Card>;
}
