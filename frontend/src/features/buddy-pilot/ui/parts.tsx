import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { AppText } from '@/components/ui';
import { colors, corner, radius } from '@/theme';

export function initials(name: string | null | undefined) {
  return (name ?? '?').split(/\s+/).filter(Boolean).slice(0, 2).map(word => Array.from(word)[0]).join('').toLocaleUpperCase() || '?';
}

export function PersonAvatar({ name, size = 48 }: { name: string | null | undefined; size?: number }) {
  return <View accessible={false} style={[styles.avatar, { width: size, height: size, ...corner(Math.round(size * 0.32)) }]}>
    <AppText variant="button" style={{ color: colors.surface, fontSize: size * 0.36, lineHeight: size * 0.44 }}>{initials(name)}</AppText>
  </View>;
}

type Tone = 'critical' | 'caution' | 'info' | 'neutral';
const TONES: Record<Tone, { bg: string; fg: string }> = {
  critical: { bg: colors.criticalSoft, fg: colors.critical },
  caution: { bg: colors.cautionSoft, fg: colors.caution },
  info: { bg: colors.accentSoft, fg: colors.primary },
  neutral: { bg: colors.chip, fg: colors.muted },
};

export function StatusChip({ label, tone = 'neutral', dot = false }: { label: string; tone?: Tone; dot?: boolean }) {
  const { bg, fg } = TONES[tone];
  return <View style={[styles.chip, { backgroundColor: bg }]}>
    {dot && <View style={[styles.dot, { backgroundColor: fg }]} />}
    <AppText variant="small" style={{ color: fg, fontWeight: '600' }}>{label}</AppText>
  </View>;
}

export function StatStrip({ items }: { items: { value: string; label: string }[] }) {
  return <View accessible accessibilityLabel={items.map(item => `${item.label} ${item.value}`).join(', ')} style={styles.strip}>
    {items.map(item => <View key={item.label} style={styles.stat}>
      <AppText variant="section" style={{ fontVariant: ['tabular-nums'] }}>{item.value}</AppText>
      <AppText variant="small" style={{ color: colors.muted }}>{item.label}</AppText>
    </View>)}
  </View>;
}

export function Card({ children, tint, style }: { children: ReactNode; tint?: 'caution' | 'info'; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, tint === 'caution' && styles.cardCaution, tint === 'info' && styles.cardInfo, style]}>{children}</View>;
}

export const buddyStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  actions: { flexDirection: 'row', gap: 10 },
  grow: { flex: 1 },
  quote: { padding: 12, ...corner(radius.sm), backgroundColor: colors.surface },
});

const styles = StyleSheet.create({
  avatar: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary },
  chip: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.pill },
  dot: { width: 7, height: 7, borderRadius: radius.pill },
  strip: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: 10, ...corner(radius.sm), backgroundColor: colors.surface },
  card: { gap: 14, padding: 16, ...corner(radius.lg), borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  cardCaution: { backgroundColor: colors.cautionSoft, borderColor: colors.cautionBorder },
  cardInfo: { backgroundColor: colors.accentSoft, borderColor: colors.borderStrong },
});
