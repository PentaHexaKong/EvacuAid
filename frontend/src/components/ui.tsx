import { SheetHeaderContext, SheetScrollView } from './sheet-scroll-view';
import { PageHeaderContext, PageScrollView, PageTitleContext } from './page-scroll-view';
import { TabBarContext, TabScrollView } from './tab-shell';
import { useAccess } from '@/features/access/use-access';
import { usePreferences } from '@/features/preferences/context';
import { useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type PressableProps, type StyleProp, type TextInputProps, type TextProps, type ViewStyle } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut } from 'react-native-reanimated';
import { motion, usePressScale } from './press';
import { LinearGradient } from 'expo-linear-gradient';
import IconCheck from '@tabler/icons-react-native/IconCheck';
import { colors, corner, gutter, radius, SystemReduceMotionContext, useTypography, type TextVariant } from '@/theme';
import { duration, ease } from '@/theme/motion';
import { useHaptics } from '@/features/feedback/haptics';

export function AppText({ variant = 'body', style, ...props }: TextProps & { variant?: TextVariant }) {
  const measureTitle = useContext(PageTitleContext);
  const text = useRef<Text>(null);
  const { preferences } = usePreferences();
  const typography = useTypography(variant);
  const resolved = StyleSheet.flatten([typography, style]);
  return <Text ref={text} allowFontScaling {...props} onLayout={event => { if (props.accessibilityRole === 'header') measureTitle?.(text.current); props.onLayout?.(event); }} style={[typography, style, preferences.largerText && { fontSize: (resolved.fontSize ?? 16) * 1.2, lineHeight: (resolved.lineHeight ?? 24) * 1.2 }, preferences.strongerContrast && resolved.color === colors.muted && { color: colors.ink }]} />;
}
export function Page({ children, keyboard = false, transparent = false, fill = false, edgeInsets, contentStyle }: { children: ReactNode; keyboard?: boolean; transparent?: boolean; fill?: boolean; edgeInsets?: { top: number; bottom: number }; contentStyle?: StyleProp<ViewStyle> }) {
  const inSheet = useContext(SheetHeaderContext);
  const header = useContext(PageHeaderContext);
  const inTab = useContext(TabBarContext);
  const Container = header ? PageScrollView : inSheet ? SheetScrollView : inTab ? TabScrollView : ScrollView;
  return <Container automaticallyAdjustKeyboardInsets={keyboard} keyboardDismissMode={keyboard ? 'interactive' : 'none'} style={[styles.page, transparent && { backgroundColor: 'transparent' }]} keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior={edgeInsets ? 'never' : 'automatic'} contentContainerStyle={[styles.content, inTab && { paddingTop: 12 }, fill && { flexGrow: 1 }, edgeInsets && { paddingTop: edgeInsets.top + 12, paddingBottom: edgeInsets.bottom + 12 }, contentStyle]}>{children}</Container>;
}
export function Panel({ children }: { children: ReactNode }) {
  return <View style={styles.panel}>{children}</View>;
}
export function Field({ invalid = false, style, onFocus, onBlur, ...props }: TextInputProps & { invalid?: boolean }) {
  const [focused, setFocused] = useState(false);
  const { preferences } = usePreferences();
  const typography = useTypography('body');
  return <TextInput allowFontScaling placeholderTextColor={preferences.strongerContrast ? colors.ink : colors.muted} {...props} onFocus={event => { setFocused(true); onFocus?.(event); }} onBlur={event => { setFocused(false); onBlur?.(event); }} style={[typography, styles.field, preferences.largerText && { fontSize: 19.2, lineHeight: 28.8 }, { borderColor: invalid ? colors.critical : focused ? colors.primary : colors.border }, style]} />;
}
export function Tap({ style, children, ...props }: Omit<PressableProps, 'style' | 'children'> & { style?: StyleProp<ViewStyle>; children: ReactNode }) {
  return <Pressable accessibilityRole="button" hitSlop={8} pressRetentionOffset={16} {...props} style={({ pressed }) => [styles.tap, style, pressed && { opacity: 0.55 }]}>{children}</Pressable>;
}
export function Pill({ style, children }: { style?: StyleProp<ViewStyle>; children: ReactNode }) {
  return <View style={[styles.pill, style]}>{children}</View>;
}
export function SectionHeading({ number, title, subtitle }: { number: string; title: string; subtitle?: string }) {
  return <View style={{ gap: 8 }}><AppText variant="eyebrow" style={{ color: colors.primary }}>{number}</AppText><AppText variant="title" accessibilityRole="header">{title}</AppText>{subtitle && <AppText style={{ color: colors.muted }}>{subtitle}</AppText>}</View>;
}


