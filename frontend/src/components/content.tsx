import { Pressable, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { AppText, Pill } from './ui';
import { usePressScale } from './press';
import { levelLabels } from '@/features/content/samples';
import { colors, corner, radius, sky, type AlertLevel } from '@/theme';

export function SampleNotice() {
  const { t } = useTranslation();
  return <View style={{ gap: 4 }}><AppText variant="eyebrow" style={{ color: colors.primary }}>{t('sampleContent')}</AppText><AppText variant="small" style={{ color: colors.muted }}>{t('sampleExplanation')}</AppText></View>;
}
export function ContentRow({ title, detail, leading, onPress }: { title: string; detail: string; leading?: string; onPress: () => void }) {
  const press = usePressScale(0.98);
  return <Pressable {...press.handlers} accessibilityRole="button" onPress={onPress}>
    <Animated.View style={[styles.row, { backgroundColor: press.pressed ? colors.canvas : colors.surface }, press.style]}>
      {leading && <View accessible={false} style={styles.leading}><AppText variant="button" style={{ color: colors.primary }}>{leading}</AppText></View>}
      <View style={{ flex: 1, gap: 4 }}><AppText variant="button">{title}</AppText><AppText variant="small" style={{ color: colors.muted }}>{detail}</AppText></View>
      <AppText accessible={false} style={{ color: colors.muted }}>›</AppText>
    </Animated.View>
  </Pressable>;
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

const styles = StyleSheet.create({
  row: { borderColor: colors.border, borderWidth: 1, ...corner(radius.lg), padding: 20, minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 16 },
  leading: { width: 48, height: 48, borderRadius: radius.pill, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 7, height: 7, borderRadius: radius.pill },
});
