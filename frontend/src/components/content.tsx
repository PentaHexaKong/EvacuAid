import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import IconChevronRight from '@tabler/icons-react-native/IconChevronRight';
import { AppText, Pill } from './ui';
import { Row } from './grouped-list';
import { levelLabels, type sampleAlerts } from '@/features/content/samples';
import { colors, radius, sky, type AlertLevel } from '@/theme';

export function SampleNotice() {
  const { t } = useTranslation();
  return <View style={{ gap: 4 }}><AppText variant="eyebrow" style={{ color: colors.primary }}>{t('sampleContent')}</AppText><AppText variant="small" style={{ color: colors.muted }}>{t('sampleExplanation')}</AppText></View>;
}
export function EmptyContent({ message = 'contentUnavailable' }: { message?: string }) {
  const { t } = useTranslation();
  return <AppText style={{ color: colors.muted }}>{t(message)}</AppText>;
}
export function SectionTitle({ children }: { children: string }) {
  return <AppText variant="section" accessibilityRole="header">{children}</AppText>;
}
export function ExampleChip() {
  const { t } = useTranslation();
  return <Pill style={{ backgroundColor: colors.chip }}><AppText variant="small" style={{ color: colors.muted, fontWeight: '600' }}>{t('exampleTag')}</AppText></Pill>;
}
export function LevelChip({ level }: { level: AlertLevel }) {
  const { t } = useTranslation();
  const { stops, ink } = sky[level];
  return <Pill style={{ backgroundColor: stops[2] }}>
    <View style={[styles.dot, { backgroundColor: ink }]} />
    <AppText variant="small" style={{ color: ink, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' }}>{t(levelLabels[level])}</AppText>
  </Pill>;
}
// One alert as a list row: level chip, title, area and time. Used by Home and the alerts sheet.
export function AlertRow({ alert, onPress }: { alert: (typeof sampleAlerts)[number]; onPress: () => void }) {
  const { t } = useTranslation();
  return <Row title={<View style={{ gap: 6 }}><LevelChip level={alert.level} /><AppText variant="button">{t(alert.title)}</AppText></View>} detail={`${t(alert.area)} · ${alert.issued}`} trailing={<IconChevronRight size={18} strokeWidth={2.25} color={colors.muted} />} accessibilityLabel={`${t(levelLabels[alert.level])}. ${t(alert.title)}. ${t(alert.area)}. ${alert.issued}`} onPress={onPress} />;
}

const styles = StyleSheet.create({
  dot: { width: 7, height: 7, borderRadius: radius.pill },
});
