import { SheetHeaderContext, SheetScrollView } from './sheet-scroll-view';
import { PageHeaderContext, PageScrollView, PageTitleContext } from './page-scroll-view';
import { usePreferences } from '@/features/preferences/context';
import { useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View, useAnimatedValue, type TextProps } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Card } from 'heroui-native/card';
import { colors, radius, SystemReduceMotionContext, useTypography, type TextVariant } from '@/theme';

export function AppText({ variant = 'body', style, ...props }: TextProps & { variant?: TextVariant }) {
  const measureTitle = useContext(PageTitleContext);
  const text = useRef<Text>(null);
  const { preferences } = usePreferences();
  const typography = useTypography(variant);
  const resolved = StyleSheet.flatten([typography, style]);
  return <Text ref={text} allowFontScaling {...props} onLayout={event => { if (props.accessibilityRole === 'header') measureTitle?.(text.current); props.onLayout?.(event); }} style={[typography, style, preferences.largerText && { fontSize: (resolved.fontSize ?? 16) * 1.2, lineHeight: (resolved.lineHeight ?? 24) * 1.2 }, preferences.strongerContrast && resolved.color === colors.muted && { color: colors.ink }]} />;
}
export function Page({ children, keyboard = false }: { children: ReactNode; keyboard?: boolean }) {
  const inSheet = useContext(SheetHeaderContext);
  const header = useContext(PageHeaderContext);
  const Container = header ? PageScrollView : inSheet ? SheetScrollView : ScrollView;
  return <Container automaticallyAdjustKeyboardInsets={keyboard} keyboardDismissMode={keyboard ? 'interactive' : 'none'} style={styles.page} keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>{children}</Container>;
}
export function Panel({ children }: { children: ReactNode }) {
  return <Card style={styles.panel}><Card.Body style={{ gap: 16 }}>{children}</Card.Body></Card>;
}
export function SectionHeading({ number, title, subtitle }: { number: string; title: string; subtitle?: string }) {
  return <View style={{ gap: 8 }}><AppText variant="eyebrow" style={{ color: colors.primary }}>{number}</AppText><AppText variant="title" accessibilityRole="header">{title}</AppText>{subtitle && <AppText style={{ color: colors.muted }}>{subtitle}</AppText>}</View>;
}
export function ActionButton({ label, onPress, icon, variant = 'primary', disabled = false, loading = false }: { label: string; onPress?: () => void; icon?: ReactNode; variant?: 'primary' | 'gradient' | 'secondary'; disabled?: boolean; loading?: boolean }) {
  const [focused, setFocused] = useState(false);
  const reduceMotion = useContext(SystemReduceMotionContext);
  const scale = useAnimatedValue(1);
  useEffect(() => { if (reduceMotion || disabled || loading) { scale.stopAnimation(); scale.setValue(1); } }, [reduceMotion, disabled, loading, scale]);
  const feedback = (value: number) => { if (!reduceMotion) Animated.timing(scale, { toValue: value, duration: 120, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(); };
  const foreground = variant === 'secondary' ? colors.primary : colors.surface;
  return <Animated.View style={{ transform: [{ scale }] }}><Pressable onPressIn={() => feedback(0.96)} onPressOut={() => feedback(1)} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: disabled || loading, busy: loading }} disabled={disabled || loading} onPress={onPress} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} style={({ pressed }) => [styles.button, { backgroundColor: pressed ? colors.ink : variant === 'secondary' ? colors.surface : colors.primary, opacity: disabled ? 0.5 : 1, borderColor: focused ? colors.ink : variant === 'secondary' ? colors.border : 'transparent', borderWidth: 2 }]}>
    {({ pressed }) => <>{variant === 'gradient' && !pressed && <LinearGradient pointerEvents="none" colors={[colors.gradientTop, colors.primary]} style={StyleSheet.absoluteFill} />}
    <View style={styles.buttonContent}>{loading ? <ActivityIndicator color={foreground} /> : icon}<AppText variant="button" style={{ color: pressed ? colors.surface : foreground, flexShrink: 1, textAlign: 'center' }}>{label}</AppText></View></>}
  </Pressable></Animated.View>;
}
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: 24, gap: 24, maxWidth: 680, width: '100%', alignSelf: 'center' },
  panel: { backgroundColor: colors.surface, borderRadius: radius.card, padding: 20, borderWidth: 1, borderColor: colors.border, boxShadow: 'none' },
  button: { minHeight: 52, borderRadius: radius.pill, overflow: 'hidden', justifyContent: 'center' },
  buttonContent: { paddingHorizontal: 20, paddingVertical: 12, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 },
});
