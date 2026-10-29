import type { ReactNode, RefObject } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import IconVolume from '@tabler/icons-react-native/IconVolume';
import { AppText, StepList } from '@/components/ui';
import { CloseButton } from '@/components/native-controls';
import { usePressScale } from '@/components/press';
import { colors, gutter, radius } from '@/theme';

export type LayoutNote = { key: string; icon: ReactNode; text: string };
export type LayoutAction = { key: string; label: string; detail?: string; icon?: ReactNode; filled?: boolean; busy?: boolean; hint?: string; onPress: () => void };

// Every warning, whoever it is for: the level sky, the headline, what to do, where it applies, then one action per row.
// VoiceOver reads it in the order it is drawn. What changes per person is the type size and the actions, never the layout.
// The headline already names the level, so there is no badge. Every answer is a full row, never a bare link.
// Blind and low vision: large type, Hear again at the top, and no numbered steps, since a list after the buttons is rarely reached by VoiceOver.
// Everything is in the level's ink, which the sky palette keeps at 4.5:1 or more across the whole gradient.
export function EmergencyLayout({ stops, ink, large = false, headline, headlineRef, onHeadlineLayout, guidance, meta, notes, steps, actions, readAgain, close, insets }: {
  stops: readonly string[]; ink: string; large?: boolean; headline: string; headlineRef: RefObject<View | null>; onHeadlineLayout: () => void;
  guidance: string; meta: string; notes?: LayoutNote[]; steps?: string[]; actions: LayoutAction[];
  readAgain?: { label: string; hint: string; onPress: () => void }; close: { label: string; onPress: () => void }; insets: { top: number; bottom: number };
}) {
  const type = large ? largeType : regularType;
  return <View style={styles.root}>
    <LinearGradient pointerEvents="none" colors={[stops[0], stops[0], stops[1], stops[2], stops[2]]} locations={[0, 0.62, 0.78, 0.92, 1]} style={StyleSheet.absoluteFill} />
    <ScrollView contentInsetAdjustmentBehavior="never" contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16 }]}>
      <View style={styles.top}>
        {readAgain ? <Pressable accessibilityRole="button" accessibilityLabel={readAgain.label} accessibilityHint={readAgain.hint} onPress={readAgain.onPress} style={({ pressed }) => [styles.chip, { borderColor: ink }, pressed && styles.pressed]}>
          <IconVolume size={22} strokeWidth={2.25} color={ink} /><AppText style={[styles.chipText, { color: ink }]}>{readAgain.label}</AppText>
        </Pressable> : <View />}
        <CloseButton label={close.label} color={ink} onPress={close.onPress} />
      </View>
      <View style={styles.message}>
        <View ref={headlineRef} accessible accessibilityRole="header" onLayout={onHeadlineLayout}><AppText style={[type.headline, { color: ink }]}>{headline}</AppText></View>
        <AppText style={[type.guidance, { color: ink }]}>{guidance}</AppText>
        {!!meta && <AppText style={[type.meta, { color: ink }]}>{meta}</AppText>}
        {notes?.map(note => <View key={note.key} accessible accessibilityLabel={note.text} style={styles.note}>{note.icon}<AppText style={[type.meta, styles.noteText, { color: ink }]}>{note.text}</AppText></View>)}
      </View>
      {!!steps?.length && <View style={styles.steps}><StepList steps={steps} /></View>}
      <View style={styles.actions}>{actions.map(({ key, ...action }) => <ActionRow key={key} {...action} ink={ink} type={type} />)}</View>
    </ScrollView>
  </View>;
}

// Filled is the one next step (white on the level's ink); the rest are outlined in ink. All are at least 72pt tall, which also suits shaky or slow hands.
export function ActionRow({ label, detail, icon, filled = false, busy = false, hint, onPress, ink, type = regularType }: Omit<LayoutAction, 'key'> & { ink: string; type?: typeof largeType }) {
  const press = usePressScale(0.97);
  const text = filled ? colors.surface : ink;
  return <Pressable {...press.handlers} accessibilityRole="button" accessibilityLabel={detail ? `${label}. ${detail}` : label} accessibilityHint={hint} accessibilityState={{ busy }} onPress={onPress}>
    <Animated.View style={[styles.button, filled ? [styles.filled, { backgroundColor: ink }] : [styles.outline, { borderColor: ink }], press.pressed && (filled ? styles.filledPressed : styles.pressed), press.style]}>
      {(icon || busy) && <View style={[styles.icon, { backgroundColor: filled ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.5)' }]}>{busy ? <ActivityIndicator color={text} /> : icon}</View>}
      <View style={styles.buttonText}>
        <AppText style={[type.label, { color: text }]}>{label}</AppText>
        {!!detail && <AppText style={[type.detail, { color: text }]}>{detail}</AppText>}
      </View>
    </Animated.View>
  </Pressable>;
}

const styles = StyleSheet.create({
  note: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  noteText: { flexShrink: 1, fontWeight: '500' },
  root: { flex: 1 },
  scroll: { flexGrow: 1, paddingHorizontal: gutter, gap: 28, maxWidth: 680, width: '100%', alignSelf: 'center' },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 48 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 48, paddingHorizontal: 16, borderRadius: radius.pill, borderWidth: 2 },
  pressed: { backgroundColor: 'rgba(255,255,255,0.4)' },
  chipText: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
  message: { gap: 12 },
  steps: { backgroundColor: 'rgba(255,255,255,0.55)', borderRadius: radius.md, borderCurve: 'continuous', padding: 16 },
  actions: { gap: 12 },
  button: { minHeight: 72, borderRadius: radius.lg, borderCurve: 'continuous', flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, paddingHorizontal: 16 },
  filled: { minHeight: 92 },
  filledPressed: { opacity: 0.86 },
  outline: { borderWidth: 2, backgroundColor: 'rgba(255,255,255,0.28)' },
  icon: { width: 48, height: 48, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  buttonText: { flex: 1, gap: 2 },
});

export const largeType = StyleSheet.create({
  headline: { fontSize: 36, lineHeight: 42, letterSpacing: -0.6, fontWeight: '600' },
  guidance: { fontSize: 22, lineHeight: 30, fontWeight: '500' },
  meta: { fontSize: 17, lineHeight: 24 },
  label: { fontSize: 20, lineHeight: 26, fontWeight: '600' },
  detail: { fontSize: 17, lineHeight: 22 },
});

// Sighted readers get the app's own scale; Larger text still enlarges it on top.
export const regularType = StyleSheet.create({
  headline: { fontSize: 30, lineHeight: 36, letterSpacing: -0.5, fontWeight: '600' },
  guidance: { fontSize: 18, lineHeight: 25, fontWeight: '500' },
  meta: { fontSize: 15, lineHeight: 21 },
  label: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
  detail: { fontSize: 15, lineHeight: 20 },
});