type ButtonVariant = 'primary' | 'gradient' | 'secondary' | 'light' | 'ghostLight';

function buttonPalette(variant: ButtonVariant, pressed: boolean, focused: boolean) {
  if (variant === 'light') return { background: pressed ? colors.selected : colors.surface, text: colors.primary, spinner: colors.primary, border: focused ? colors.ink : 'transparent', borderWidth: 2 };
  if (variant === 'ghostLight') return { background: pressed ? 'rgba(255,255,255,0.16)' : 'transparent', text: colors.surface, spinner: colors.surface, border: focused ? colors.surface : 'rgba(255,255,255,0.6)', borderWidth: 1.5 };
  if (variant === 'secondary') return { background: pressed ? colors.selected : 'transparent', text: colors.primary, spinner: colors.primary, border: focused ? colors.ink : colors.borderStrong, borderWidth: 1.5 };
  return { background: pressed ? colors.ink : colors.primary, text: colors.surface, spinner: colors.surface, border: focused ? colors.ink : 'transparent', borderWidth: 2 };
}

export function ActionButton({ label, detail, onPress, icon, variant = 'primary', disabled = false, loading = false, compact = false }: { label: string; detail?: string; onPress?: () => void; icon?: ReactNode; variant?: ButtonVariant; disabled?: boolean; loading?: boolean; compact?: boolean }) {
  const [focused, setFocused] = useState(false);
  const press = usePressScale(0.96);
  const { largeTargets } = useAccess();
  const palette = buttonPalette(variant, press.pressed, focused);
  const showGradient = variant === 'gradient' && !press.pressed;
  return <Pressable {...press.handlers} accessibilityRole="button" accessibilityLabel={detail ? `${label}. ${detail}` : label} accessibilityState={{ disabled: disabled || loading, busy: loading }} disabled={disabled || loading} onPress={onPress} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}>
    <Animated.View style={[styles.button, compact && styles.buttonCompact, largeTargets && { minHeight: compact ? 52 : 60 }, { backgroundColor: palette.background, borderColor: palette.border, borderWidth: palette.borderWidth }, disabled && styles.disabled, press.style]}>
      {showGradient && <LinearGradient pointerEvents="none" colors={[colors.gradientTop, colors.primary]} style={StyleSheet.absoluteFill} />}
      <View style={[styles.buttonContent, compact && styles.buttonContentCompact]}>{loading ? <ActivityIndicator color={palette.spinner} /> : icon}{detail ? <View style={{ flexShrink: 1, gap: 4 }}><AppText variant="button" style={{ color: palette.text, textAlign: 'center' }}>{label}</AppText><AppText variant="small" style={{ color: palette.text, opacity: 0.8, textAlign: 'center' }}>{detail}</AppText></View> : <AppText variant="button" style={{ color: palette.text, flexShrink: 1, textAlign: 'center' }}>{label}</AppText>}</View>
    </Animated.View>
  </Pressable>;
}

export function CheckOption({ label, description, checked, disabled = false, onToggle }: { label: string; description?: string; checked: boolean; disabled?: boolean; onToggle: (checked: boolean) => void }) {
  const reduceMotion = useContext(SystemReduceMotionContext);
  const press = usePressScale(0.98);
  const haptics = useHaptics();
  return <Pressable {...press.handlers} accessibilityRole="checkbox" accessibilityLabel={label} accessibilityHint={description} accessibilityState={{ checked, disabled }} disabled={disabled} onPress={() => { haptics.selection(); onToggle(!checked); }}>
    <Animated.View style={[styles.option, { borderColor: checked ? colors.primary : colors.border, backgroundColor: checked ? colors.selected : colors.surface }, press.style]}>
      <View style={{ flex: 1, gap: 4 }}>
        <AppText variant="button">{label}</AppText>
        {description && <AppText variant="small" style={{ color: colors.muted }}>{description}</AppText>}
      </View>
      <View style={styles.checkRing}>
        <Animated.View style={[styles.checkFill, motion.checkTransition, { opacity: checked ? 1 : 0, transform: [{ scale: checked || reduceMotion ? 1 : 0.25 }] }]}>
          <IconCheck size={14} strokeWidth={3} color={colors.surface} />
        </Animated.View>
      </View>
    </Animated.View>
  </Pressable>;
}

