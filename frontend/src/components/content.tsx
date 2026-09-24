import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AppText } from './ui';
import { colors, radius } from '@/theme';

export function SampleNotice() {
  const { t } = useTranslation();
  return <View style={{ gap: 4 }}><AppText variant="eyebrow" style={{ color: colors.primary }}>{t('sampleContent')}</AppText><AppText variant="small" style={{ color: colors.muted }}>{t('sampleExplanation')}</AppText></View>;
}
export function ContentRow({ title, detail, leading, onPress }: { title: string; detail: string; leading?: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => ({ backgroundColor: pressed ? colors.canvas : colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.card, padding: 20, minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 16 })}>
    {leading && <View accessible={false} style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: colors.canvas, alignItems: 'center', justifyContent: 'center' }}><AppText variant="button" style={{ color: colors.primary }}>{leading}</AppText></View>}
    <View style={{ flex: 1, gap: 4 }}><AppText variant="button">{title}</AppText><AppText variant="small" style={{ color: colors.muted }}>{detail}</AppText></View>
    <AppText accessible={false} style={{ color: colors.muted }}>›</AppText>
  </Pressable>;
}
export function EmptyContent({ message = 'contentUnavailable' }: { message?: string }) {
  const { t } = useTranslation();
  return <AppText style={{ color: colors.muted }}>{t(message)}</AppText>;
}
export function SectionTitle({ children }: { children: string }) {
  return <AppText variant="section" accessibilityRole="header">{children}</AppText>;
}
