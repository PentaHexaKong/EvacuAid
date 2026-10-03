import { useState } from 'react';
import { Image, ScrollView, StyleSheet, useWindowDimensions, View, type ImageSourcePropType } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AppText, Tap } from '@/components/ui';
import { colors, corner, radius } from '@/theme';
import quakeArt from '../../../assets/brand/hazards/quake.png';
import floodArt from '../../../assets/brand/hazards/flood.png';
import volcanoArt from '../../../assets/brand/hazards/volcano.png';
import hazardArt from '../../../assets/brand/hazards/hazard.png';
import { parseFeltIntensity, parseQuakeRegion } from './region';
import { relativeTime } from './time';
import { useRecentHazards } from './use-recent-hazards';
import type { HazardItem, HazardType } from './api';

const ART: Partial<Record<HazardType, ImageSourcePropType>> = { earthquake: quakeArt, flood: floodArt, volcano: volcanoArt };
const SPOKEN_TIME = { timeJustNow: 'timeJustNow', timeMinutes: 'a11yMinutes', timeHours: 'a11yHours', timeDays: 'a11yDays' } as const;
const GUTTER = 20;
const GAP = 12;

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
  const { t } = useTranslation();
  const time = relativeTime(item.occurredAt);
  const quake = item.type === 'earthquake' && item.magnitude != null;
  const region = quake ? parseQuakeRegion(item.region) : null;
  const felt = parseFeltIntensity(item.felt);
  // The figure is the card's hero: magnitude for quakes, report count for citizen reports.
  const figure = quake ? item.magnitude!.toFixed(1) : String(item.reportCount ?? '');
  const caption = quake ? t('magnitudeCaption') : t('reportsCaption', { count: item.reportCount ?? 0 });
  const title = region ? t('quakePlace', { distance: region.distanceKm, direction: t(`dir_${region.direction}`), place: region.place }) : t(`hazard_${item.type}`);
  const setting = region?.setting ? t(region.setting === 'sea' ? 'quakeSea' : 'quakeLand') : null;
  const detail = region ? [region.area, setting].filter(Boolean).join(' · ') : quake ? item.region : null;
  const footer = t('timeAndSource', { time: t(time.key, { count: time.count }), source: item.source });
  const spokenFelt = felt && t('a11yFelt', { intensity: felt.to ? t('a11yRange', { from: felt.from, to: felt.to }) : felt.from });
  const label = [
    quake ? t('a11yQuakeTitle', { magnitude: figure }) : `${t(`hazard_${item.type}`)}, ${figure} ${caption}`,
    region ? title : null,
    detail,
    spokenFelt,
    t(SPOKEN_TIME[time.key], { count: time.count }),
    t('a11ySource', { source: item.source }),
  ].filter(Boolean).join('. ');
  return <View accessible accessibilityLabel={label} style={[styles.card, { width }]}>
    <View style={styles.art}>
      <View style={styles.figure}>
        <AppText variant="figure" style={{ color: colors.ink }}>{figure}</AppText>
        <AppText variant="small" numberOfLines={2} style={{ color: colors.muted }}>{caption}</AppText>
      </View>
      <Image source={ART[item.type] ?? hazardArt} style={styles.image} />
    </View>
    <View style={styles.body}>
      <AppText variant="section" numberOfLines={2}>{title}</AppText>
      {detail && <AppText variant="small" numberOfLines={2} style={{ color: colors.muted }}>{detail}</AppText>}
      {felt && <View style={styles.tag}><AppText variant="small" style={{ color: colors.ink }}>{t('felt', { intensity: felt.text })}</AppText></View>}
      <AppText variant="small" style={styles.footer}>{footer}</AppText>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  bleed: { marginHorizontal: -GUTTER },
  chips: { paddingHorizontal: GUTTER, gap: 8 },
  chip: { minHeight: 40, paddingHorizontal: 16, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  row: { flexDirection: 'row', paddingHorizontal: GUTTER, gap: GAP },
  skeleton: { height: 236, ...corner(radius.lg), backgroundColor: colors.chip },
  message: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  card: { ...corner(radius.lg), borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, overflow: 'hidden' },
  art: { height: 112, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', paddingLeft: 16, paddingRight: 6, paddingBottom: 8, backgroundColor: colors.accentSoft },
  figure: { flexShrink: 1, paddingBottom: 6, gap: 0 },
  image: { width: 96, height: 96 },
  body: { flexGrow: 1, padding: 14, gap: 6 },
  tag: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: colors.chip },
  footer: { color: colors.muted, marginTop: 'auto', paddingTop: 4, fontVariant: ['tabular-nums'] },
});
