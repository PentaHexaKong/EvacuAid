import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import IconMap from '@tabler/icons-react-native/IconMap';
import { PageScrollView } from '@/components/page-scroll-view';
import { EmptyContent, SectionTitle } from '@/components/content';
import { ActionButton, AppText, Page, StepList } from '@/components/ui';
import { HazardBanner, hazardPhotoCredit } from '@/features/hazards/hazard-banner';
import { hazardFacts } from '@/features/hazards/hazard-facts';
import { findHazard } from '@/features/hazards/use-recent-hazards';
import { ListenButton } from '@/components/listen-button';
import { useAccess } from '@/features/access/use-access';
import { colors, corner, gutter, radius } from '@/theme';

const BANNER = 300;
const STEPS = [1, 2, 3, 4];

export function HazardScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const item = findHazard(id);
  const access = useAccess();
  if (!item) return <Page><EmptyContent /></Page>;
  const facts = hazardFacts(item, t, i18n.language);
  const located = item.latitude != null && item.longitude != null;
  // The photo runs under the transparent navigation bar; the bar's title appears once the heading scrolls beneath it.
  return <PageScrollView contentInsetAdjustmentBehavior="never" style={styles.page} contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}>
    <HazardBanner type={item.type} height={BANNER} fade={140} fadeTo={colors.canvas} />
    <View style={styles.content}>
      <View style={{ gap: 8 }}>
        <View style={styles.type}><AppText variant="small" style={styles.typeText}>{facts.typeName}</AppText></View>
        <AppText variant="title" accessibilityRole="header">{facts.title}</AppText>
        <AppText style={{ color: colors.muted, fontVariant: ['tabular-nums'] }}>{facts.footer}</AppText>
      </View>
      {access.listen && <ListenButton text={[facts.typeName, facts.title, ...facts.facts.map(fact => `${fact.label}: ${fact.value}`), ...STEPS.map(step => `${step}. ${t(`hazardStep_${item.type}_${step}`)}`), t(item.source === 'BMKG' ? 'hazardSourceBmkg' : 'hazardSourceReports')].join('. ')} auto={access.autoRead} />}
      <View style={{ gap: 12 }}>
        <SectionTitle>{t('hazardKeyFacts')}</SectionTitle>
        <View style={styles.facts}>
          {facts.facts.map((fact, index) => <View key={fact.label} accessible accessibilityLabel={`${fact.label}: ${fact.value}`} style={[styles.fact, index > 0 && styles.factRule]}>
            <AppText variant="small" style={styles.factLabel}>{fact.label}</AppText>
            <AppText selectable style={styles.factValue}>{fact.value}</AppText>
          </View>)}
        </View>
      </View>
      <View style={{ gap: 14 }}>
        <SectionTitle>{t('hazardWhatToDo')}</SectionTitle>
        <StepList steps={STEPS.map(step => t(`hazardStep_${item.type}_${step}`))} />
      </View>
      <ActionButton variant="gradient" label={t(located ? 'hazardShowOnMap' : 'hazardOpenMap')} icon={<IconMap size={20} color={colors.surface} />} onPress={() => router.navigate({ pathname: '/discover', params: located ? { focus: `${item.latitude},${item.longitude}` } : {} })} />
      <View style={{ gap: 6 }}>
        <AppText variant="small" style={{ color: colors.muted }}>{t(item.source === 'BMKG' ? 'hazardSourceBmkg' : 'hazardSourceReports')}</AppText>
        <AppText variant="small" style={{ color: colors.muted }}>{t('hazardPhotoNote', { credit: hazardPhotoCredit(item.type) })}</AppText>
      </View>
    </View>
  </PageScrollView>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.canvas },
  // Pulled up into the faded foot of the photo.
  content: { marginTop: -56, paddingHorizontal: gutter, gap: 28, maxWidth: 680, width: '100%', alignSelf: 'center' },
  type: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  typeText: { color: colors.ink, fontWeight: '600' },
  facts: { ...corner(radius.lg), borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 16 },
  fact: { flexDirection: 'row', alignItems: 'baseline', gap: 16, paddingVertical: 12 },
  factRule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  factLabel: { width: 104, color: colors.muted },
  factValue: { flex: 1, fontVariant: ['tabular-nums'] },
});
