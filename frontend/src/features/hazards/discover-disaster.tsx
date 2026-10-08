import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { AppText, Tap } from '@/components/ui';
import { usePressScale } from '@/components/press';
import { colors, corner, radius } from '@/theme';
import { HazardBanner } from './hazard-banner';
import { hazardFacts } from './hazard-facts';
import { useRecentHazards } from './use-recent-hazards';
import type { HazardItem, HazardType } from './api';

const GUTTER = 20;
const GAP = 12;
const BANNER = 132;

export function DiscoverDisaster() {
  const { t } = useTranslation();
  const { status, items, retry } = useRecentHazards();
  const { width } = useWindowDimensions();
  const [filter, setFilter] = useState<HazardType | 'all'>('all');
  const types = [...new Set(items.map(item => item.type))];
  // A refresh can drop the selected type; fall back to All instead of showing nothing.
  const active = filter !== 'all' && types.includes(filter) ? filter : 'all';
  const shown = active === 'all' ? items : items.filter(item => item.type === active);
  const cardWidth = Math.min(280, Math.round(width * 0.68));
  return <View style={{ gap: 14 }}>
    <AppText variant="section" accessibilityRole="header">{t('discoverDisaster')}</AppText>
    {status === 'ready' && types.length > 0 && <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.bleed} contentContainerStyle={styles.chips} accessibilityRole="radiogroup">
      {(['all', ...types] as const).map(type => {
        const selected = type === active;
        return <Tap key={type} accessibilityRole="radio" accessibilityState={{ selected }} onPress={() => setFilter(type)} style={[styles.chip, selected && styles.chipSelected]}>
          <AppText variant="button" style={{ color: selected ? colors.surface : colors.ink }}>{t(type === 'all' ? 'hazardAll' : `hazard_${type}`)}</AppText>
        </Tap>;
      })}
    </ScrollView>}
    {status === 'loading' && <View accessible accessibilityLabel={t('hazardsLoading')} style={[styles.row, styles.bleed]}>
      {[0, 1].map(key => <View key={key} style={[styles.skeleton, { width: cardWidth }]} />)}
    </View>}
    {status === 'error' && <View style={styles.message}>
      <AppText style={{ color: colors.muted, flexShrink: 1 }}>{t('hazardsError')}</AppText>
      <Tap onPress={() => void retry()} style={{ minHeight: 44, paddingHorizontal: 8 }}><AppText variant="button" style={{ color: colors.primary }}>{t('retry')}</AppText></Tap>
    </View>}
    {status === 'ready' && items.length === 0 && <AppText style={{ color: colors.muted }}>{t('hazardsEmpty')}</AppText>}
    {status === 'ready' && shown.length > 0 && <ScrollView horizontal showsHorizontalScrollIndicator={false} snapToInterval={cardWidth + GAP} decelerationRate="fast" style={styles.bleed} contentContainerStyle={styles.row}>
      {shown.map(item => <HazardCard key={item.id} item={item} width={cardWidth} />)}
    </ScrollView>}
  </View>;
}

function HazardCard({ item, width }: { item: HazardItem; width: number }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const press = usePressScale(0.98);
  const facts = hazardFacts(item, t, i18n.language);
  return <Pressable {...press.handlers} accessibilityRole="button" accessibilityLabel={facts.label} accessibilityHint={t('hazardOpenHint')} onPress={() => router.push({ pathname: '/hazard/[id]', params: { id: item.id } })}>
    <Animated.View style={[styles.card, { width }, press.style]}>
      <HazardBanner type={item.type} height={BANNER} fade={64} fadeTo={colors.surface} />
      {/* The type sits on a solid pill, so no text is ever set straight onto a photo. */}
      <View style={styles.type}><AppText variant="small" style={styles.typeText}>{facts.typeName}</AppText></View>
      <View style={styles.body}>
        <View style={styles.figure}>
          <AppText variant="figure">{facts.figure}</AppText>
          <AppText variant="small" numberOfLines={2} style={styles.caption}>{facts.caption}</AppText>
        </View>
        <AppText variant="section" numberOfLines={2}>{facts.title}</AppText>
        {facts.lines.map(line => <AppText key={line} variant="small" numberOfLines={2} style={{ color: colors.muted }}>{line}</AppText>)}
        <AppText variant="small" style={styles.footer}>{facts.footer}</AppText>
      </View>
    </Animated.View>
  </Pressable>;
}

const styles = StyleSheet.create({
  bleed: { marginHorizontal: -GUTTER },
  chips: { paddingHorizontal: GUTTER, gap: 8 },
  chip: { minHeight: 40, paddingHorizontal: 16, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  row: { flexDirection: 'row', paddingHorizontal: GUTTER, gap: GAP },
  skeleton: { height: 300, ...corner(radius.lg), backgroundColor: colors.chip },
  message: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  card: { flexGrow: 1, ...corner(radius.lg), borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, overflow: 'hidden' },
  type: { position: 'absolute', top: 12, left: 12, paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: colors.surface },
  typeText: { color: colors.ink, fontWeight: '600' },
  // Pulled up into the faded foot of the photo, so the figure reads as rising out of it.
  body: { flexGrow: 1, marginTop: -28, paddingHorizontal: 14, paddingBottom: 14, gap: 4 },
  figure: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  caption: { flexShrink: 1, color: colors.muted },
  footer: { color: colors.muted, marginTop: 'auto', paddingTop: 8, fontVariant: ['tabular-nums'] },
});
