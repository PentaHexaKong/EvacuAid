import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, type TextProps } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Card } from 'heroui-native/card';
import { colors, radius, useTypography, type TextVariant } from '@/theme';

export function AppText({ variant = 'body', style, ...props }: TextProps & { variant?: TextVariant }) {
  return <Text allowFontScaling {...props} style={[useTypography(variant), style]} />;
}
export function Page({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return <ScrollView style={styles.page} keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="automatic" contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}>{children}</ScrollView>;
}
export function Panel({ children }: { children: ReactNode }) {
  return <Card style={styles.panel}><Card.Body style={{ gap: 16 }}>{children}</Card.Body></Card>;
}
export function SectionHeading({ number, title, subtitle }: { number: string; title: string; subtitle?: string }) {
  return <View style={{ gap: 8 }}><AppText variant="eyebrow" style={{ color: colors.primary }}>{number}</AppText><AppText variant="title" accessibilityRole="header">{title}</AppText>{subtitle && <AppText style={{ color: colors.muted }}>{subtitle}</AppText>}</View>;
}
export function ActionButton({ label, onPress, icon, variant = 'primary', disabled = false, loading = false }: { label: string; onPress?: () => void; icon?: ReactNode; variant?: 'primary' | 'gradient' | 'secondary'; disabled?: boolean; loading?: boolean }) {
  const [focused, setFocused] = useState(false);
  const foreground = variant === 'secondary' ? colors.primary : colors.surface;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: disabled || loading, busy: loading }} disabled={disabled || loading} onPress={onPress} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} style={({ pressed }) => [styles.button, { backgroundColor: pressed ? colors.ink : variant === 'secondary' ? colors.surface : colors.primary, opacity: disabled ? 0.5 : 1, borderColor: focused ? colors.ink : variant === 'secondary' ? colors.border : 'transparent', borderWidth: 2 }]}>
    {({ pressed }) => <>{variant === 'gradient' && !pressed && <LinearGradient pointerEvents="none" colors={[colors.gradientTop, colors.primary]} style={StyleSheet.absoluteFill} />}
    <View style={styles.buttonContent}>{loading ? <ActivityIndicator color={foreground} /> : icon}<AppText variant="button" style={{ color: pressed ? colors.surface : foreground, flexShrink: 1, textAlign: 'center' }}>{label}</AppText></View></>}
  </Pressable>;
}
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: 24, gap: 24, maxWidth: 680, width: '100%', alignSelf: 'center' },
  panel: { backgroundColor: colors.surface, borderRadius: radius.card, padding: 20, borderWidth: 1, borderColor: colors.border, boxShadow: 'none' },
  button: { minHeight: 52, borderRadius: radius.pill, overflow: 'hidden', justifyContent: 'center' },
  buttonContent: { paddingHorizontal: 20, paddingVertical: 12, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 },
});