export function SupportTile({ icon, label, description, checked, disabled = false, wide = false, onToggle }: { icon: ReactNode; label: string; description: string; checked: boolean; disabled?: boolean; wide?: boolean; onToggle: (checked: boolean) => void }) {
  const reduceMotion = useContext(SystemReduceMotionContext);
  const press = usePressScale(0.97);
  const haptics = useHaptics();
  return <Pressable {...press.handlers} style={{ flexGrow: 1 }} accessibilityRole="checkbox" accessibilityLabel={label} accessibilityHint={description} accessibilityState={{ checked, disabled }} disabled={disabled} onPress={() => { haptics.selection(); onToggle(!checked); }}>
    <Animated.View style={[styles.tile, wide && styles.tileRow, { borderColor: checked ? colors.primary : colors.border, backgroundColor: checked ? colors.selected : colors.surface }, press.style]}>
      <View style={[styles.tileIcon, { backgroundColor: checked ? colors.surface : colors.accentSoft }]}>{icon}</View>
      <View style={{ gap: 4, flex: wide ? 1 : undefined }}>
        <AppText variant="button" style={{ paddingRight: wide ? 0 : 24 }}>{label}</AppText>
        <AppText variant="small" style={{ color: colors.muted }}>{description}</AppText>
      </View>
      <View style={[styles.checkRing, !wide && styles.tileCheck]}>
        <Animated.View style={[styles.checkFill, motion.checkTransition, { opacity: checked ? 1 : 0, transform: [{ scale: checked || reduceMotion ? 1 : 0.25 }] }]}>
          <IconCheck size={14} strokeWidth={3} color={colors.surface} />
        </Animated.View>
      </View>
    </Animated.View>
  </Pressable>;
}

export function StepList({ steps }: { steps: readonly string[] }) {
  return <View style={{ gap: 12 }}>{steps.map((step, index) => <View key={step} accessible accessibilityLabel={`${index + 1}. ${step}`} style={styles.step}>
    <View style={styles.stepBadge}><AppText variant="small" style={styles.stepNumber}>{index + 1}</AppText></View>
    <AppText style={{ flex: 1 }}>{step}</AppText>
  </View>)}</View>;
}

export function Enter({ index = 0, children, style }: { index?: number; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const reduceMotion = useContext(SystemReduceMotionContext);
  const entering = useMemo(() => reduceMotion
    ? FadeIn.duration(duration.state)
    : FadeInDown.duration(duration.enter).delay(index * duration.stagger).easing(ease.out).withInitialValues({ opacity: 0, transform: [{ translateY: 14 }] }), [index, reduceMotion]);
  return <Animated.View entering={entering} exiting={FadeOut.duration(duration.exit)} style={style}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.canvas },
  content: { paddingVertical: 24, paddingHorizontal: gutter, gap: 24, maxWidth: 680, width: '100%', alignSelf: 'center' },
  panel: { backgroundColor: colors.surface, ...corner(radius.lg), padding: 20, borderWidth: 1, borderColor: colors.border, gap: 16 },
  field: { minHeight: 52, ...corner(radius.md), backgroundColor: colors.surface, paddingHorizontal: 16, paddingVertical: 12, borderWidth: 1 },
  tap: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, ...corner(radius.md) },
  pill: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, minHeight: 28, paddingHorizontal: 11, paddingVertical: 4, borderRadius: radius.pill },
  button: { minHeight: 52, borderRadius: radius.pill, overflow: 'hidden', justifyContent: 'center' },
  buttonCompact: { minHeight: 44 },
  buttonContentCompact: { paddingHorizontal: 18, paddingVertical: 8 },
  disabled: { opacity: 0.5 },
  buttonContent: { paddingHorizontal: 20, paddingVertical: 12, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 },
  option: { minHeight: 52, paddingVertical: 14, paddingHorizontal: 16, ...corner(radius.md), borderWidth: 1.5, flexDirection: 'row', gap: 16, alignItems: 'center' },
  checkRing: { width: 24, height: 24, borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  checkFill: { position: 'absolute', top: -1.5, left: -1.5, width: 24, height: 24, borderRadius: radius.pill, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  tile: { flexGrow: 1, minHeight: 132, padding: 16, gap: 12, ...corner(radius.lg), borderWidth: 1.5 },
  tileRow: { minHeight: 0, flexDirection: 'row', alignItems: 'center', gap: 14 },
  tileIcon: { width: 40, height: 40, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  tileCheck: { position: 'absolute', top: 14, right: 14 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepBadge: { width: 26, height: 26, borderRadius: radius.pill, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  stepNumber: { color: colors.primary, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
